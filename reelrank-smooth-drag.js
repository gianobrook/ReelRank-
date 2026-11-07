/* ReelRank live, animated sorting for tied ratings; remove anniversary duplication and battle UI. */
(() => {
  'use strict';

  const isAnniversaryReRelease = movie => {
    const title = normName(typeof movie === 'string' ? movie : movie?.title);
    if (!title.includes('revenge of the sith')) return false;
    const clearlyReissued = /(?:20th|20 year|anniversary|re release|rerelease|re issue|reissue|2025)/.test(title);
    const reissueYear = Number(movie?.year ?? movie?.release_year) === 2025;
    return clearlyReissued || reissueYear;
  };

  // Remove the re-release from the saved collection; the original 2005 entry is untouched.
  function removeAnniversaryDuplicate() {
    const duplicates = movies.filter(isAnniversaryReRelease);
    if (!duplicates.length) return false;
    for (const duplicate of duplicates) {
      const idx = movies.indexOf(duplicate);
      if (idx !== -1) movies.splice(idx, 1);
    }
    save();
    updateYearMenu();
    return true;
  }

  // The connected AMC catalog refreshes automatically. Prevent it from re-adding the duplicate.
  const mergeBefore = mergeCloudCatalog;
  mergeCloudCatalog = function(rows) {
    return mergeBefore(Array.isArray(rows) ? rows.filter(row => !isAnniversaryReRelease(row)) : rows);
  };

  // Old Letterboxd files or backups might re-introduce the anniversary entry.
  const previousRender = render;
  let cleaning = false;
  render = function() {
    if (!cleaning && movies.some(isAnniversaryReRelease)) {
      cleaning = true;
      try { removeAnniversaryDuplicate(); } finally { cleaning = false; }
    }
    return previousRender();
  };
  removeAnniversaryDuplicate();

  // Battle is retired, without erasing saved ratings or forcing a rebattle.
  const battleTab = document.getElementById('tab-battle');
  battleTab?.remove();
  const battleBar = document.getElementById('rankingBar');
  if (battleBar) battleBar.style.display = 'none';
  const battlePanel = document.getElementById('battleDashboard');
  if (battlePanel) battlePanel.classList.add('hide');
  if (battleData.rankingMode !== 'score') {
    battleData.rankingMode = 'score';
    saveBattleData();
  }
  useBattlePlacement = () => false;
  if (view === 'battle') view = 'rated';

  const grid = document.getElementById('grid');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isSortable = m => m && hasRating(m) && (view === 'rated' || view === 'all');
  const movieById = id => movies.find(m => m.id === id);

  // If the selected card was positioned in the podium, its ghost still floats independently.
  // Other cards settle smoothly into their new locations using FLIP animations.
  function snapshotRects() {
    const rects = new Map();
    const limit = innerHeight * 1.6;
    grid.querySelectorAll('.movie[data-id]').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.bottom >= -limit && r.top <= innerHeight + limit)
        rects.set(el.dataset.id,{x:r.left,y:r.top,w:r.width,h:r.height});
    });
    return rects;
  }
  function animateNewPositions(before) {
    if (reducedMotion) return;
    grid.querySelectorAll('.movie[data-id]').forEach(el => {
      const old = before.get(el.dataset.id);
      if (!old) return;
      const next = el.getBoundingClientRect();
      const dx = old.x - next.left, dy = old.y - next.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([
        {transform:'translate3d(' + dx + 'px,' + dy + 'px,0)'},
        {transform:'translate3d(0,0,0)'}
      ],{duration:280,easing:'cubic-bezier(0.22,1,0.36,1)'});
    });
  }
  function reorderTied(fromId, toId) {
    const source = movieById(fromId), target = movieById(toId);
    if (!isSortable(source) || !isSortable(target) ||
        Number(source.score) !== Number(target.score) || fromId === toId) return false;

    const siblings = movies.filter(m=>hasRating(m) && Number(m.score) === Number(source.score))
      .slice().sort(rankSorter);
    const from = siblings.findIndex(m=>m.id===fromId);
    const to = siblings.findIndex(m=>m.id===toId);
    if (from < 0 || to < 0 || from === to) return false;

    const before = snapshotRects();
    siblings.splice(to,0,siblings.splice(from,1)[0]);
    siblings.forEach((m,i)=>{m.order=i+1;});
    render();
    if (active && active.source === fromId) {
      grid.querySelectorAll('.movie[data-id]').forEach(el => {
        if (el.dataset.id === fromId) el.classList.add('tied-source-placeholder');
      });
    }
    animateNewPositions(before);
    return true;
  }

  const style = document.createElement('style');
  style.textContent = `
    .movie.tied-sortable .handle{display:grid;place-items:center;touch-action:none;
      cursor:grab;-webkit-user-select:none;user-select:none;}
    .movie.tied-source-placeholder{opacity:.20;transition:opacity .1s;}
    .movie.tied-source-placeholder .poster{border-style:dashed;}
    .reel-drag-ghost{position:fixed;left:0;top:0;z-index:10000;pointer-events:none;
      margin:0!important;transform-origin:center center;will-change:transform,opacity;
      filter:drop-shadow(0 18px 32px rgba(0,0,0,.65));}
    .reel-drag-ghost .poster{box-shadow:0 0 0 2px var(--coral),0 14px 35px #0008;}
    .reel-drag-ghost .handle,.reel-drag-ghost .updown{display:none!important;}
    .reel-drag-ghost .score-input{pointer-events:none;}
    .movie.tied-sortable .handle:focus-visible{outline:2px solid var(--gold);outline-offset:3px;}
    @media(prefers-reduced-motion:reduce){.reel-drag-ghost{filter:none;}}
  `;
  document.head.appendChild(style);

  // Native HTML drag gives a low-resolution ghost and jumpy drop. Use Pointer Events instead.
  // Capturing pointer on this stable grid avoids losing tracking when the cards rerender.
  let active = null;
  let raf = 0;
  function ghostFrame() {
    raf = 0;
    if (!active) return;
    const d = active;
    const left = d.x-d.offsetX, top = d.y-d.offsetY;
    d.float.style.transform =
      'translate3d(' + left + 'px,' + top + 'px,0) rotate(1deg) scale(1.045)';
  }
  function moveGhost() {
    if (!raf) raf = requestAnimationFrame(ghostFrame);
  }
  function duplicateCard(cardEl) {
    const clone = cardEl.cloneNode(true);
    clone.removeAttribute('data-id');
    clone.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
    clone.querySelectorAll('input,button').forEach(node=>{node.disabled=true;node.tabIndex=-1;});
    clone.classList.remove('tied-source-placeholder','tied-sortable');
    clone.classList.add('reel-drag-ghost');
    const r = cardEl.getBoundingClientRect();
    clone.style.width = r.width + 'px';
    clone.style.height = r.height + 'px';
    document.body.appendChild(clone);
    return clone;
  }
  function sameScoreTarget(x,y) {
    if (!active) return '';
    const el = document.elementFromPoint(x,y)?.closest('.movie[data-id]');
    const id = el?.dataset.id;
    if (!id || id === active.source) return '';
    const movie = movieById(id);
    return movie && hasRating(movie) && Number(movie.score) === active.score ? id : '';
  }
  function updateReorder() {
    if (!active) return;
    const to = sameScoreTarget(active.x,active.y);
    if (!to || to === active.lastTarget) return;
    const now = performance.now();
    if (now - active.lastSwap < 85) return;
    active.lastTarget=to;
    active.lastSwap=now;
    if (reorderTied(active.source,to)) active.changed=true;
  }
  function scrollSpeed(y) {
    const edge = Math.min(115,Math.max(75,innerHeight*.13));
    if (y < edge) return -Math.min(20,Math.max(0,(edge-y)*.21));
    if (y > innerHeight-edge) return Math.min(20,Math.max(0,(y-(innerHeight-edge))*.21));
    return 0;
  }
  function runScroll() {
    if (!active) return;
    const amount = scrollSpeed(active.y);
    if (amount) {
      const before=window.scrollY;
      window.scrollBy(0,amount);
      if (before !== window.scrollY) updateReorder();
    }
    active.scrollTimer = requestAnimationFrame(runScroll);
  }
  function startDrag(e,handle) {
    if (active || (!e.isPrimary && e.pointerType !== 'mouse')) return;
    const cardEl=handle.closest('.movie[data-id]');
    const m=movieById(cardEl?.dataset.id);
    if (!cardEl || !isSortable(m)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const rect=cardEl.getBoundingClientRect();
    const floating=duplicateCard(cardEl);
    active={
      pointerId:e.pointerId,
      source:m.id,
      score:Number(m.score),
      x:e.clientX,
      y:e.clientY,
      offsetX:e.clientX-rect.left,
      offsetY:e.clientY-rect.top,
      float:floating,
      changed:false,
      lastTarget:'',
      lastSwap:0,
      scrollTimer:0
    };
    cardEl.classList.add('tied-source-placeholder');
    grid.style.cursor='grabbing';
    document.body.classList.add('reel-is-dragging');
    try {grid.setPointerCapture(e.pointerId);}catch(err){}
    moveGhost();
    active.scrollTimer=requestAnimationFrame(runScroll);
  }
  function finishDrag(e) {
    if (!active || e.pointerId !== active.pointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const done=active;
    active=null;
    if (raf) {cancelAnimationFrame(raf);raf=0;}
    cancelAnimationFrame(done.scrollTimer);
    try {if(grid.hasPointerCapture(e.pointerId))grid.releasePointerCapture(e.pointerId);}catch(err){}
    grid.style.cursor='';
    document.body.classList.remove('reel-is-dragging');
    if (done.changed) {
      save();
      toast('Ranking order saved ✓');
    }
    const destination=grid.querySelectorAll('.movie[data-id]');
    let finalCard;
    for (const el of destination) if (el.dataset.id===done.source){finalCard=el;break;}
    const ghost=done.float;
    if (!finalCard || reducedMotion) {
      ghost.remove();
      finalCard?.classList.remove('tied-source-placeholder');
      return;
    }
    const r=finalCard.getBoundingClientRect();
    ghost.style.transition='transform 190ms cubic-bezier(.2,.9,.2,1), opacity 190ms ease';
    ghost.style.transform='translate3d('+r.left+'px,'+r.top+'px,0) rotate(0) scale(1)';
    ghost.style.opacity='.85';
    setTimeout(()=>{
      ghost.remove();
      finalCard.classList.remove('tied-source-placeholder');
    },205);
  }

  grid.addEventListener('pointerdown',e=>{
    const handle=e.target.closest('.tied-sortable .handle');
    if (!handle) return;
    startDrag(e,handle);
  },true);
  grid.addEventListener('pointermove',e=>{
    if (!active || e.pointerId!==active.pointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    active.x=e.clientX;
    active.y=e.clientY;
    moveGhost();
    updateReorder();
  },{capture:true,passive:false});
  grid.addEventListener('pointerup',finishDrag,true);
  grid.addEventListener('pointercancel',finishDrag,true);
  grid.addEventListener('lostpointercapture',e=>{
    if(active&&active.pointerId===e.pointerId) finishDrag(e);
  });
  grid.addEventListener('dragstart',e=>{
    if (e.target.closest('.tied-sortable')) e.preventDefault();
  },true);

  // Arrow keys move a tied movie one slot with the same animation.
  grid.addEventListener('keydown',e=>{
    if (!e.target.closest('.tied-sortable .handle')) return;
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const id=e.target.closest('.movie[data-id]')?.dataset.id;
    const m=movieById(id);
    if (!m || !isSortable(m)) return;
    const siblings=movies.filter(x=>hasRating(x)&&Number(x.score)===Number(m.score)).sort(rankSorter);
    const idx=siblings.findIndex(x=>x.id===id);
    const delta=e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:1;
    const next=siblings[idx+delta];
    if (next && reorderTied(id,next.id)) {
      save();
      grid.querySelectorAll('.movie[data-id]').forEach(el=>{
        if (el.dataset.id===id) el.querySelector('.handle')?.focus();
      });
    }
  },true);

  // Make the on-screen hint accurate and preserve the automatic poster flow.
  const hint = document.querySelector('.ranking-tie-hint');
  if (hint) hint.innerHTML='<strong>⠿ Reorder tied movies:</strong> hold the grip and move a movie anywhere on screen. Movies with the exact same score slide into place as you drag.';
  render();
})();