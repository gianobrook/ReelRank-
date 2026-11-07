/* ReelRank Top 10, unrated-first rankings, and post-showtime rating cards. */
(() => {
  'use strict';
  const HOUR = 60 * 60 * 1000;
  const WINDOW = 32 * 24 * HOUR;
  const allTime = () => movies.filter(m => m.seen !== false && hasRating(m)).slice().sort(rankSorter);
  const baseSorted = sorted;
  sorted = function() {
    if (view === 'all') {
      // Filter AFTER choosing the global top ten; a search cannot introduce an #11 film.
      return allTime().slice(0,10).filter(m => !query || m.title.toLowerCase().includes(query.toLowerCase()));
    }
    if (view === 'rated') {
      return movies.filter(m => m.seen !== false &&
          (yearFilter === 'all' || Number(m.year) === Number(yearFilter)) &&
          (!query || m.title.toLowerCase().includes(query.toLowerCase())))
        .slice().sort((a,b) => {
          const ar=hasRating(a),br=hasRating(b);
          if (ar!==br) return ar?1:-1;
          if (!ar) return (b.date||'').localeCompare(a.date||'') || a.title.localeCompare(b.title);
          return rankSorter(a,b);
        });
    }
    return baseSorted();
  };

  // A newly-added AMC movie without a score now appears before all ranked movies.
  const priorRender=render;
  render = function() {
    if (view === 'all' && yearFilter !== 'all') {
      yearFilter='all';
      const select=document.getElementById('yearSelect');
      if (select) select.value='all';
    }
    priorRender();
    const yr=document.getElementById('yearSelect');
    if (yr) yr.classList.toggle('hide',view==='all' || view==='battle');
    const title=document.getElementById('sectionTitle');
    const subtitle=document.getElementById('sectionSub');
    if (view === 'all') {
      if (title) title.textContent=query?'Search your Top 10':'The rest of your Top 10';
      if (subtitle) subtitle.textContent=allTime().length >= 10?'Your ten highest-ranked films':
        allTime().length+' rated · top ten fills as you rate';
    } else if (view === 'rated') {
      const pending=sorted().filter(m=>!hasRating(m)).length;
      if (title) title.textContent=pending?('Awaiting your rating ('+pending+') · Your rankings'):'Your rankings';
      if (subtitle) subtitle.textContent=pending?'Unrated movies first · scored movies follow automatically':'Ranked by your ratings';
    }
  };

  // Trigger is anchored to the booked showtime, not when an email was received.
  // The email automation populates showtimeAt and bookingStatus on each cloud movie.
  const postponed=new Set();
  let promptOpenId=null;
  let timer=null;
  function isEligible(m) {
    if (!m || m.seen === false || hasRating(m) || postponed.has(m.id)) return false;
    if (!['confirmed','attended','seen'].includes(String(m.bookingStatus||'').toLowerCase())) return false;
    const show=Date.parse(m.showtimeAt||'');
    if (!Number.isFinite(show)) return false;
    const elapsed=Date.now()-show;
    return elapsed >= HOUR && elapsed <= WINDOW;
  }
  function showtimeText(iso) {
    const date=new Date(iso);
    return date.toLocaleString('en-US',{
      weekday:'short',month:'short',day:'numeric',year:'numeric',
      hour:'numeric',minute:'2-digit',
      timeZone:'America/Los_Angeles',timeZoneName:'short'
    });
  }
  function schedulePrompt(ms=180) {
    clearTimeout(timer);
    timer=setTimeout(openPendingPrompt,ms);
  }
  function openPendingPrompt() {
    if (document.hidden || promptOpenId || document.querySelector('#shade.open')) return;
    const due=movies.filter(isEligible).sort((a,b)=>
      Date.parse(b.showtimeAt)-Date.parse(a.showtimeAt));
    const m=due[0];
    if (!m) return;
    promptOpenId=m.id;
    const ident=m.id;
    const localPoster=m.poster || posterCache[String(m.year)+'|'+normName(m.title)] || '';
    const picture=localPoster?
      '<img src="'+escapeHtml(localPoster)+'" alt="" onerror="this.remove()" '+
      'style="width:96px;height:144px;object-fit:cover;border-radius:12px;border:1px solid #51586c">':
      '<div style="width:96px;height:144px;display:grid;place-items:center;text-align:center;padding:10px;border-radius:12px;'+
      'background:linear-gradient(135deg,#39304d,#273348);color:#e8d2ee;font-size:12px;font-weight:800">'+escapeHtml(m.title)+'</div>';
    openModal('How was the movie?',`
      <div class="reel-postshow">
        <div class="reel-postshow-hero">${picture}<div><span class="eyebrow">YOUR LAST SCREENING</span>
          <h3>${escapeHtml(m.title)}</h3>
          <p>${escapeHtml(showtimeText(m.showtimeAt))}</p>
          <small>Based on your AMC reservation. Did you see it?</small></div></div>
        <label class="field">Your rating / 10
          <input id="reelPostScore" inputmode="decimal" type="number" min="0" max="10" step="0.5" placeholder="0–10" autocomplete="off">
        </label>
        <div class="reel-quick-scores" role="group" aria-label="Quick rating choices">
          ${[1,2,3,4,5,6,7,8,9,10].map(n=>'<button type="button" data-reel-score="'+n+'">'+n+'</button>').join('')}
        </div>
        <label class="field">Optional thoughts
          <textarea id="reelPostNotes" placeholder="What did you think?"></textarea>
        </label>
        <div class="dialog-actions reel-post-actions">
          <button class="btn" id="reelNotSeen" type="button">I didn't see it</button>
          <button class="btn" id="reelLater" type="button">Later</button>
          <button class="btn primary" id="reelSaveRating" type="button">Save rating</button>
        </div>
        <p class="fine">Your rating is saved on this device. It will be added to your rankings automatically.</p>
      </div>`);
    const score=document.getElementById('reelPostScore');
    document.querySelectorAll('[data-reel-score]').forEach(btn=>{
      btn.onclick=()=>{
        score.value=btn.dataset.reelScore;
        document.querySelectorAll('[data-reel-score]').forEach(x=>x.classList.toggle('selected',x===btn));
      };
    });
    const closePrompt=(delay=400)=>{
      promptOpenId=null;
      closeModal();
      schedulePrompt(delay);
    };
    document.getElementById('reelLater').onclick=()=>{
      postponed.add(ident);
      closePrompt();
    };
    document.getElementById('reelNotSeen').onclick=()=>{
      const entry=movies.find(x=>x.id===ident);
      if (entry) {entry.seen=false;save();render();}
      postponed.add(ident);
      closePrompt();
      toast('Removed from your watched rankings');
    };
    document.getElementById('reelSaveRating').onclick=()=>{
      const v=score.value.trim(),rating=Number(v);
      if (!v || !Number.isFinite(rating) || rating<0 || rating>10){
        toast('Choose a rating from 0 to 10');
        score.focus();return;
      }
      const entry=movies.find(x=>x.id===ident);
      if (!entry) {postponed.add(ident);closePrompt();return;}
      entry.score=Math.round(rating*10)/10;
      const note=document.getElementById('reelPostNotes').value.trim();
      if(note) entry.notes=[entry.notes,note].filter(Boolean).join('\n\n');
      entry.seen=true;
      save();
      view='rated';
      yearFilter='all';document.getElementById('yearSelect').value='all';
      query='';document.getElementById('search').value='';
      postponed.add(ident);
      closePrompt(800);
      render();
      toast('Rated ★ '+entry.score+'/10 · added to your rankings');
    };
  }
  const previousMerge=mergeCloudCatalog;
  mergeCloudCatalog=function(rows){
    const count=previousMerge(rows);
    schedulePrompt(300);
    return count;
  };
  const previousClose=closeModal;
  closeModal=function() {
    if(promptOpenId) {
      postponed.add(promptOpenId); // Close (X / Escape) means "Later" for this app session.
      promptOpenId=null;
    }
    previousClose();
    schedulePrompt(300);
  };
  // When the user opens the PWA, an existing cached screening may already be due.
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden) schedulePrompt(400);
  });
  window.addEventListener('pageshow',()=>schedulePrompt(600));

  const style=document.createElement('style');
  style.textContent=`
    .reel-postshow-hero{display:flex;gap:18px;align-items:center;margin:14px 0 18px;}
    .reel-postshow-hero h3{font-size:24px;line-height:1.2;letter-spacing:-.7px;margin:2px 0 8px;}
    .reel-postshow-hero p{color:#f2bf9c;font-size:13px;font-weight:700;margin:0 0 8px;}
    .reel-postshow-hero small{color:#b5bece;font-size:12px;line-height:1.5;}
    .reel-quick-scores{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin:-2px 0 15px;}
    .reel-quick-scores button{border-radius:10px;border:1px solid #3f485b;background:#252d3d;color:#dfe5f0;
      min-height:42px;font-weight:800;cursor:pointer;}
    .reel-quick-scores button.selected{background:#f2b18d;color:#1d1b21;border-color:#f2b18d;}
    .reel-post-actions{gap:7px;flex-wrap:wrap;}
    .reel-post-actions button{flex:1;min-width:100px;}
    @media(max-width:480px){.reel-postshow-hero h3{font-size:20px}.reel-postshow-hero img{width:76px!important;height:114px!important}
      .reel-post-actions button{font-size:12px;padding:10px 8px;}}
  `;
  document.head.appendChild(style);
  render();
  schedulePrompt(600);
})();