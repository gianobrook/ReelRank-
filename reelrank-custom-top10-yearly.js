/* ReelRank: curated Top 10, editable slots, and annual top-three galleries. */
(() => {
  'use strict';
  const STORAGE = 'reelrank-top10-custom-v1';
  const UNRATED_FILTER_KEY = 'reelrank-unrated-placement-v1';
  let unratedPlacement = localStorage.getItem(UNRATED_FILTER_KEY) === 'bottom' ? 'bottom' : 'top';
  let curation = {version:1,pins:{},excluded:[]};
  try {
    const stored=JSON.parse(localStorage.getItem(STORAGE)||'null');
    if(stored && typeof stored==='object'){
      curation.pins=stored.pins&&typeof stored.pins==='object'&&!Array.isArray(stored.pins)?stored.pins:{};
      curation.excluded=Array.isArray(stored.excluded)?stored.excluded:[];
    }
  }catch(e){}
  const inLibrary = id => movies.find(m => m.id===id && m.seen!==false);
  const eligible = () => movies.filter(m => m.seen!==false);
  const hasManualPicks = () => Object.keys(curation.pins).length>0 || curation.excluded.length>0;
  function storeCuration(){
    try {localStorage.setItem(STORAGE,JSON.stringify(curation));}
    catch(e){toast('Phone storage full. Export a backup in Settings.');}
  }
  function normalizeCuration(value){
    const pins={};
    if(value?.pins && typeof value.pins==='object'&&!Array.isArray(value.pins)){
      for(const [position,id] of Object.entries(value.pins)){
        const n=Number(position);
        if(!Number.isInteger(n)||n<0||n>9||typeof id!=='string')continue;
        if(inLibrary(id)&&!Object.values(pins).includes(id))pins[n]=id;
      }
    }
    const excluded=Array.isArray(value?.excluded)?
      [...new Set(value.excluded.filter(id=>typeof id==='string'))].slice(0,1000):[];
    return {version:1,pins,excluded};
  }
  curation=normalizeCuration(curation);
  window.reelrankExportTopTen=()=>JSON.parse(JSON.stringify(curation));
  window.reelrankImportTopTen=value=>{
    curation=normalizeCuration(value);storeCuration();render();
  };

  function topTen(){
    const list=Array(10).fill(null);
    const pinned=new Set();
    for(let i=0;i<10;i++){
      const id=curation.pins[i],movie=inLibrary(id);
      if(movie && !pinned.has(id)){list[i]=movie;pinned.add(id);}
    }
    const banned=new Set(curation.excluded);
    const available=eligible().filter(m=>hasRating(m)&&!pinned.has(m.id)&&!banned.has(m.id)).sort(rankSorter);
    let next=0;
    for(let i=0;i<10;i++)if(!list[i])list[i]=available[next++]||null;
    return list.filter(Boolean);
  }
  const beforeSorted=sorted;
  sorted=function(){
    if(view!=='all'){
      const list=beforeSorted();
      if(view!=='rated' || unratedPlacement!=='bottom')return list;
      // Keep ratings and the existing ranking order intact; only move unrated cards.
      return list.filter(hasRating).concat(list.filter(m=>!hasRating(m)));
    }
    const list=topTen();
    return query.trim()?list.filter(m=>m.title.toLowerCase().includes(query.toLowerCase())):list;
  };
  const beforeScoreMap=scoreMap;
  scoreMap=function(){
    if(view!=='all')return beforeScoreMap();
    const map={};
    topTen().forEach((m,i)=>{map[m.id]=i+1;});
    return map;
  };

  function swapIntoSlot(previousId,nextId){
    const shown=topTen(),slot=shown.findIndex(m=>m.id===previousId);
    const newcomer=inLibrary(nextId);
    if(slot<0 || !newcomer || shown.some(m=>m.id===nextId))return false;
    curation.excluded=[...new Set([...curation.excluded,previousId])].filter(id=>id!==nextId);
    curation.pins[slot]=nextId;
    storeCuration();
    return true;
  }
  function resetTopTen(){
    curation={version:1,pins:{},excluded:[]};
    storeCuration();
    render();
    toast('Top 10 restored to your highest-ranked movies');
  }

  // Used by the existing live drag engine when two Top 10 movies have the same score.
  // The affected slots are pinned; other slots continue adjusting to future ratings.
  window.reelrankMoveTopTenTie=(fromId,toId)=>{
    const list=topTen();
    const from=list.findIndex(m=>m.id===fromId),to=list.findIndex(m=>m.id===toId);
    if(from<0 || to<0 || from===to)return false;
    if(!hasRating(list[from])||!hasRating(list[to]) ||
       Number(list[from].score)!==Number(list[to].score))return false;
    list.splice(to,0,list.splice(from,1)[0]);
    for(let i=Math.min(from,to);i<=Math.max(from,to);i++){
      curation.pins[i]=list[i].id;
      curation.excluded=curation.excluded.filter(id=>id!==list[i].id);
    }
    storeCuration();
    return true;
  };

  // Button added to each card, including the top-three podium cards.
  const beforeCard=card;
  card=function(movie,ranks,totalRanked){
    let html=beforeCard(movie,ranks,totalRanked);
    if(view!=='all')return html;
    const slot=topTen().findIndex(m=>m.id===movie.id);
    if(slot<0)return html;
    const action='<div class="reel-top10-card-action"><button type="button" data-top10-swap="'+escapeHtml(movie.id)+'"'+
      ' aria-label="Replace '+escapeHtml(movie.title)+' at Top 10 position '+(slot+1)+'">'+
      '<span aria-hidden="true">⇄</span> Replace #'+(slot+1)+'</button></div>';
    return html.replace('</article>',action+'</article>');
  };

  const toolbar=document.createElement('div');
  toolbar.id='reelTop10Toolbar';
  toolbar.className='reel-top10-toolbar hide';
  document.querySelector('.count-row').before(toolbar);

  const yearly=document.createElement('section');
  yearly.id='reelYearlyTopThree';
  yearly.className='reel-year-top-three hide';
  document.querySelector('.count-row').before(yearly);

  // Compact, one-tap filter in the My Rankings heading. Saved on this device.
  const countRow=document.querySelector('.count-row');
  const subtitle=document.getElementById('sectionSub');
  const countControls=document.createElement('div');
  countControls.className='reel-count-controls';
  subtitle.before(countControls);
  countControls.appendChild(subtitle);
  const unratedFilter=document.createElement('button');
  unratedFilter.id='reelUnratedFilter';
  unratedFilter.type='button';
  unratedFilter.className='reel-unrated-filter hide';
  unratedFilter.setAttribute('aria-live','polite');
  countControls.appendChild(unratedFilter);
  function updateUnratedFilter(){
    const show=view==='rated';
    unratedFilter.classList.toggle('hide',!show);
    unratedFilter.innerHTML='<span class="reel-filter-symbol" aria-hidden="true">≡</span> Unrated '+(unratedPlacement==='bottom'?'last':'first');
    unratedFilter.title='Tap to put unrated movies '+(unratedPlacement==='bottom'?'at the top':'at the bottom');
    unratedFilter.setAttribute('aria-label','Show unrated movies '+(unratedPlacement==='bottom'?'first':'last'));
    unratedFilter.setAttribute('aria-pressed',unratedPlacement==='bottom'?'true':'false');
  }
  unratedFilter.addEventListener('click',()=>{
    unratedPlacement=unratedPlacement==='bottom'?'top':'bottom';
    try{localStorage.setItem(UNRATED_FILTER_KEY,unratedPlacement);}catch(e){toast('Could not save filter preference');}
    render();
  });
  function posterUrl(m){
    return (m.posterManual&&m.poster)||
      posterCache[String(m.year)+'|'+normName(m.title)]||
      m.poster||'';
  }
  function renderYearCards(){
    const byYear=new Map();
    for(const movie of eligible()){
      if(!hasRating(movie))continue;
      const year=Number(movie.year);
      if(!Number.isInteger(year))continue;
      if(!byYear.has(year))byYear.set(year,[]);
      byYear.get(year).push(movie);
    }
    const years=[...byYear.keys()].sort((a,b)=>b-a);
    if(!years.length){yearly.classList.add('hide');return;}
    yearly.classList.remove('hide');
    yearly.innerHTML='<div class="reel-yearly-head"><div><strong>🏆 Top 3 from every year</strong>'+
      '<p>Swipe across the years. Tap one to view its full podium and rankings.</p></div></div>'+
      '<div class="reel-yearly-strip">'+years.map(year=>{
        const favorites=byYear.get(year).sort(rankSorter).slice(0,3);
        return '<article class="reel-yearly-card"><button type="button" class="reel-yearly-jump" data-year-podium="'+year+'">'+
          '<strong>'+year+'</strong><span>View '+year+' podium ↗</span></button>'+
          '<div class="reel-yearly-favorites">'+favorites.map((m,i)=>{
            const src=posterUrl(m);
            const cover=src?'<img src="'+escapeHtml(src)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">':
              '<div class="reel-yearly-cover-fallback">✦</div>';
            return '<div class="reel-yearly-movie">'+
              '<div class="reel-yearly-cover">'+cover+'<span>#'+(i+1)+'</span></div>'+
              '<strong title="'+escapeHtml(m.title)+'">'+escapeHtml(m.title)+'</strong>'+
              '<small>★ '+Number(m.score).toFixed(1)+'</small></div>';
          }).join('')+'</div></article>';
      }).join('')+'</div>';
  }
  function renderTopTenToolbar(){
    const count=topTen().length;
    toolbar.innerHTML='<div class="reel-top10-intro"><strong>YOUR ALL-TIME TOP '+count+'</strong>'+
      '<p>Replace any film with another from your library. Swaps stay saved, while unpinned spots can update when you rate new movies.</p></div>'+
      (hasManualPicks()?'<button type="button" id="reelTopTenReset" class="btn">↻ Reset to highest scores</button>':'');
    const reset=document.getElementById('reelTopTenReset');
    if(reset)reset.onclick=()=>{if(confirm('Reset your Top 10 to your highest-scored movies? Your ratings and yearly rankings will not change.'))resetTopTen();};
  }

  const beforeRender=render;
  render=function(){
    beforeRender();
    const isTopTen=view==='all',isRankings=view==='rated';
    toolbar.classList.toggle('hide',!isTopTen);
    yearly.classList.toggle('hide',!isRankings || yearFilter!=='all');
    updateUnratedFilter();
    if(isTopTen){
      renderTopTenToolbar();
      const title=document.getElementById('sectionTitle');
      if(title)title.textContent=query?'Top 10 search':'The rest of your Top 10';
      const subtitle=document.getElementById('sectionSub');
      if(subtitle)subtitle.textContent=topTen().length+' all-time favorites'+(hasManualPicks()?' · Custom picks':'');
      document.querySelector('.ranking-tie-hint')?.classList.add('hide');
    }
    if(isRankings){
      // Annual podiums should stay visible, even when some films await a rating.
      // The unrated films must remain at the very top of the grid.
      const g=document.getElementById('grid');
      const podium=g.querySelector(':scope > .reel-podium');
      if(podium && unratedPlacement==='top'){
        const pending=[...g.children].filter(el=>
          el.matches('.movie[data-id]') && !hasRating(movies.find(m=>m.id===el.dataset.id)));
        if(pending.length)pending[pending.length-1].after(podium);
      }
      if(yearFilter==='all')renderYearCards();
      const subtitle=document.getElementById('sectionSub');
      if(subtitle && sorted().some(m=>!hasRating(m))){
        subtitle.textContent=unratedPlacement==='bottom'
          ? 'Scored movies first · unrated movies last'
          : 'Unrated movies first · scored movies follow';
      }
    }
  };

  function openSwapPicker(fromId){
    const original=inLibrary(fromId),slot=topTen().findIndex(m=>m.id===fromId);
    if(!original||slot<0)return;
    const members=new Set(topTen().map(m=>m.id));
    const choices=eligible().filter(m=>!members.has(m.id))
      .slice().sort((a,b)=>{
        const ar=hasRating(a),br=hasRating(b);
        if(ar!==br)return ar?-1:1;
        if(ar&&br)return rankSorter(a,b);
        return a.title.localeCompare(b.title);
      });
    openModal('Replace #'+(slot+1)+' in your Top 10',
      '<div class="reel-swap-explainer">Choose a movie to take <strong>'+escapeHtml(original.title)+
        '</strong>\'s place. Its original rating stays exactly the same.</div>'+
      '<label class="field">Find a movie in your collection<input type="search" id="reelSwapSearch" '+
      'autocomplete="off" placeholder="Search by title or year..." aria-label="Search replacement movies"></label>'+
      '<div class="reel-swap-count" id="reelSwapCount"></div>'+
      '<div class="reel-swap-results" id="reelSwapResults" role="list"></div>'+
      '<div class="dialog-actions"><button class="btn" type="button" id="reelSwapCancel">Cancel</button></div>');
    const field=document.getElementById('reelSwapSearch'),results=document.getElementById('reelSwapResults');
    document.getElementById('reelSwapCancel').onclick=closeModal;
    function update(){
      const q=normName(field.value.trim());
      const found=q?choices.filter(m=>normName(m.title).includes(q)||String(m.year).includes(q)):choices;
      const limited=found.slice(0,40);
      document.getElementById('reelSwapCount').textContent=
        found.length+' available movie'+(found.length===1?'':'s')+(found.length>40?' · showing first 40':'');
      results.innerHTML=limited.map(m=>{
        const src=posterUrl(m);
        return '<button type="button" class="reel-swap-row" role="listitem" data-swap-pick="'+escapeHtml(m.id)+'">'+
          '<span class="reel-swap-poster">'+(src?'<img src="'+escapeHtml(src)+'" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">':'✧')+'</span>'+
          '<span class="reel-swap-name"><strong>'+escapeHtml(m.title)+'</strong><small>'+escapeHtml(m.year)+
          ' · '+(hasRating(m)?'★ '+Number(m.score).toFixed(1)+' / 10':'Not rated')+'</small></span>'+
          '<span class="reel-swap-arrow" aria-hidden="true">↗</span></button>';
      }).join('') || '<div class="reel-swap-empty">No films match that search.</div>';
    }
    field.oninput=update;
    results.onclick=e=>{
      const button=e.target.closest('[data-swap-pick]');
      if(!button)return;
      if(!swapIntoSlot(fromId,button.dataset.swapPick)) {toast('Choose a different film');return;}
      closeModal();
      render();
      toast('Top 10 updated ✓');
    };
    update();
    setTimeout(()=>field.focus({preventScroll:true}),75);
  }
  document.getElementById('grid').addEventListener('click',e=>{
    const button=e.target.closest('[data-top10-swap]');
    if(!button)return;
    e.preventDefault();
    e.stopPropagation();
    openSwapPicker(button.dataset.top10Swap);
  },true);
  yearly.addEventListener('click',e=>{
    const button=e.target.closest('[data-year-podium]');
    if(!button)return;
    const year=button.dataset.yearPodium;
    yearFilter=year;
    document.getElementById('yearSelect').value=year;
    render();
    document.querySelector('.count-row').scrollIntoView({behavior:'smooth',block:'start'});
  });
  const style=document.createElement('style');
  style.textContent=`
    .reel-count-controls{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;min-width:0;}
    .reel-unrated-filter{display:inline-flex;align-items:center;justify-content:center;gap:7px;
      min-height:33px;padding:7px 10px;border:1px solid #4a536a;border-radius:10px;
      background:#232c3d;color:#e4e9f3;font-size:11px;font-weight:800;white-space:nowrap;
      transition:background .18s,border-color .18s;}
    .reel-unrated-filter:hover{background:#343b51;border-color:#9a8097;}
    .reel-unrated-filter[aria-pressed="true"]{border-color:#bea18e;color:#f6d0ad;background:#3a3037;}
    .reel-unrated-filter .reel-filter-symbol{font-size:16px;line-height:1;transform:rotate(180deg);color:#e9ba9f;}
    .reel-unrated-filter.hide{display:none!important;}
    @media(max-width:640px){.reel-count-controls{gap:7px;}.reel-count-controls .section-sub{font-size:10px;}
      .reel-unrated-filter{font-size:10px;min-height:31px;padding:6px 8px;}}
    .reel-top10-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;
      margin:5px 0 22px;padding:17px 20px;border-radius:17px;border:1px solid #6c5764;
      background:linear-gradient(120deg,#282330,#1b2534);}
    .reel-top10-intro strong{font-size:13px;color:#fcd6a7;letter-spacing:.8px;}
    .reel-top10-intro p{margin:6px 0 0;color:#bcc5d3;font-size:12px;line-height:1.55;max-width:640px;}
    .reel-top10-toolbar .btn{flex:0 0 auto;white-space:nowrap;font-size:12px;}
    .reel-top10-card-action{margin-top:11px;}
    .reel-top10-card-action button{width:100%;min-height:38px;padding:9px 7px;border-radius:10px;
      background:#273146;border:1px solid #5f657e;color:#f3d4ba;font-weight:800;font-size:12px;}
    .reel-top10-card-action button:hover,.reel-top10-card-action button:focus-visible{background:#414057;}
    .reel-year-top-three{margin:4px 0 25px;min-width:0;}
    .reel-yearly-head strong{font-size:18px;letter-spacing:-.4px;}
    .reel-yearly-head p{font-size:12px;color:#a9b5c7;margin:7px 0 14px;}
    .reel-yearly-strip{display:flex;gap:13px;overflow-x:auto;overscroll-behavior-x:contain;
      scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;padding:2px 3px 15px;}
    .reel-yearly-card{flex:0 0 295px;min-width:0;background:#1b2232;border:1px solid #384256;
      border-radius:16px;padding:13px 13px 15px;scroll-snap-align:start;}
    .reel-yearly-jump{width:100%;border:0;background:transparent;color:inherit;display:flex;
      align-items:center;justify-content:space-between;padding:0 0 11px;}
    .reel-yearly-jump strong{font-size:19px;color:#ffd0a2;}
    .reel-yearly-jump span{font-size:11px;color:#d8c2e5;}
    .reel-yearly-favorites{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;}
    .reel-yearly-movie{min-width:0;}
    .reel-yearly-cover{height:114px;position:relative;overflow:hidden;border-radius:7px;
      background:linear-gradient(145deg,#393047,#24384d);display:grid;place-items:center;}
    .reel-yearly-cover img{width:100%;height:100%;object-fit:cover;}
    .reel-yearly-cover span{position:absolute;top:5px;left:5px;background:#151725e8;
      border-radius:7px;padding:4px 6px;font-size:11px;font-weight:900;}
    .reel-yearly-cover-fallback{font-size:29px;color:#bf9fca;}
    .reel-yearly-movie>strong{display:block;font-size:11px;line-height:1.3;margin-top:7px;
      overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:28px;}
    .reel-yearly-movie>small{display:block;color:#f8d39d;font-size:10px;margin-top:4px;font-weight:800;}
    .reel-swap-explainer{font-size:13px;color:#abb9ce;line-height:1.5;margin:3px 0 17px;}
    .reel-swap-explainer strong{color:#fff;}
    .reel-swap-count{font-size:11px;color:#acb5c8;margin:8px 0;}
    .reel-swap-results{display:grid;gap:7px;overflow-y:auto;max-height:min(55vh,475px);
      overscroll-behavior:contain;padding-right:4px;}
    .reel-swap-row{display:flex;align-items:center;gap:12px;text-align:left;min-width:0;
      width:100%;min-height:67px;background:#222a39;border:1px solid #384456;
      padding:7px 11px;border-radius:12px;color:#fff;}
    .reel-swap-row:focus-visible,.reel-swap-row:hover{border-color:#ebbca0;background:#2d3547;}
    .reel-swap-poster{display:grid;place-items:center;flex:0 0 35px;width:35px;height:51px;
      overflow:hidden;background:#373448;border-radius:5px;color:#bca5d1;}
    .reel-swap-poster img{width:100%;height:100%;object-fit:cover;}
    .reel-swap-name{min-width:0;flex:1;}
    .reel-swap-name strong{display:block;font-size:13px;line-height:1.35;white-space:normal;}
    .reel-swap-name small{display:block;color:#bfbbcf;font-size:11px;margin-top:5px;}
    .reel-swap-arrow{color:#f5c8a4;font-size:18px;}
    .reel-swap-empty{border:1px dashed #485366;color:#bdc5d2;border-radius:12px;
      padding:20px;text-align:center;}
    @media(max-width:650px){.reel-top10-toolbar{align-items:stretch;flex-direction:column;padding:14px;}
      .reel-top10-toolbar .btn{width:100%;}.reel-yearly-card{flex-basis:265px;}
      .reel-yearly-cover{height:102px;}}
  `;
  document.head.appendChild(style);
  render();
})();