/* ReelRank AMC A-List savings: real ticket discounts minus configurable membership fees. */
(function () {
  'use strict';
  const STORAGE = 'reelrank-alist-savings-v1';
  const CACHE = 'reelrank-alist-ledger-cache-v1';
  const TIMEZONE = 'America/Los_Angeles';
  let receipts = [];
  let pricesLoaded = false;
  let ledgerStatus = 'loading';
  let lastPull = 0;
  let settings = {startMonth:'', endMonth:'', billingDay:0, pauseMonths:[], monthlyCosts:{}, manualPrices:{}, estimatedTicketPriceCents:2250, includeWaivedFees:false};
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    if (saved && typeof saved === 'object') settings = Object.assign(settings, saved);
    const cached = JSON.parse(localStorage.getItem(CACHE) || 'null');
    if (cached && Array.isArray(cached.rows)) {
      receipts = cached.rows;
      lastPull = cached.at || 0;
      pricesLoaded = true;
      ledgerStatus = 'cached';
    }
  } catch (_) {}

  const dollar = cents => (cents < 0 ? '-' : '') + '$' + (Math.abs(cents) / 100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const html = value => String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const slug = value => String(value || '').toLowerCase().replace(/&/g,' and ').replace(/['’]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const monthRange = str => /^\d{4}-(0[1-9]|1[0-2])$/.test(str);
  const localParts = (date) => {
    const parts = new Intl.DateTimeFormat('en-US',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const get = type => parts.find(x => x.type === type).value;
    return get('year') + '-' + get('month') + '-' + get('day');
  };
  function saveSettings() {
    try { localStorage.setItem(STORAGE, JSON.stringify(settings)); } catch (_) {}
  }
  function monthList(from,to) {
    const months = [];
    if (!monthRange(from) || !monthRange(to) || from > to) return months;
    let [y,m] = from.split('-').map(Number);
    for (let i=0; i<1200 && (y+'-'+String(m).padStart(2,'0')) <= to; i++) {
      months.push(y+'-'+String(m).padStart(2,'0'));
      m++;
      if (m===13) { m=1; y++; }
    }
    return months;
  }
  function rateForMonth(month) {
    const custom = Number(settings.monthlyCosts && settings.monthlyCosts[month]);
    if (Number.isFinite(custom) && custom >= 0 && settings.monthlyCosts[month] !== undefined) return Math.round(custom);
    const day = Number(settings.billingDay);
    const billDay = day >= 1 && day <= 31 ? Math.min(day,new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()) : 1;
    const billing = month+'-'+String(billDay).padStart(2,'0');
    if (billing >= '2026-07-15') return 2999;
    if (billing >= '2025-05-07') return 2799;
    return 2495;
  }
  function eligibleMovies(now) {
    const today = localParts(now);
    return movies.filter(m => {
      if (m.seen === false || !m.date || m.date > today) return false;
      const showtimeMs = Date.parse(m.showtimeAt || '');
      if (m.date === today && (!Number.isFinite(showtimeMs) || showtimeMs > now.getTime())) return false;
      const amc = String(m.id || '').startsWith('cloud-') || String(m.id || '').startsWith('amc-') || String(m.source || '').toLowerCase().includes('amc');
      if (!amc || ['canceled','cancelled','refunded','no_show'].includes(String(m.bookingStatus || '').toLowerCase())) return false;
      const ts = Date.parse(m.showtimeAt || '');
      if (Number.isFinite(ts) && ts > now.getTime()) return false;
      return true;
    });
  }
  function compute() {
    const now = new Date();
    const today = localParts(now);
    const filmList = eligibleMovies(now);
    const estimatedPrice = Math.round(Number(settings.estimatedTicketPriceCents));
    const estimatedTicketCents = Number.isFinite(estimatedPrice) && estimatedPrice > 0 && estimatedPrice <= 20000 ? estimatedPrice : 2250;
    const actuals = [];
    const covered = new Set();
    const seen = new Set();
    for (const r of receipts) {
      if (!r || r.ticket_kind !== 'alist' || !r.watched_date || r.watched_date > today) continue;
      if (['canceled','cancelled','refunded','no_show'].includes(String(r.booking_status || '').toLowerCase())) continue;
      const at = r.showtime_at ? Date.parse(r.showtime_at) : NaN;
      if (Number.isFinite(at) && at > now.getTime()) continue;
      if (!Number.isFinite(at) && r.watched_date === today) continue;
      const key = r.movie_slug+'|'+r.watched_date+'|'+String(r.showtime_at || '');
      if (seen.has(key)) continue;
      seen.add(key);
      const discount = r.alist_discount_cents === null || r.alist_discount_cents === undefined ? Number(r.ticket_value_cents) : Number(r.alist_discount_cents);
      const full = Number(r.ticket_value_cents);
      if (!Number.isFinite(full) || !Number.isFinite(discount) || full < 0 || discount < 0) continue;
      actuals.push({slug:r.movie_slug,date:r.watched_date,face:Math.round(full),discount:Math.round(discount),waiver:Math.max(0,Number(r.waived_fee_cents)||0),confirmed:r.booking_status==='attended'});
      covered.add(r.movie_slug+'|'+r.watched_date);
    }
    const pending = [];
    const pendingSeen = new Set();
    for (const m of filmList) {
      const key = String(m.id).startsWith('cloud-') ? m.id.slice(6) : slug(m.title)+'-'+m.year;
      const screeningId = key+'|'+m.date;
      if (covered.has(screeningId) || pendingSeen.has(screeningId)) continue;
      pendingSeen.add(screeningId);
      const manual = settings.manualPrices && Number(settings.manualPrices[key]);
      if (Number.isFinite(manual) && manual > 0) {
        actuals.push({slug:key,date:m.date,face:Math.round(manual),discount:Math.round(manual),waiver:0,confirmed:false,manual:true});
      } else {
        actuals.push({slug:key,title:m.title,date:m.date,face:estimatedTicketCents,discount:estimatedTicketCents,waiver:0,confirmed:false,estimated:true});
      }
    }
    const earliest = filmList.map(m=>m.date.slice(0,7)).filter(monthRange).sort()[0] || actuals.map(r=>r.date.slice(0,7)).filter(monthRange).sort()[0] || '';
    const start = monthRange(settings.startMonth || '') ? settings.startMonth : earliest;
    const finalMonth = today.slice(0,7);
    const stop = monthRange(settings.endMonth || '') && settings.endMonth < finalMonth ? settings.endMonth : finalMonth;
    const fees = {};
    for (const month of monthList(start,stop)) {
      if (Array.isArray(settings.pauseMonths) && settings.pauseMonths.includes(month)) continue;
      const year = month.slice(0,4);
      const day = Number(settings.billingDay);
      const billedDay = day >= 1 && day <= 31 ? Math.min(day,new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()) : 1;
      if (month+'-'+String(billedDay).padStart(2,'0') > today) continue;
      fees[year] = (fees[year] || 0) + rateForMonth(month);
    }
    const byYear = {};
    const years = new Set([...Object.keys(fees),...actuals.map(r=>r.date.slice(0,4)),...pending.map(m=>String(m.year))]);
    for (const year of years) {
      const rows = actuals.filter(r => r.date.slice(0,4)===year);
      const gross = rows.reduce((s,r)=>s+r.face,0);
      const discounted = rows.reduce((s,r)=>s+r.discount,0);
      const waiver = rows.reduce((s,r)=>s+r.waiver,0);
      const membership = fees[year] || 0;
      const countPending = pending.filter(m=>String(m.year)===year);
      byYear[year] = {year, rows, pending:countPending, gross, discounted, waiver, membership, net:discounted-membership+(settings.includeWaivedFees?waiver:0)};
    }
    const all = {year:'all',rows:actuals,pending,gross:0,discounted:0,waiver:0,membership:0,net:0};
    for (const record of Object.values(byYear)) {
      for (const name of ['gross','discounted','waiver','membership','net']) all[name]+=record[name];
    }
    return {all,byYear, earliest, start, stop, assumption:!monthRange(settings.startMonth||'')};
  }
  const styles = document.createElement('style');
  styles.textContent = [
    '.alist-savings-pill{display:flex;align-items:center;gap:14px;width:100%;padding:15px 19px;margin:-13px 0 26px;border:1px solid #34473e;border-radius:16px;background:linear-gradient(108deg,rgba(31,59,49,.67),rgba(21,26,39,.98));text-align:left;color:var(--white);transition:border-color .18s,transform .18s;min-height:74px}',
    '.alist-savings-pill:hover{border-color:#6b9f85;transform:translateY(-1px)}',
    '.alist-savings-icon{font-size:23px;background:#253d35;border:1px solid #4c705e;border-radius:13px;padding:12px;line-height:1}',
    '.alist-savings-text{min-width:0;display:flex;flex:1;flex-direction:column;gap:5px}',
    '.alist-savings-caption{font-size:11px;letter-spacing:1.2px;color:#b1bfba;text-transform:uppercase;font-weight:750}',
    '.alist-savings-value{color:#a2edc0;font-family:Manrope,sans-serif;font-size:26px;line-height:1.1;letter-spacing:-.8px;font-weight:800;font-variant-numeric:tabular-nums}',
    '.alist-savings-value.loss{color:#ffba9b}',
    '.alist-savings-hint{font-size:11px;color:#b1b9c7}',
    '.alist-savings-open{color:#a6bbad;font-size:19px}',
    '.alist-detail-stat{border:1px solid #333b4b;border-radius:12px;background:#1a202e;display:flex;justify-content:space-between;gap:12px;padding:12px 14px;margin:9px 0;font-size:13px}',
    '.alist-detail-stat strong{font-size:15px;font-variant-numeric:tabular-nums}',
    '.alist-detail-stat.main{border-color:#46715b;color:#a2edc0;font-weight:800}',
    '.alist-small{font-size:12px;line-height:1.55;color:#a4adbd;margin:12px 0}',
    '.alist-list{max-height:230px;overflow-y:auto;margin:10px 0;padding-right:4px}',
    '.alist-list-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #2b3444;font-size:12px}',
    '.alist-list-item input{width:98px;border-radius:8px;background:#1a2130;border:1px solid #3d4656;color:white;padding:9px 8px;min-height:40px}',
    '.alist-settings-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}',
    '.alist-settings-row .field{min-width:0}',
    '.alist-settings-row input{width:100%}',
    '.alist-muted-label{font-size:11px;letter-spacing:.5px;color:#a7b2be;text-transform:uppercase;font-weight:700}',
    '@media(max-width:600px){.alist-savings-pill{padding:13px 14px;gap:11px;margin:-15px 0 24px}.alist-savings-icon{padding:10px}.alist-savings-value{font-size:23px}.alist-savings-caption{font-size:10px}}'
  ].join('\n');
  document.head.appendChild(styles);
  const metrics = document.querySelector('.metrics');
  if (!metrics) return;
  const counter = document.createElement('button');
  counter.type='button';
  counter.id='alistSavingsCounter';
  counter.className='alist-savings-pill';
  counter.setAttribute('aria-label','Open AMC A-List money saved breakdown');
  metrics.insertAdjacentElement('afterend',counter);

  function updateCounter() {
    const all = compute();
    const scope = String(yearFilter || 'all');
    const obj = scope === 'all' ? all.all : (all.byYear[scope] || {rows:[],pending:[],net:0,membership:0,discounted:0,waiver:0});
    const label = scope === 'all' ? 'ALL-TIME' : scope;
    const amount = dollar(obj.net);
    const estimatedCount = obj.rows.filter(r => r.estimated).length;
    let hint = obj.rows.length+' A-List tickets';
    if (estimatedCount) hint += ' · '+estimatedCount+' estimated at '+dollar(Math.round(Number(settings.estimatedTicketPriceCents)||2250))+' each';
    if (!obj.rows.length) hint = 'No eligible past bookings';
    if (ledgerStatus === 'offline') hint += ' · receipt sync offline';
    hint += ' · details';
    counter.innerHTML = '<span class="alist-savings-icon" aria-hidden="true">↗</span><span class="alist-savings-text"><span class="alist-savings-caption">AMC A-List savings · '+html(label)+'</span><span class="alist-savings-value'+(obj.net<0?' loss':'')+'">'+html(amount)+(estimatedCount?' <span style="font-size:12px;color:#b8c4cf">est.</span>':'')+'</span><span class="alist-savings-hint">'+html(hint)+'</span></span><span class="alist-savings-open" aria-hidden="true">›</span>';
  }
  function row(label,value,cls) {return '<div class="alist-detail-stat'+(cls?' '+cls:'')+'"><span>'+html(label)+'</span><strong>'+html(value)+'</strong></div>';}
  function openBreakdown() {
    const all = compute();
    const scope = String(yearFilter || 'all');
    const obj = scope === 'all' ? all.all : (all.byYear[scope]||{rows:[],pending:[],gross:0,discounted:0,waiver:0,membership:0,net:0});
    const estimatedCount = obj.rows.filter(r => r.estimated).length;
    const confirmedCount = obj.rows.filter(r => !r.estimated && !r.manual).length;
    const title = 'A-List savings · '+(scope === 'all' ? 'All time' : scope);
    let body = '<p class="alist-small">Tickets without receipt prices are estimated at '+dollar(Number(settings.estimatedTicketPriceCents)||2250)+' each. Real AMC receipt prices take priority automatically. Membership charges follow California plan rates unless you customize them.</p>';
    body += row('Regular ticket value',dollar(obj.gross));
    if (obj.discounted !== obj.gross) body += row('A-List discounts received',dollar(obj.discounted));
    body += row('A-List membership fees','−'+dollar(obj.membership));
    body += row('Net savings'+(estimatedCount?' (estimated)':''),dollar(obj.net),'main');
    body += row('Screenings counted',String(obj.rows.length));
    body += row('Receipt-priced screenings',String(confirmedCount));
    body += row('Estimated-price screenings',String(estimatedCount));
    body += row('Convenience fees waived',dollar(obj.waiver)+(settings.includeWaivedFees?' · included':' · excluded'));
    if (estimatedCount) body+='<p class="alist-small">These are estimates, not verified ticket prices. Past reservations are provisionally counted when AMC attendance is not confirmed.</p>';
    if (all.assumption) body+='<p class="alist-small">Membership start is estimated from your earliest recorded AMC showing ('+html(all.earliest || 'unknown')+'). We assume monthly membership stayed active even in months you did not visit.</p>';
    body+='<hr style="border:0;border-top:1px solid #333a49;margin:19px 0"><div class="alist-muted-label">Ticket estimate & membership settings</div>';
    body+='<label class="field">Average ticket price estimate ($)<input id="alistEstimatedTicketPrice" type="number" inputmode="decimal" min="0.01" max="200" step="0.01" value="'+html(((Number(settings.estimatedTicketPriceCents)||2250)/100).toFixed(2))+'"></label>';
    body+='<div class="alist-settings-row"><label class="field">Start month<input id="alistStart" type="month" value="'+html(settings.startMonth || all.start || '')+'"></label><label class="field">End month (optional)<input id="alistEnd" type="month" value="'+html(settings.endMonth || '')+'"></label></div>';
    body+='<div class="alist-settings-row"><label class="field">Billing day of month<input id="alistDay" type="number" min="1" max="31" placeholder="Unknown" value="'+html(settings.billingDay || '')+'"></label><label class="field">A-List monthly fee override ($)<input id="alistFee" type="number" min="0" step=".01" placeholder="Leave for standard rate"></label></div>';
    body+='<label class="field">Monthly fee override applies to<input id="alistFeeMonth" type="month" value="'+html(scope!=='all'?scope+'-01':localParts(new Date()).slice(0,7))+'"></label>';
    body+='<label class="field">Paused / unpaid months (YYYY-MM, comma separated)<input id="alistPauses" placeholder="e.g. 2024-04, 2025-08" value="'+html((settings.pauseMonths || []).join(', '))+'"></label>';
    body+='<label style="display:flex;align-items:center;gap:9px;margin:15px 0;font-size:12px"><input id="alistIncludeFees" type="checkbox" '+(settings.includeWaivedFees?'checked':'')+'> Add waived convenience fees to savings</label>';
    body+='<div class="dialog-actions"><button class="btn primary" id="alistSaveSettings">Save membership settings</button></div>';
    if (false && obj.pending.length) {
      body+='<hr style="border:0;border-top:1px solid #333a49;margin:20px 0"><div class="alist-muted-label">Missing receipt prices (optional)</div><p class="alist-small">Your hourly AMC email sync will fill these in automatically. You can also enter the price for your own A-List ticket (not a guest) below.</p><div class="alist-list">';
      for (const m of obj.pending.slice(0,80)) body += '<label class="alist-list-item"><span>'+html(m.title)+' <small style="color:#9aa4b6">· '+html(m.date)+'</small></span><input data-alist-price="'+html(m.slug)+'" type="number" min="0" step=".01" placeholder="$ Ticket"></label>';
      body+='</div><div class="dialog-actions"><button class="btn" id="alistSavePrices">Save ticket prices</button></div>';
    }
    if (ledgerStatus==='offline') body+='<p class="alist-small">Ticket-price sync is offline. Showing the last available data.</p>';
    openModal(title,body);
    const feeMonth = document.getElementById('alistFeeMonth');
    const feeInput = document.getElementById('alistFee');
    function setFeeValue() {const v=settings.monthlyCosts && settings.monthlyCosts[feeMonth.value];feeInput.value=v===undefined?'':(v/100).toFixed(2);}
    setFeeValue();
    feeMonth.addEventListener('change',setFeeValue);
    document.getElementById('alistSaveSettings').onclick = function() {
      const start = document.getElementById('alistStart').value;
      const end = document.getElementById('alistEnd').value;
      if (start && !monthRange(start)) {toast('Enter a valid start month');return;}
      if (end && (!monthRange(end) || (start && end<start))) {toast('End month must follow start month');return;}
      const dayValue = document.getElementById('alistDay').value;
      const day = dayValue===''?0:Number(dayValue);
      if (!Number.isInteger(day) || day<0 || day>31) {toast('Billing day must be 1–31');return;}
      const estimateStr = document.getElementById('alistEstimatedTicketPrice').value;
      const estimateValue = Number(estimateStr);
      if (!estimateStr.trim() || !Number.isFinite(estimateValue) || estimateValue<=0 || estimateValue>200) {toast('Average ticket price must be between $0.01 and $200');return;}
      const overrideStr = feeInput.value;
      if (overrideStr!=='' && (!Number.isFinite(+overrideStr)|| +overrideStr<0 || +overrideStr>100)) {toast('Monthly fee must be between $0–$100');return;}
      settings.startMonth = start;
      settings.endMonth = end;
      settings.billingDay = day;
      settings.pauseMonths = document.getElementById('alistPauses').value.split(',').map(s=>s.trim()).filter(monthRange);
      settings.includeWaivedFees = document.getElementById('alistIncludeFees').checked;
      settings.estimatedTicketPriceCents = Math.round(estimateValue*100);
      settings.monthlyCosts ||= {};
      if (monthRange(feeMonth.value)) {
        if (overrideStr==='') delete settings.monthlyCosts[feeMonth.value];
        else settings.monthlyCosts[feeMonth.value]=Math.round(+overrideStr*100);
      }
      saveSettings();updateCounter();openBreakdown();toast('A-List settings saved');
    };
    const savePrices = document.getElementById('alistSavePrices');
    if (savePrices) savePrices.onclick = function() {
      settings.manualPrices ||= {};
      for (const input of document.querySelectorAll('input[data-alist-price]')) {
        if (!input.value.trim()) continue;
        const price=Number(input.value);
        if (!Number.isFinite(price)||price<=0||price>200) {toast('Ticket price must be between $0.01 and $200');return;}
        settings.manualPrices[input.dataset.alistPrice]=Math.round(price*100);
      }
      saveSettings();updateCounter();openBreakdown();toast('Ticket values saved');
    };
  }
  counter.addEventListener('click',openBreakdown);

  async function refreshPrices() {
    const since = Date.now();
    try {
      const response=await fetch(CLOUD_URL+'/rest/v1/amc_ticket_values?select=movie_slug,watched_date,showtime_at,ticket_kind,ticket_value_cents,alist_discount_cents,waived_fee_cents,booking_status&limit=5000',{headers:{'apikey':CLOUD_PUBLIC_KEY,'Accept':'application/json'},cache:'no-store'});
      if (!response.ok) throw new Error('Ticket ledger '+response.status);
      const rows=await response.json();
      if (!Array.isArray(rows)) throw new Error('Bad ticket ledger response');
      receipts=rows;
      pricesLoaded=true;
      ledgerStatus='synced';
      lastPull=since;
      try {localStorage.setItem(CACHE,JSON.stringify({at:since,rows}));}catch(_){}
    }catch(_) {
      ledgerStatus='offline';
      pricesLoaded=pricesLoaded || receipts.length>0;
    }
    updateCounter();
  }
  const originalRender = render;
  render = function() {const r=originalRender.apply(this,arguments);updateCounter();return r;};
  const originalRefresh=refreshCatalog;
  refreshCatalog=async function() {const r=await originalRefresh.apply(this,arguments);updateCounter();return r;};
  document.getElementById('yearSelect').addEventListener('change',()=>requestAnimationFrame(updateCounter));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){updateCounter(); if(Date.now()-lastPull>180000)void refreshPrices();}});
  setInterval(()=>{if(!document.hidden){updateCounter();void refreshPrices();}},5*60*1000);
  updateCounter();
  void refreshPrices();
})();