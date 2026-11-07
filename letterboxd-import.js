(function () {
  'use strict';
  const KEY = 'reelrank-letterboxd-v1';
  const MAX_ZIP = 12 * 1024 * 1024;
  const MAX_UNPACKED = 24 * 1024 * 1024;
  const defaults = () => ({ version: 1, diary: [], watchlist: [], filmLinks: {}, favorites: [], importedAt: null });
  let lb = defaults();
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (stored && stored.version === 1 && Array.isArray(stored.diary) && Array.isArray(stored.watchlist)) {
      lb = { ...defaults(), ...stored };
    }
  } catch (e) { /* keep blank client-local data */ }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(lb)); return true; }
    catch (e) { toast('Phone storage full. Export a backup in Settings.'); return false; }
  }
  function key(title, year) {
    return normName(title) + ':' + String(Number(year) || '');
  }
  function validYear(value) {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1888 && n <= 2100 ? n : null;
  }
  function entryKey(row) {
    return key(row.Name || row.title, row.Year || row.year);
  }
  function parseCsv(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    let rows = [], record = [], field = '', inQuote = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') {
        if (inQuote && text[i + 1] === '"') { field += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        record.push(field); field = '';
      } else if ((ch === '\r' || ch === '\n') && !inQuote) {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        record.push(field); field = '';
        if (record.some(v => v.trim())) rows.push(record);
        record = [];
      } else {
        field += ch;
      }
    }
    if (inQuote) throw Error('CSV has an unfinished quoted cell.');
    record.push(field);
    if (record.some(v => v.trim())) rows.push(record);
    if (!rows.length) return [];
    const header = rows.shift().map(s => s.trim());
    return rows.map(cells => Object.fromEntries(header.map((h, i) => [h, cells[i] || ''])));
  }
  async function zipReader(file) {
    if (file.size > MAX_ZIP) throw Error('That ZIP is too large (12 MB limit).');
    if (!window.JSZip) {
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
        s.onload = resolve; s.onerror = () => reject(Error('Could not load the ZIP reader. Connect to the internet and try again.'));
        document.head.appendChild(s);
      });
    }
    const zip = await window.JSZip.loadAsync(file, { checkCRC32: true });
    const files = {};
    let total = 0;
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir || path.includes('../')) continue;
      const name = path.split('/').pop().toLowerCase();
      if (!['watched.csv', 'ratings.csv', 'diary.csv', 'watchlist.csv', 'reviews.csv', 'profile.csv'].includes(name)) continue;
      if (path.includes('/deleted/') || path.includes('/orphaned/') || path.includes('/likes/')) continue;
      const bytes = entry._data && entry._data.uncompressedSize;
      if (bytes && bytes > 5 * 1024 * 1024) throw Error('An archive entry is too large.');
      total += bytes || 0;
      if (total > MAX_UNPACKED) throw Error('The uncompressed archive is too large.');
      const content = await entry.async('string');
      if (content.length > 5 * 1024 * 1024) throw Error('A CSV file is too large.');
      files[name] = parseCsv(content);
    }
    return files;
  }
  async function readLetterboxdFiles(files) {
    let groups = {};
    for (const f of files) {
      if (f.name.toLowerCase().endsWith('.zip')) {
        groups = { ...groups, ...(await zipReader(f)) };
      } else if (f.name.toLowerCase().endsWith('.csv')) {
        if (f.size > 5 * 1024 * 1024) throw Error('A CSV file is too large.');
        const basename = f.name.toLowerCase().split('/').pop();
        groups[basename] = parseCsv(await f.text());
      }
    }
    if (!['watched.csv', 'ratings.csv', 'diary.csv', 'watchlist.csv'].some(n => Array.isArray(groups[n]))) {
      throw Error('No Letterboxd watched, ratings, diary or watchlist CSV found.');
    }
    return groups;
  }
  function ensureMovie(row) {
    const title = String(row.Name || row.title || '').trim();
    const year = validYear(row.Year || row.year);
    if (!title || !year) return null;
    let m = movies.find(x => Number(x.year) === year && normName(x.title) === normName(title));
    let created = false;
    if (!m) {
      const suffix = normName(title).replace(/\s+/g, '-').slice(0, 75);
      const id = 'letterboxd-' + suffix + '-' + year;
      m = { id, title, year, date: '', score: null, notes: '', poster: '',
        seen: true, order: movies.reduce((n, x) => Math.max(n, Number(x.order) || 0), 0) + 1,
        source: 'Letterboxd' };
      movies.push(m);
      created = true;
    }
    const uri = String(row['Letterboxd URI'] || row.url || '');
    if (uri.startsWith('https://boxd.it/')) lb.filmLinks[key(title, year)] = uri;
    return { movie: m, created };
  }
  function ratingScore(value) {
    if (value === '' || value == null) return null;
    const v = Number(value);
    return Number.isFinite(v) && v >= 0.5 && v <= 5 && v * 2 === Math.round(v * 2)
      ? Math.round(v * 2 * 10) / 10 : null;
  }
  function logFingerprint(row) {
    return JSON.stringify([entryKey(row), row['Watched Date'] || '', row.Date || '',
      row.Rating || '', row.Rewatch || '', row.Tags || '', row.Review || '']);
  }
  function applyData(groups) {
    let addedFilms = 0, filledRatings = 0, addedDiary = 0, addedWatchlist = 0;
    const archiveWatched = groups['watched.csv'] || [];
    const ratings = groups['ratings.csv'] || [];
    const diary = groups['diary.csv'] || [];
    const watchlist = groups['watchlist.csv'] || [];
    const reviews = groups['reviews.csv'] || [];
    const checked = new Set();
    for (const row of [...archiveWatched, ...ratings, ...diary]) {
      const k = entryKey(row);
      if (!k || checked.has(k)) continue;
      checked.add(k);
      const match = ensureMovie(row);
      if (match && match.created) addedFilms++;
    }
    for (const row of ratings) {
      const match = ensureMovie(row);
      if (!match) continue;
      const r = ratingScore(row.Rating);
      if (r !== null && (match.movie.score == null || match.movie.score === '')) {
        match.movie.score = r;
        filledRatings++;
      }
    }
    const existingLogs = new Set(lb.diary.map(row => row.fingerprint));
    const repeated = new Map();
    for (const row of diary) {
      const match = ensureMovie(row);
      if (!match) continue;
      const sig = logFingerprint(row);
      const occurrence = (repeated.get(sig) || 0) + 1;
      repeated.set(sig, occurrence);
      const fingerprint = sig + ':' + occurrence;
      if (existingLogs.has(fingerprint)) continue;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(row['Watched Date'] || '') ? row['Watched Date'] : '';
      const log = { fingerprint, filmKey: entryKey(row), title: match.movie.title,
        year: match.movie.year, watchedDate: date, loggedDate: row.Date || '',
        rating: ratingScore(row.Rating), rewatch: /^(yes|true|1|rewatch)$/i.test(String(row.Rewatch || '').trim()),
        tags: String(row.Tags || ''), review: String(row.Review || ''),
        url: lb.filmLinks[entryKey(row)] || '' };
      lb.diary.push(log);
      existingLogs.add(fingerprint);
      addedDiary++;
      if (match.movie.source === 'Letterboxd' && date && (!match.movie.date || match.movie.date < date)) match.movie.date = date;
    }
    for (const row of reviews) {
      const k = entryKey(row), date = row['Watched Date'] || '';
      const log = lb.diary.find(x => x.filmKey === k && (!date || x.watchedDate === date));
      if (log && !log.review) log.review = String(row.Review || row.Text || '');
    }
    const knownWatchlist = new Set(lb.watchlist.map(x => x.filmKey));
    for (const row of watchlist) {
      const title = String(row.Name || '').trim(), year = validYear(row.Year);
      if (!title || !year) continue;
      const filmKey = key(title, year);
      if (knownWatchlist.has(filmKey)) continue;
      lb.watchlist.push({ filmKey, title, year, addedDate: row.Date || '',
        url: String(row['Letterboxd URI'] || '') });
      knownWatchlist.add(filmKey);
      addedWatchlist++;
    }
    const profile = (groups['profile.csv'] || [])[0];
    if (profile && profile['Favorite Films']) {
      lb.favorites = profile['Favorite Films'].split(',').map(s => s.trim())
        .filter(s => /^https:\/\/boxd\.it\//.test(s));
    }
    lb.importedAt = new Date().toISOString();
    if (!persist()) throw Error('Phone storage unavailable; free up space and try again.');
    save();
    updateYearMenu();
    yearFilter = 'all';
    document.querySelector('#yearSelect').value = 'all';
    view = 'all';
    closeModal();
    render();
    const report = 'Added ' + addedFilms + ' movies, ' + filledRatings + ' ratings, '
      + addedDiary + ' diary entries and ' + addedWatchlist + ' watchlist titles.';
    toast('Letterboxd import complete ✓');
    setTimeout(() => { if (window.confirm(report + '\n\nYour existing scores were preserved. Open Diary or Watchlist to see imported details.')) render(); }, 50);
  }
  function htmlFilm(title, year) {
    return '<strong>' + escapeHtml(title) + '</strong><small>' + escapeHtml(year) + '</small>';
  }
  function renderSpecial() {
    let panel = document.querySelector('#letterboxdPanel');
    if (!panel) return;
    const special = view === 'diary' || view === 'watchlist';
    panel.classList.toggle('hide', !special);
    if (!special) return;
    document.querySelector('#grid').classList.add('hide');
    document.querySelector('.count-row').classList.add('hide');
    document.querySelector('#rankingBar').classList.add('hide');
    const needle = normName(query || '');
    const isVisible = (title, year) => (!needle || normName(title).includes(needle))
      && (yearFilter === 'all' || String(year) === String(yearFilter));
    if (view === 'diary') {
      const logs = lb.diary.filter(x => isVisible(x.title, x.year)).slice()
        .sort((a, b) => (b.watchedDate || b.loggedDate || '').localeCompare(a.watchedDate || a.loggedDate || ''));
      panel.innerHTML = '<div class="lb-heading"><div><span class="lb-kicker">LETTERBOXD JOURNAL</span><h2>Your diary</h2><p>' + logs.length + ' entries · Repeat viewings kept separately · Tap Edit to change details</p></div></div>'
        + (logs.length ? '<div class="lb-list">' + logs.map((x) => '<div class="lb-row">'
          + '<div class="lb-date">' + escapeHtml(x.watchedDate ? readable(x.watchedDate) : 'Date not recorded') + '</div>'
          + '<div class="lb-film">' + htmlFilm(x.title, x.year)
          + (x.rewatch ? '<span class="lb-chip">REWATCH</span>' : '')
          + (x.rating != null ? '<span class="lb-score">★ ' + x.rating + '/10</span>' : '')
          + (x.tags ? '<p class="lb-muted">Tags: ' + escapeHtml(x.tags) + '</p>' : '')
          + (x.review ? '<p class="lb-muted">' + escapeHtml(x.review.slice(0, 220)) + '</p>' : '')
          + '</div><button class="btn" data-lb-edit="' + encodeURIComponent(x.fingerprint) + '">Edit</button></div>').join('') + '</div>'
          : '<p class="lb-empty">No diary entries match this filter. Import your Letterboxd ZIP in Settings.</p>');
    } else {
      const items = lb.watchlist.filter(x => isVisible(x.title, x.year)).slice()
        .sort((a, b) => (b.addedDate || '').localeCompare(a.addedDate || ''));
      panel.innerHTML = '<div class="lb-heading"><div><span class="lb-kicker">COMING UP</span><h2>Your watchlist</h2><p>' + items.length + ' movies you want to see. These do not count as watched.</p></div><button class="btn primary" id="lbAddWatchlist">+ Add film</button></div>'
        + (items.length ? '<div class="lb-list">' + items.map(x => '<div class="lb-row"><div class="lb-film">' + htmlFilm(x.title, x.year) + '</div>'
          + '<button class="btn" data-lb-watched="' + encodeURIComponent(x.filmKey) + '">Watched</button>'
          + '<button class="btn" data-lb-remove="' + encodeURIComponent(x.filmKey) + '">Remove</button></div>').join('') + '</div>'
          : '<p class="lb-empty">Your watchlist is empty. Add a film or import your Letterboxd ZIP.</p>');
      const add = panel.querySelector('#lbAddWatchlist');
      if (add) add.onclick = showAddWatchlist;
    }
  }
  function showAddWatchlist() {
    openModal('Add to watchlist', '<label class="field">Film title<input id="lbTitle" maxlength="200"></label>'
      + '<label class="field">Release year<input id="lbYear" type="number" min="1888" max="2100"></label>'
      + '<div class="dialog-actions"><button class="btn" id="lbCancel">Cancel</button>'
      + '<button class="btn primary" id="lbSaveWatch">Save to watchlist</button></div>');
    document.querySelector('#lbCancel').onclick = closeModal;
    document.querySelector('#lbSaveWatch').onclick = () => {
      const title = document.querySelector('#lbTitle').value.trim();
      const year = validYear(document.querySelector('#lbYear').value);
      if (!title || !year) return toast('Enter a movie title and release year');
      const filmKey = key(title, year);
      if (lb.watchlist.some(x => x.filmKey === filmKey)) return toast('Already on your watchlist');
      lb.watchlist.push({ filmKey, title, year, addedDate: new Date().toISOString().slice(0, 10), url: '' });
      persist(); closeModal(); view = 'watchlist'; render();
    };
  }
  function editDiary(fingerprint) {
    const row = lb.diary.find(x => x.fingerprint === fingerprint);
    if (!row) return;
    openModal('Edit diary entry', '<div class="fine">' + htmlFilm(row.title, row.year) + '</div>'
      + '<label class="field">Date watched<input type="date" id="lbDDate" value="' + escapeHtml(row.watchedDate || '') + '"></label>'
      + '<label class="field">Rating /10<input type="number" id="lbDRating" min="0" max="10" step="0.5" value="' + (row.rating == null ? '' : row.rating) + '"></label>'
      + '<label class="field">Tags<input id="lbDTags" value="' + escapeHtml(row.tags || '') + '"></label>'
      + '<label class="field">Review<textarea id="lbDReview">' + escapeHtml(row.review || '') + '</textarea></label>'
      + '<label class="field"><input type="checkbox" id="lbDRewatch" ' + (row.rewatch ? 'checked' : '') + '> Rewatch</label>'
      + '<div class="dialog-actions"><button class="btn" id="lbDDelete">Delete entry</button><button class="btn primary" id="lbDSave">Save changes</button></div>');
    document.querySelector('#lbDDelete').onclick = () => {
      if (!confirm('Delete this diary entry?')) return;
      lb.diary = lb.diary.filter(x => x.fingerprint !== fingerprint);
      persist(); closeModal(); render();
    };
    document.querySelector('#lbDSave').onclick = () => {
      const scoreStr = document.querySelector('#lbDRating').value;
      const score = scoreStr.trim() === '' ? null : Number(scoreStr);
      if (score !== null && (!Number.isFinite(score) || score < 0 || score > 10)) return toast('Use a rating from 0 to 10');
      row.watchedDate = document.querySelector('#lbDDate').value;
      row.rating = score;
      row.tags = document.querySelector('#lbDTags').value.slice(0, 600);
      row.review = document.querySelector('#lbDReview').value.slice(0, 15000);
      row.rewatch = document.querySelector('#lbDRewatch').checked;
      persist(); closeModal(); render(); toast('Diary entry updated ✓');
    };
  }
  function mergeBackup(j) {
    let incomingMovies = j.movies;
    if (!Array.isArray(incomingMovies) && j.app === 'ReelRank' && j.data) {
      incomingMovies = (j.data.localMovies || []).map(m => ({
        id: m.slug, title: m.title, year: m.release_year, date: m.watched_date || '',
        score: j.data.entries?.[m.slug]?.score ?? null, notes: j.data.entries?.[m.slug]?.notes || '',
        poster: j.data.entries?.[m.slug]?.posterUrl || '', seen: true,
        order: 0, source: 'Letterboxd'
      }));
    }
    if (!Array.isArray(incomingMovies)) throw Error('Not a ReelRank backup.');
    for (const m of incomingMovies) {
      if (!m || !m.title || !validYear(m.year)) continue;
      const existing = movies.find(x => x.id === m.id)
        || movies.find(x => x.year == m.year && normName(x.title) === normName(m.title));
      if (existing) {
        if (existing.score == null && m.score != null) existing.score = m.score;
        if (!existing.notes && m.notes) existing.notes = m.notes;
        if (!existing.poster && m.poster) existing.poster = m.poster;
      } else movies.push({ ...m, id: m.id || 'backup-' + key(m.title, m.year).replace(/[^a-z0-9]/g, '-') });
    }
    if (j.letterboxd && Array.isArray(j.letterboxd.diary) && Array.isArray(j.letterboxd.watchlist)) {
      const ids = new Set(lb.diary.map(x => x.fingerprint));
      for (const x of j.letterboxd.diary) if (x && x.fingerprint && !ids.has(x.fingerprint)) {
        lb.diary.push(x); ids.add(x.fingerprint);
      }
      const watch = new Set(lb.watchlist.map(x => x.filmKey));
      for (const x of j.letterboxd.watchlist) if (x && x.filmKey && !watch.has(x.filmKey)) {
        lb.watchlist.push(x); watch.add(x.filmKey);
      }
      lb.filmLinks = { ...lb.filmLinks, ...(j.letterboxd.filmLinks || {}) };
      lb.favorites = [...new Set([...lb.favorites, ...(j.letterboxd.favorites || [])])];
      persist();
    }
    if (j.posterCache) posterCache = { ...posterCache, ...j.posterCache };
    if (j.awards) {
      awardChoices = { ...awardChoices, ...j.awards };
      localStorage.setItem(AWARDS_KEY, JSON.stringify(awardChoices));
    }
    if (j.battleData) {
      battleData = { rankings: j.battleData.rankings || {}, sessions: j.battleData.sessions || {},
        rankingMode: j.battleData.rankingMode === 'battle' ? 'battle' : 'score' };
      saveBattleData();
    }
    save(); localStorage.setItem(POSTER_CACHE_KEY, JSON.stringify(posterCache));
    updateYearMenu(); closeModal(); render(); toast('Backup merged ✓');
  }
  const originalRender = render;
  render = function () { originalRender(); renderSpecial(); };
  let panel = document.createElement('section');
  panel.id = 'letterboxdPanel'; panel.className = 'hide';
  document.querySelector('#grid').insertAdjacentElement('afterend', panel);
  const tabs = document.querySelector('.tabs');
  for (const [which, label] of [['diary', 'Diary'], ['watchlist', 'Watchlist']]) {
    const tab = document.createElement('button');
    tab.className = 'tab'; tab.type = 'button'; tab.dataset.view = which;
    tab.textContent = label; tab.setAttribute('role', 'tab');
    tab.onclick = () => { view = which; render(); };
    tabs.appendChild(tab);
  }
  panel.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.lbEdit) editDiary(decodeURIComponent(b.dataset.lbEdit));
    if (b.dataset.lbRemove) {
      const filmKey = decodeURIComponent(b.dataset.lbRemove);
      lb.watchlist = lb.watchlist.filter(x => x.filmKey !== filmKey);
      persist(); render();
    }
    if (b.dataset.lbWatched) {
      const filmKey = decodeURIComponent(b.dataset.lbWatched);
      const item = lb.watchlist.find(x => x.filmKey === filmKey);
      if (!item) return;
      const found = ensureMovie({ Name: item.title, Year: item.year, 'Letterboxd URI': item.url });
      if (found) {
        found.movie.seen = true;
        if (found.created) found.movie.date = new Date().toISOString().slice(0, 10);
      }
      lb.watchlist = lb.watchlist.filter(x => x.filmKey !== filmKey);
      persist(); save(); updateYearMenu(); render(); toast('Added to watched collection ✓');
    }
  });
  const nativeSettings = openSettings;
  openSettings = function () {
    nativeSettings();
    const body = document.querySelector('#dialogContent');
    const group = document.createElement('div');
    group.className = 'lb-settings';
    group.innerHTML = '<div class="lb-kicker">LETTERBOXD</div>'
      + '<h3>Bring your movie history</h3>'
      + '<p>Import your Letterboxd ZIP export from Files on iPhone. Ratings, diary rewatches and watchlist stay on this phone. Existing ratings are kept.</p>'
      + '<button type="button" class="btn primary" id="lbImportBtn">↑ Import Letterboxd ZIP</button>'
      + '<input type="file" multiple class="hide" id="lbImportInput" accept=".zip,application/zip,.csv,text/csv">'
      + '<p class="fine">' + lb.diary.length + ' diary entries · ' + lb.watchlist.length
      + ' watchlist films' + (lb.importedAt ? ' · Imported ' + escapeHtml(readable(lb.importedAt.slice(0, 10))) : '') + '</p>'
      + (lb.favorites.length ? '<p class="fine">Letterboxd favorites: ' + lb.favorites.map((u, i) =>
          '<a target="_blank" rel="noopener noreferrer" href="' + escapeHtml(u) + '">Film ' + (i + 1) + '</a>').join(' · ') + '</p>' : '');
    body.appendChild(group);
    document.querySelector('#lbImportBtn').onclick = () => document.querySelector('#lbImportInput').click();
    document.querySelector('#lbImportInput').onchange = async e => {
      const files = [...(e.target.files || [])];
      if (!files.length) return;
      try {
        const groups = await readLetterboxdFiles(files);
        applyData(groups);
      } catch (err) {
        alert('Letterboxd import failed: ' + (err.message || 'Unknown error'));
      }
    };
    document.querySelector('#exportBtn').onclick = () => {
      const backup = { version: 4, movies, posterCache, awards: awardChoices, battleData,
        letterboxd: lb, exportedAt: new Date().toISOString() };
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'reelrank-full-backup.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000); toast('Full backup downloaded ✓');
    };
    document.querySelector('#importInput').onchange = async e => {
      const file = e.target.files?.[0]; if (!file) return;
      try { mergeBackup(JSON.parse(await file.text())); }
      catch (err) { alert('Could not import backup: ' + (err.message || 'Unknown error')); }
    };
  };
  document.querySelector('#settingsBtn').onclick = openSettings;
  const nativeEdit = openEdit;
  openEdit = function (id) {
    nativeEdit(id);
    const m = movies.find(x => x.id === id);
    const el = document.querySelector('#dialogContent .fine');
    if (m && el) {
      const isAMC = /^AMC/i.test(m.source || '') || m.id.startsWith('amc-') || m.id.startsWith('cloud-');
      el.textContent = isAMC ? ('AMC booking date: ' + readable(m.date) + '. Ratings are saved on this device.')
        : ('Letterboxd viewing date: ' + (m.date ? readable(m.date) : 'not recorded')
          + '. Ratings are saved on this device.');
    }
  };
  const css = document.createElement('style');
  css.textContent = '.tabs{flex-wrap:wrap}.lb-heading{display:flex;gap:16px;justify-content:space-between;align-items:center;margin:14px 0 24px}.lb-heading h2{font-family:Manrope,sans-serif;font-size:32px;margin:6px 0}.lb-heading p,.lb-muted,.lb-empty{color:var(--muted);font-size:13px;line-height:1.7}.lb-kicker{font-size:11px;letter-spacing:.19em;color:var(--coral);font-weight:800}.lb-list{display:grid;gap:10px;margin-bottom:30px}.lb-row{background:var(--panel);border:1px solid var(--stroke);border-radius:17px;padding:16px;display:flex;align-items:center;gap:13px}.lb-date{flex:0 0 105px;color:var(--muted);font-size:12px}.lb-film{flex:1;min-width:0}.lb-film strong{display:block;font-size:15px}.lb-film small{color:var(--muted)}.lb-chip{display:inline-block;color:var(--violet);font-size:10px;font-weight:800;margin-left:10px}.lb-score{display:inline-block;margin:8px 0;color:var(--coral);font-size:13px;font-weight:800}.lb-muted{margin:4px 0;white-space:pre-wrap}.lb-settings{margin-top:24px;padding:19px;border:1px solid var(--stroke);border-radius:18px;background:var(--panel)}.lb-settings h3{font-size:22px;margin:6px 0}.lb-settings p{color:var(--muted);font-size:13px;line-height:1.7}.lb-settings .btn{margin:9px 0}.lb-settings a{color:var(--violet)}@media(max-width:600px){.lb-row{flex-wrap:wrap;padding:13px}.lb-date{flex:0 0 100%;font-size:11px}.lb-row .btn{padding:8px 11px}.lb-heading h2{font-size:28px}.tabs .tab{flex:1 1 27%}}';
  document.head.appendChild(css);
})();
