/* ReelRank Letterboxd import. All data stays in the iPhone's own localStorage. */
(function () {
  'use strict';
  const KEY='reelrank-letterboxd-local-v1';
  const STYLE_ID='reelrank-letterboxd-style';
  let state={loaded:false,diary:[],watchlist:[],links:{},favoriteFilmUrls:[]};
  try {
    const val=JSON.parse(localStorage.getItem(KEY)||'null');
    if(val && typeof val==='object') state=Object.assign(state,val);
  }catch(e){}
  if(!Array.isArray(state.diary))state.diary=[];
  if(!Array.isArray(state.watchlist))state.watchlist=[];
  if(!state.links || typeof state.links!=='object')state.links={};
  function persist(){
    try{localStorage.setItem(KEY,JSON.stringify(state));}
    catch(e){toast('Storage full. Please export your ReelRank backup.');}
  }
  function key(title,year){return String(year)+'|'+normName(String(title).replace(/&/g,' and '));}
  function esc(s){return escapeHtml(s==null?'':String(s));}
  function archiveUrl(u){try{let x=new URL(u);return x.protocol==='https:' && (x.hostname==='boxd.it'||x.hostname.endsWith('.letterboxd.com'))?x.href:null;}catch(e){return null;}}
  function filmFor(title,year){let k=key(title,year);return movies.find(m=>key(m.title,m.year)===k);}
  function maxDateFor(index,diaryRows){
    return diaryRows.filter(d=>Number(d[0])===index && /^\d{4}-\d\d-\d\d$/.test(d[2]||'')).reduce((latest,d)=>!latest||d[2]>latest?d[2]:latest,'');
  }
  function importArchive(data){
    if(!data || !Array.isArray(data.watched) || !Array.isArray(data.diary) || !Array.isArray(data.watchlist) || !data.watched.length)throw Error('No Letterboxd watched films found');
    let added=0,ratings=0;
    let nextOrder=Math.max(0,...movies.map(m=>Number(m.order)||0))+1;
    data.watched.forEach((w,i)=>{
      const [title,year,markedAt,url,stars]=w;
      if(typeof title!=='string'||!title.trim()||year<1888||year>2100)return;
      let m=filmFor(title,year),actual=maxDateFor(i,data.diary);
      if(!m){
        const id='letterboxd-'+key(title,year).replace(/[^a-z0-9]+/g,'-');
        m={id,title,year,date:actual||'',score:stars===null||stars===''?null:Math.round(Number(stars)*2*10)/10,notes:'',poster:'',seen:true,order:nextOrder++,source:'Letterboxd'};
        movies.push(m);added++;if(m.score!==null)ratings++;
      }else if((m.score===null||m.score===undefined||m.score==='')&&stars!==null&&stars!==''&&Number.isFinite(Number(stars))){
        m.score=Math.round(Number(stars)*2*10)/10;ratings++;
      }
      if(actual && !m.date && !String(m.source||'').startsWith('AMC')) m.date=actual;
      const safe=archiveUrl(url);
      if(safe)state.links[key(title,year)]=safe;
    });
    const knownDiary=new Set(state.diary.map(x=>x.id));
    data.diary.forEach((d)=>{
      const w=data.watched[d[0]];if(!w)return;
      const [title,year]=w;
      const id=String(d[5]||'')+'|'+key(title,year)+'|'+String(d[1])+'|'+String(d[2]);
      if(knownDiary.has(id))return;
      state.diary.push({id,key:key(title,year),title,year,createdDate:d[1]||'',watchedDate:d[2]||'',score:d[3]===null?null:Number(d[3])*2,rewatch:!!d[4],url:archiveUrl(d[5])||'',tags:d[6]||'',review:(data.reviewByUri||{})[d[5]]||''});
      knownDiary.add(id);
    });
    const knownWatch=new Set(state.watchlist.map(x=>x.key));
    data.watchlist.forEach(w=>{
      const k=key(w[0],w[1]);if(knownWatch.has(k))return;
      state.watchlist.push({key:k,title:w[0],year:w[1],addedDate:w[2]||'',url:archiveUrl(w[3])||''});
      knownWatch.add(k);
    });
    state.favoriteFilmUrls=Array.isArray(data.favoriteFilmUrls)?data.favoriteFilmUrls.filter(x=>archiveUrl(x)):state.favoriteFilmUrls;
    state.loaded=true;state.importedAt=new Date().toISOString();state.sourceCounts={watched:data.watched.length,diary:data.diary.length,watchlist:data.watchlist.length};
    persist();save();updateYearMenu();
    if(yearFilter==='2026' && !sessionStorage.getItem('reelrank-letterboxd-year-chosen')){
      yearFilter='all';document.querySelector('#yearSelect').value='all';
    }
    render();
    toast('Imported '+added+' films · '+ratings+' ratings · '+state.diary.length+' diary entries');
  }
  // Parse RFC4180 CSV with quoted commas, embedded newlines and doubled quotes.
  function csvRows(text) {
    text=text.replace(/^\uFEFF/,'');
    const lines=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"' && text[i+1]==='"'){cell+='"';i++;}
        else if(ch==='"')quoted=false;
        else cell+=ch;
      }else if(ch==='"') quoted=true;
      else if(ch===','){row.push(cell);cell='';}
      else if(ch==='\n'||ch==='\r'){
        if(ch==='\r'&&text[i+1]==='\n')i++;
        row.push(cell);if(row.some(x=>x!==''))lines.push(row);
        row=[];cell='';
      }else cell+=ch;
      if(lines.length>100000)throw Error('This archive has too many rows');
    }
    if(quoted)throw Error('Unclosed CSV quote');
    row.push(cell);if(row.some(x=>x!==''))lines.push(row);
    if(!lines.length)return [];
    const headers=lines.shift().map(s=>s.trim());
    return lines.map(cols=>Object.fromEntries(headers.map((h,i)=>[h,cols[i]||''])));
  }
  function archiveFromCsv(entries) {
    const required=['watched.csv','ratings.csv','diary.csv','watchlist.csv'];
    const tables={};
    for(const name of [...required,'profile.csv','reviews.csv']){
      const content=entries[name];if(!content && required.includes(name))throw Error('Letterboxd export missing '+name);
      tables[name]=content?csvRows(new TextDecoder('utf-8',{fatal:true}).decode(content)):[];
    }
    const k=(t,y)=>key(t,y);
    const ratings=new Map(tables['ratings.csv'].map(r=>[k(r.Name,r.Year),r]));
    const watched=tables['watched.csv'].map(r=>{
      const match=ratings.get(k(r.Name,r.Year));
      const star=match && match.Rating!==''?Number(match.Rating):null;
      return [r.Name,Number(r.Year),r.Date,r['Letterboxd URI'],star,match?.Date||''];
    }).filter(r=>r[0]&&Number.isInteger(r[1])&&r[1]>=1888&&r[1]<=2100);
    if(!watched.length)throw Error('No watched movies found in the Letterboxd export');
    const idx=new Map(watched.map((w,i)=>[k(w[0],w[1]),i]));
    const diary=tables['diary.csv'].map(r=>[
      idx.get(k(r.Name,r.Year)),r.Date,r['Watched Date']||'',r.Rating!==''?Number(r.Rating):null,
      /^(yes|true|1)$/i.test(r.Rewatch||''),r['Letterboxd URI']||'',r.Tags||''
    ]).filter(d=>d[0]!==undefined);
    const watchlist=tables['watchlist.csv'].filter(r=>r.Name&&Number.isInteger(Number(r.Year))).map(r=>
      [r.Name,Number(r.Year),r.Date,r['Letterboxd URI']||'']);
    const profile=tables['profile.csv'][0]||{};
    const favoriteFilmUrls=(profile['Favorite Films']||'').split(/,\s*/).filter(Boolean);
    const reviewByUri={};
    for(const r of tables['reviews.csv'])if(r['Letterboxd URI']&&r.Review)reviewByUri[r['Letterboxd URI']]=r.Review;
    return {watched,diary,watchlist,favoriteFilmUrls,reviewByUri};
  }
  let loaderPromise=null;
  async function ensureZipReader() {
    if(window.fflate?.unzipSync)return window.fflate;
    if(loaderPromise)return loaderPromise;
    loaderPromise=new Promise((resolve,reject)=>{
      const tag=document.createElement('script');
      tag.src='https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
      tag.async=true;
      tag.onload=()=>window.fflate?.unzipSync?resolve(window.fflate):reject(Error('Unzip library did not load'));
      tag.onerror=()=>reject(Error('Could not load the ZIP reader. Check your connection.'));
      document.head.appendChild(tag);
    }).catch(e=>{loaderPromise=null;throw e;});
    return loaderPromise;
  }
  async function parseArchiveFile(file) {
    if(file.size>25_000_000)throw Error('The export is too large (25 MB limit)');
    if(/\.json$/i.test(file.name)){
      const j=JSON.parse(await file.text());
      return j.letterboxd&&j.watched===undefined?j.letterboxd:j;
    }
    if(!/\.zip$/i.test(file.name))throw Error('Choose the ZIP downloaded from Letterboxd');
    const fflate=await ensureZipReader();
    const raw=new Uint8Array(await file.arrayBuffer());
    let budget=35_000_000;
    const unzipped=fflate.unzipSync(raw,{filter(meta){
      const name=(meta.name||'').replace(/^.*\//,'');
      if(!/^(watched|ratings|diary|watchlist|profile|reviews)\.csv$/i.test(name))return false;
      const length=meta.originalSize||0;
      if(length>12_000_000||length>budget)throw Error('Archive CSV is unexpectedly large');
      budget-=length;return true;
    }});
    const files={};
    for(const [name,contents] of Object.entries(unzipped)){
      if(!name.includes('/') && /\.csv$/i.test(name))files[name.toLowerCase()]=contents;
    }
    return archiveFromCsv(files);
  }
  async function importSelectedFile(file){
    try {
      if(!file)return;
      const data=await parseArchiveFile(file);
      const details=data.watched.length+' watched films, '+data.diary.length+' diary entries and '+data.watchlist.length+' watchlist films';
      if(!confirm('Merge '+details+' into ReelRank? Existing scores and notes will be kept.'))return;
      importArchive(data);
      closeModal();
      toast('Letterboxd import complete. Your collection is editable.');
    } catch(err){
      console.error('Letterboxd import failed',err);
      alert('Could not import Letterboxd: '+(err?.message||'Unknown error'));
    }
  }
  const css=[
    '.lb-panel{margin:16px 0 45px;min-height:260px}',
    '.lb-heading{padding:24px 22px;border-radius:22px;background:linear-gradient(130deg,#292137,#192333);border:1px solid #534463;margin-bottom:17px}',
    '.lb-heading h2{font-size:29px;letter-spacing:-1.2px;margin:6px 0 8px}',
    '.lb-heading p{color:#b9bed0;margin:0;line-height:1.6;font-size:13px}',
    '.lb-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 7px}',
    '.lb-list{display:grid;gap:10px}',
    '.lb-row{display:flex;align-items:center;gap:13px;justify-content:space-between;background:#1c2431;border:1px solid #354052;border-radius:16px;padding:14px 16px}',
    '.lb-row strong{font-size:14px;line-height:1.4;display:block;color:#f5eef5}',
    '.lb-row small{font-size:11px;color:#a8b3c6;display:block;margin-top:5px;line-height:1.55}',
    '.lb-row aside{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}',
    '.lb-row .btn{min-height:37px;padding:9px 10px;font-size:11px}',
    '.lb-pill{display:inline-block;padding:3px 7px;border-radius:12px;background:#483b58;color:#e5c8f2;font-size:10px;margin-left:5px}',
    '.lb-empty{background:#202638;border:1px solid #424257;border-radius:16px;padding:35px;text-align:center;color:#b9bcd0}',
    '@media(max-width:700px){.tabs{overflow-x:auto;justify-content:flex-start;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}.tabs .tab{flex:0 0 auto;min-width:98px}.lb-row{flex-direction:column;align-items:stretch}.lb-row aside{justify-content:flex-start}.lb-heading h2{font-size:26px}}'
  ].join('\n');
  if(!document.getElementById(STYLE_ID)){const st=document.createElement('style');st.id=STYLE_ID;st.textContent=css;document.head.appendChild(st);}
  const tabs=document.querySelector('.tabs');
  ['diary','watchlist'].forEach((name)=>{
    if(document.getElementById('tab-'+name))return;
    const b=document.createElement('button');
    b.type='button';b.className='tab';b.id='tab-'+name;b.dataset.view=name;b.setAttribute('role','tab');
    b.textContent=name==='diary'?'✦ Diary':'♡ Watchlist';
    b.onclick=()=>{view=name;document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view===name));render();};
    tabs.appendChild(b);
  });
  const page=document.createElement('section');page.id='lbPanel';page.className='lb-panel hide';
  document.querySelector('#battleDashboard').after(page);
  function filmButton(title,year){
    const m=filmFor(title,year);
    return m?'<button class="btn" data-lb-film="'+esc(m.id)+'" type="button">View movie</button>':'';
  }
  function diaryHtml(){
    const rows=state.diary.slice().sort((a,b)=>(b.watchedDate||'').localeCompare(a.watchedDate||'')||(b.createdDate||'').localeCompare(a.createdDate||''));
    const cards=rows.map(d=>{
      const idx=state.diary.findIndex(x=>x.id===d.id);
      return '<article class="lb-row"><div><strong>'+esc(d.title)+' <small style="display:inline;color:#d1b8cb">('+esc(d.year)+')</small></strong>'+
        '<small>'+esc(d.watchedDate||'Date not recorded')+' · '+(d.score===null?'Unrated':esc(d.score)+' / 10')+
        (d.rewatch?'<span class="lb-pill">Rewatch</span>':'')+(d.tags?' · '+esc(d.tags):'')+'</small>'+
        (d.review?'<small>'+esc(d.review)+'</small>':'')+'</div><aside>'+
        filmButton(d.title,d.year)+'<button class="btn" data-lb-diary-edit="'+idx+'">Edit</button>'+
        '<button class="btn" data-lb-diary-remove="'+idx+'">Remove</button></aside></article>';
    }).join('');
    return '<div class="lb-heading"><div class="eyebrow">LETTERBOXD VIEWING LOG</div><h2>Your diary.</h2><p>Every logged viewing, including rewatches. All entries are editable and saved on this device.</p></div>'+
      '<div class="lb-actions"><strong>'+state.diary.length+' entries</strong><button class="btn primary" id="lbAddDiary">+ Add entry</button></div>'+
      '<div class="lb-list">'+(cards||'<div class="lb-empty">No diary entries yet.</div>')+'</div>';
  }
  function watchHtml(){
    const sorted=state.watchlist.slice().sort((a,b)=>a.title.localeCompare(b.title));
    const cards=sorted.map(w=>{
      const idx=state.watchlist.findIndex(x=>x.key===w.key);
      return '<article class="lb-row"><div><strong>'+esc(w.title)+' ('+esc(w.year)+')</strong><small>Added '+esc(w.addedDate||'date unknown')+'</small></div>'+
      '<aside><button class="btn primary" data-lb-watched="'+idx+'">Mark watched</button><button class="btn" data-lb-watch-remove="'+idx+'">Remove</button>'+
      (w.url?'<a class="btn" href="'+esc(w.url)+'" target="_blank" rel="noopener noreferrer">Letterboxd ↗</a>':'')+'</aside></article>';
    }).join('');
    return '<div class="lb-heading"><div class="eyebrow">YOUR NEXT WATCH</div><h2>Watchlist.</h2><p>Movies you want to see. Kept separate from your watched collection and rankings.</p></div>'+
      '<div class="lb-actions"><strong>'+state.watchlist.length+' saved films</strong><button class="btn primary" id="lbAddWatch">+ Add a movie</button></div>'+
      '<div class="lb-list">'+(cards||'<div class="lb-empty">Your watchlist is empty.</div>')+'</div>';
  }
  function redrawLB(){
    const chosen=view==='diary'||view==='watchlist';
    page.classList.toggle('hide',!chosen);
    document.querySelector('.search-row').classList.toggle('hide',chosen);
    if(!chosen)return;
    document.querySelector('#grid').classList.add('hide');
    document.querySelector('#yearDashboard').classList.add('hide');
    document.querySelector('#battleDashboard').classList.add('hide');
    document.querySelector('.count-row').classList.add('hide');
    document.querySelector('#rankingBar').classList.add('hide');
    page.innerHTML=view==='diary'?diaryHtml():watchHtml();
    page.querySelectorAll('[data-lb-film]').forEach(b=>b.onclick=()=>openEdit(b.dataset.lbFilm));
    if(view==='diary'){
      page.querySelector('#lbAddDiary').onclick=()=>editDiary(-1);
      page.querySelectorAll('[data-lb-diary-edit]').forEach(b=>b.onclick=()=>editDiary(Number(b.dataset.lbDiaryEdit)));
      page.querySelectorAll('[data-lb-diary-remove]').forEach(b=>b.onclick=()=>{
        const i=Number(b.dataset.lbDiaryRemove);
        if(!confirm('Remove this diary entry?'))return;
        state.diary.splice(i,1);persist();render();
      });
    }else{
      page.querySelector('#lbAddWatch').onclick=addWatch;
      page.querySelectorAll('[data-lb-watch-remove]').forEach(b=>b.onclick=()=>{
        state.watchlist.splice(Number(b.dataset.lbWatchRemove),1);persist();render();
      });
      page.querySelectorAll('[data-lb-watched]').forEach(b=>b.onclick=()=>{
        const i=Number(b.dataset.lbWatched),w=state.watchlist[i];if(!w)return;
        let m=filmFor(w.title,w.year);
        if(!m){
          m={id:'letterboxd-watched-'+Date.now(),title:w.title,year:w.year,date:new Date().toISOString().slice(0,10),score:null,notes:'',poster:'',seen:true,order:Math.max(0,...movies.map(x=>x.order||0))+1,source:'Marked watched'};
          movies.push(m);
        }else m.seen=true;
        state.watchlist.splice(i,1);persist();save();updateYearMenu();render();toast('Moved to your collection');
      });
    }
  }
  function editDiary(i){
    const old=i>=0?state.diary[i]:null;
    const opts=movies.filter(m=>m.seen!==false).sort((a,b)=>a.title.localeCompare(b.title)).map(m=>
      '<option value="'+esc(key(m.title,m.year))+'"'+(old&&old.key===key(m.title,m.year)?' selected':'')+'>'+esc(m.title)+' ('+esc(m.year)+')</option>').join('');
    openModal(i<0?'Add diary entry':'Edit diary entry',
      '<label class="field">Movie<select id="lbMovie">'+opts+'</select></label>'+
      '<label class="field">Date watched<input type="date" id="lbDate" value="'+esc(old?.watchedDate||new Date().toISOString().slice(0,10))+'"></label>'+
      '<label class="field">Rating /10 (optional)<input type="number" min="0" max="10" step="0.5" id="lbScore" value="'+esc(old?.score??'')+'"></label>'+
      '<label class="field"><input type="checkbox" id="lbRewatch" '+(old?.rewatch?'checked':'')+'> Rewatch</label>'+
      '<label class="field">Notes<input id="lbReview" maxlength="2000" value="'+esc(old?.review||'')+'"></label>'+
      '<div class="dialog-actions"><button class="btn primary" id="lbSaveDiary">Save entry</button></div>');
    document.getElementById('lbSaveDiary').onclick=()=>{
      const k=document.getElementById('lbMovie').value,m=movies.find(x=>key(x.title,x.year)===k);
      const d=document.getElementById('lbDate').value,v=document.getElementById('lbScore').value.trim();
      if(!m||!d||v && (!Number.isFinite(+v)||+v<0||+v>10)){toast('Check the movie, date and score');return;}
      const record=Object.assign({},old||{}, {id:old?.id||'local-'+Date.now(),key:k,title:m.title,year:m.year,watchedDate:d,
        score:v?Number(v):null,rewatch:document.getElementById('lbRewatch').checked,review:document.getElementById('lbReview').value});
      if(i>=0)state.diary[i]=record;else state.diary.push(record);
      persist();closeModal();render();toast('Diary saved');
    };
  }
  function addWatch(){
    openModal('Add to watchlist',
      '<label class="field">Title<input id="lbWatchTitle" maxlength="200" placeholder="Movie title"></label>'+
      '<label class="field">Release year<input id="lbWatchYear" type="number" min="1888" max="2100" value="'+new Date().getFullYear()+'"></label>'+
      '<div class="dialog-actions"><button class="btn primary" id="lbSaveWatch">Add to watchlist</button></div>');
    document.getElementById('lbSaveWatch').onclick=()=>{
      const title=document.getElementById('lbWatchTitle').value.trim(),year=Number(document.getElementById('lbWatchYear').value),k=key(title,year);
      if(!title||!Number.isInteger(year)||year<1888||year>2100){toast('Enter a title and valid year');return;}
      if(state.watchlist.some(w=>w.key===k)){toast('Already on your watchlist');return;}
      state.watchlist.push({key:k,title,year,addedDate:new Date().toISOString().slice(0,10),url:''});
      persist();closeModal();render();toast('Added to watchlist');
    };
  }
  const originalRender=render;
  render=function(){originalRender();redrawLB();};
  const previousOpenEdit=openEdit;
  openEdit=function(id){
    previousOpenEdit(id);
    const m=movies.find(x=>x.id===id);if(!m)return;
    const filmUrl=state.links[key(m.title,m.year)],count=state.diary.filter(d=>d.key===key(m.title,m.year)).length;
    if(!filmUrl && !count)return;
    const wrap=document.createElement('div');wrap.className='fine';wrap.style.marginTop='12px';
    if(filmUrl)wrap.innerHTML='<a href="'+esc(filmUrl)+'" target="_blank" rel="noopener noreferrer">View this film on Letterboxd ↗</a>';
    if(count)wrap.innerHTML+='<p>Letterboxd diary: '+count+' logged '+(count===1?'viewing':'viewings')+'. See Diary for details.</p>';
    document.querySelector('#dialogContent').appendChild(wrap);
  };
  const previousSettings=openSettings;
  openSettings=function(){
    previousSettings();
    const el=document.querySelector('#dialogContent');
    el.insertAdjacentHTML('beforeend','<div class="sync-box" style="margin-top:20px"><strong>Letterboxd archive</strong><p>'+
      (state.loaded?esc(state.sourceCounts?.watched||0)+' watched films · '+state.diary.length+' diary entries · '+state.watchlist.length+' watchlist films saved on this device.':'Import your Letterboxd ZIP here. Your files and ratings never leave your device.')+
      ' Your edits stay on this device, and are not overwritten by catalog refreshes.</p>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="lbGoDiary">View diary</button><button class="btn" id="lbGoWatch">View watchlist</button>'+
      '<button class="btn primary" id="lbRetry">↑ Import Letterboxd ZIP</button><input type="file" id="lbZipFile" accept=".zip,.json,application/zip,application/json" style="display:none"></div></div>');
    document.getElementById('lbGoDiary').onclick=()=>{closeModal();view='diary';document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view==='diary'));render();};
    document.getElementById('lbGoWatch').onclick=()=>{closeModal();view='watchlist';document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.view==='watchlist'));render();};
    document.getElementById('lbRetry').onclick=()=>document.getElementById('lbZipFile').click();
    document.getElementById('lbZipFile').onchange=e=>{const file=e.target.files?.[0];void importSelectedFile(file);};
    // Ensure the app's existing backup includes all imported diary/watchlist edits.
    document.getElementById('exportBtn').onclick=()=>{
      const data={version:4,movies,posterCache,awards:awardChoices,battleData,letterboxd:state,exportedAt:new Date().toISOString()};
      const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='reelrank-full-backup.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),5000);toast('Full backup exported');
    };
    const input=document.getElementById('importInput'),baseHandler=input.onchange;
    input.onchange=async(e)=>{
      const file=e.target.files?.[0];if(!file)return;
      let parsed;try{parsed=JSON.parse(await file.text());}catch(err){toast('Invalid backup');return;}
      if(parsed.letterboxd&&Array.isArray(parsed.letterboxd.diary)&&Array.isArray(parsed.letterboxd.watchlist)){
        state=parsed.letterboxd;persist();
      }
      await baseHandler(e);
      redrawLB();
    };
  };
  document.querySelector('#settingsBtn').onclick=openSettings;
  document.querySelector('#yearSelect').addEventListener('change',()=>{sessionStorage.setItem('reelrank-letterboxd-year-chosen','1');});
  render();
})();