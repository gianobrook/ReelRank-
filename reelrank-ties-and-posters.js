/* ReelRank: verified film posters + drag-to-reorder tied ratings. */
(function () {
  'use strict';

  const MIGRATION_KEY = 'reelrank-verified-posters-2026-v1';
  const posterId = m => String(m.year) + '|' + normName(m.title);
  // Old poster matching sometimes chose book covers, press photos, or unrelated films.
  // Invalidate only auto-generated artwork. Movie scores, notes and ranking order stay intact.
  if (localStorage.getItem(MIGRATION_KEY) !== '1') {
    posterCache = {};
    localStorage.setItem(POSTER_CACHE_KEY, '{}');
    localStorage.setItem(MIGRATION_KEY, '1');
  }
  // A verified, freely hosted film poster for a previously misidentified movie.
  const VERIFIED_POSTERS = {
    '2023|oppenheimer': 'https://commons.wikimedia.org/wiki/Special:FilePath/Oppenheimer_(film).jpg'
  };
  const inFlight = new Map();
  const posterFor = m => {
    if (m.posterManual && m.poster) return m.poster;
    if (typeof posterCache[posterId(m)] === 'string' && posterCache[posterId(m)]) return posterCache[posterId(m)];
    return '';
  };
  const cachePoster = (m, url) => {
    posterCache[posterId(m)] = url || '';
    try { localStorage.setItem(POSTER_CACHE_KEY, JSON.stringify(posterCache)); }
    catch(e) { toast('Phone storage full. Export a backup.'); }
  };

  function correctPage(page, m) {
    if (!page || page.missing || !page.title) return false;
    const base = page.title.replace(/\s*\([^)]*\)\s*$/, '');
    const expected = normName(m.title);
    if (normName(base) !== expected) return false;
    const description = (page.terms?.description || []).join(' ');
    const film = /\b(film|movie|motion picture)\b/i.test(description) || /\bfilm\b/i.test(page.title);
    if (!film) return false;
    // Avoid the biggest source of false matches: same title, different film.
    const year = description.match(/\b(?:18|19|20)\d{2}\b/);
    if (year && Number(year[0]) !== Number(m.year)) return false;
    return true;
  }

  async function wikipediaPage(m, title) {
    const u = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&' +
      'prop=pageimages|pageterms|pageprops&piprop=thumbnail&pithumbsize=700&pilicense=any&' +
      'wbptterms=description&ppprop=wikibase_item&titles=' + encodeURIComponent(title);
    const data = await fetchJson(u).catch(() => null);
    return Object.values(data?.query?.pages || {})[0] || null;
  }

  async function wikidataFilmPoster(page) {
    const id = page?.pageprops?.wikibase_item;
    if (!/^Q\d+$/.test(id || '')) return '';
    const url = 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&ids=' +
      encodeURIComponent(id) + '&props=claims';
    const data = await fetchJson(url).catch(() => null);
    const filename = data?.entities?.[id]?.claims?.P3383?.[0]?.mainsnak?.datavalue?.value;
    return typeof filename === 'string' && /\.(jpe?g|png|webp)$/i.test(filename)
      ? 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(filename) : '';
  }

  async function lookupVerifiedPoster(m) {
    const pinned = VERIFIED_POSTERS[posterId(m)];
    if (pinned) return pinned;
    const candidates = [
      m.title + ' (' + m.year + ' film)',
      m.title + ' (film)',
      m.title
    ];
    const checked = new Set();
    let validNoImage = [];
    for (const title of candidates) {
      if (checked.has(title)) continue;
      checked.add(title);
      const page = await wikipediaPage(m, title);
      if (!correctPage(page, m)) continue;
      if (page.thumbnail?.source && !/\.svg(?:\?|$)/i.test(page.thumbnail.source))
        return page.thumbnail.source;
      validNoImage.push(page);
    }
    // P3383 is Wikidata's dedicated "film poster" field. P18 is not; it can be a still.
    for (const page of validNoImage) {
      const poster = await wikidataFilmPoster(page);
      if (poster) return poster;
    }
    return '';
  }

  // Render only verified art or a poster the user explicitly chose.
  // Never re-display old, unverified IMDb/AMC/Wikipedia auto matches.
  const oldCard = card;
  card = function(m, ranks, totalRanked) {
    const resolved = posterFor(m);
    let markup = oldCard({...m, poster:resolved}, ranks, totalRanked);
    if (canReorder(m)) {
      // Native browser dragging is intentionally disabled. A floating card follows the pointer.
      markup = markup.replace('class="movie ', 'class="movie tied-sortable ');
      markup = markup.replace('<div class="handle" title="Drag to reorder">', '<div class="handle" role="button" tabindex="0" aria-label="Drag to reorder ' + escapeHtml(m.title) + ' among movies with the same score" title="Drag to reorder tied ratings">');
    }
    return markup;
  };
  const oldBattlePoster = battlePoster;
  battlePoster = m => oldBattlePoster({...m, poster:posterFor(m)});
  const oldMini = renderMiniMovie;
  renderMiniMovie = (m, pos, kind) => oldMini({...m, poster:posterFor(m)}, pos, kind);
  const oldAwardCard = awardCard;
  awardCard = (icon,title,m,detail,emphasis) => oldAwardCard(icon,title,m?{...m,poster:posterFor(m)}:m,detail,emphasis);

  // The main app's lazy-loading queue calls these functions as posters enter view.
  posterQueue = [];
  running = 0;
  const queued = new Set();
  getPoster = async function(m) {
    const k = posterId(m);
    if (m.posterManual || Object.prototype.hasOwnProperty.call(posterCache,k)) return posterFor(m);
    if (inFlight.has(k)) return inFlight.get(k);
    const task = (async () => {
      const url = await lookupVerifiedPoster(m).catch(() => '');
      cachePoster(m,url);
      if (url) applyPosterToDom(m.id,url,m.title);
      return url;
    })();
    inFlight.set(k,task);
    try { return await task; }
    finally { inFlight.delete(k); }
  };
  loadPosterQueued = function(m) {
    const k = posterId(m);
    if (m.posterManual || queued.has(k) || inFlight.has(k) ||
        Object.prototype.hasOwnProperty.call(posterCache,k)) return;
    queued.add(k);
    posterQueue.push(m);
    processPosterQueue();
  };
  processPosterQueue = function() {
    while (running < 3 && posterQueue.length) {
      const m = posterQueue.shift(), k = posterId(m);
      running++;
      void getPoster(m).finally(() => {
        queued.delete(k);
        running--;
        processPosterQueue();
      });
    }
  };

  // Save whether a poster was manually chosen on seeded AMC entries too.
  // (The base app only stores a subset of their fields by default.)
  const oldSave = save;
  save = function() {
    oldSave();
    try {
      const data = JSON.parse(localStorage.getItem(STORE) || '{}');
      for (const m of movies) {
        if (!m.id.startsWith('amc-') || !data[m.id]) continue;
        if (m.posterManual) data[m.id].posterManual = true;
        else delete data[m.id].posterManual;
      }
      localStorage.setItem(STORE,JSON.stringify(data));
    } catch(e) {}
  };

  // Poster controls live in the existing movie editor.
  const oldEdit = openEdit;
  openEdit = function(id) {
    oldEdit(id);
    const m = movies.find(x => x.id === id), field = document.getElementById('editPoster');
    if (!m || !field) return;
    const group = document.createElement('div');
    group.className = 'verified-poster-tools';
    group.innerHTML = '<button type="button" class="btn" id="fixPoster">↻ Find correct poster</button>' +
      '<span>Poster not right? Find a verified match, or paste the correct image URL above. Your choice will be kept.</span>';
    field.closest('label')?.after(group);
    document.getElementById('fixPoster').onclick = async function() {
      this.disabled = true;
      this.textContent = 'Finding film poster…';
      delete posterCache[posterId(m)];
      localStorage.setItem(POSTER_CACHE_KEY,JSON.stringify(posterCache));
      const previouslyManual = Boolean(m.posterManual);
      m.posterManual = false;
      const url = await getPoster(m);
      m.posterManual = previouslyManual;
      if (url) {
        field.value = url;
        this.textContent = '✓ Poster found';
        toast('Poster found. Tap Save movie to keep it.');
      } else {
        this.textContent = 'No verified poster found';
        toast('No confirmed poster. You can paste an image URL instead.');
      }
      this.disabled = false;
    };
    const saveBtn = document.getElementById('saveEdit');
    const oldHandler = saveBtn?.onclick;
    if (saveBtn && oldHandler) saveBtn.onclick = function() {
      const incoming = field.value.trim(), old = m.poster || '';
      if (incoming !== old) {
        m.posterManual = Boolean(incoming);
        delete posterCache[posterId(m)];
      } else if (!incoming) m.posterManual = false;
      oldHandler();
    };
  };

  // Rank ties by their persistent "order" value. This does not change numeric ratings,
  // and it works even when the two cards sit on opposite sides of the top-3 podium.
  function canReorder(m) {
    return (view === 'rated' || view === 'all') && !useBattlePlacement() && hasRating(m);
  }
  function reorderTie(fromId, toId) {
    const a = movies.find(m => m.id === fromId), b = movies.find(m => m.id === toId);
    if (!a || !b || !canReorder(a) || !canReorder(b)) return false;
    if (Number(a.score) !== Number(b.score)) {
      toast('Drag onto another movie with the same rating.');
      return false;
    }
    if (fromId === toId) return false;
    const tied = movies.filter(m=>hasRating(m) && Number(m.score) === Number(a.score))
      .slice().sort(rankSorter);
    const from = tied.findIndex(m=>m.id===fromId);
    const to = tied.findIndex(m=>m.id===toId);
    if (from < 0 || to < 0) return false;
    tied.splice(to,0,tied.splice(from,1)[0]);
    tied.forEach((m,i)=>m.order=i+1);
    save();
    render();
    toast('Tied movies reordered ✓');
    return true;
  }
  const style = document.createElement('style');
  style.textContent = `
    .movie.tied-sortable .handle{display:grid;place-items:center;min-width:37px;min-height:37px;
      background:rgba(16,20,31,.94);border:1px solid rgba(255,255,255,.28);
      box-shadow:0 4px 14px #0006;touch-action:none;cursor:grab;user-select:none;}
    .movie.tied-sortable .handle:active{cursor:grabbing;}
    .movie.tied-sortable.tied-dragging{opacity:.48;}
    .movie.tied-drop-target .poster{outline:3px solid var(--coral);outline-offset:3px;}
    .ranking-tie-hint{font-size:12px;color:#bcc6d8;margin:-4px 0 19px;line-height:1.5;}
    .ranking-tie-hint strong{color:var(--gold);}
    .verified-poster-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px;}
    .verified-poster-tools span{color:#aab5c9;font-size:12px;line-height:1.5;flex:1;min-width:180px;}
    @media(max-width:700px){.movie.tied-sortable .handle{min-width:42px;min-height:42px;}}
  `;
  document.head.appendChild(style);
  const hint = document.createElement('p');
  hint.className = 'ranking-tie-hint hide';
  hint.innerHTML = '<strong>⠿ Reorder tied movies:</strong> drag the grip on a poster onto another movie with the same score. Your ratings will not change.';
  document.getElementById('rankingBar').after(hint);
  const oldRender = render;
  render = function() {
    oldRender();
    hint.classList.toggle('hide', !((view==='rated'||view==='all')&&!useBattlePlacement()));
  };

  // Pointer drag and live animated sorting are provided by reelrank-smooth-drag.js.

  // New art is requested on demand; old cached mismatches are no longer displayed.
  render();
})();
