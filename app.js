/* House Collection: records (from Discogs), labels, tracks (with BPM). */
(() => {
'use strict';

const view = document.getElementById('view');
const announceEl = document.getElementById('announce');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

let C = null;            // collection.json
let TRACKS = [];         // tracks.json
let NOTES = { releases: {}, labels: {} };
let byId = new Map(), labelsIdx = [], vinylOf = new Map();

/* ---------- tiny DOM helpers ---------- */
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k);
  return n;
}
const put = (...kids) => { for (const k of kids.flat(Infinity)) if (k != null && k !== false) view.append(k); };
const announce = msg => { announceEl.textContent = ''; setTimeout(() => { announceEl.textContent = msg; }, 30); };
const enc = encodeURIComponent;

function sleeve(r, big) {
  const box = h('div', { class: 'sleeve' });
  const src = big ? r.cover : (r.cover || r.thumb);
  if (src) {
    const img = h('img', { src, alt: 'Cover of ' + r.title + ' by ' + r.artist, loading: big ? 'eager' : 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => { img.remove(); box.append(h('span', { class: 'ph' }, r.title)); });
    box.append(img);
  } else box.append(h('span', { class: 'ph' }, r.title));
  return box;
}
const decade = y => y ? Math.floor(y / 10) * 10 : 0;
function paragraphs(text) { return String(text).split(/\n\s*\n/).map(p => h('p', {}, p.trim())); }

// Thumbnails that fail to load just disappear instead of showing a broken icon.
document.addEventListener('error', ev => { const t = ev.target; if (t.tagName === 'IMG' && !t.closest('.sleeve')) t.style.visibility = 'hidden'; }, true);

/* ---------- routing: #/path?query ---------- */
function route() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || '') };
}
function setQuery(q) {
  const { parts } = route();
  const s = q.toString();
  history.replaceState(null, '', '#/' + parts.map(enc).join('/') + (s ? '?' + s : ''));
}
function setTab(name) {
  document.querySelectorAll('.tabs a').forEach(a => {
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

let lastPath = '';
function render(focus) {
  if (!C) return;
  const { parts, q } = route();
  const path = parts.join('/');
  view.textContent = '';
  if (parts[0] === 'r' && byId.has(+parts[1])) { setTab('records'); renderRecord(byId.get(+parts[1]), q.has('pulled')); }
  else if (parts[0] === 'labels') { setTab('labels'); renderLabels(); }
  else if (parts[0] === 'l' && parts[1]) { setTab('labels'); renderLabel(parts[1]); }
  else if (parts[0] === 'tracks') { setTab('tracks'); renderTracks(q); }
  else { setTab('records'); renderRecords(q); }
  if (focus !== false && path !== lastPath) {
    const hd = view.querySelector('h2');
    if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  lastPath = path;
}
window.addEventListener('hashchange', () => render());

/* ---------- records ---------- */
function renderRecords(q) {
  const all = C.releases;
  const opts = (vals, label, key) => {
    const s = h('select', { 'aria-label': label });
    s.append(h('option', { value: '' }, label + ': all'));
    for (const [v, n] of vals) s.append(h('option', { value: v, selected: q.get(key) === String(v) }, (key === 'decade' ? v + 's' : v) + ' (' + n + ')'));
    s.addEventListener('change', () => { if (s.value) q.set(key, s.value); else q.delete(key); setQuery(q); draw(); });
    return s;
  };
  const tally = f => { const m = new Map(); all.forEach(r => f(r).forEach(v => m.set(v, (m.get(v) || 0) + 1))); return [...m]; };
  const genres = tally(r => r.genres).sort((a, b) => b[1] - a[1]);
  const styles = tally(r => r.styles).sort((a, b) => b[1] - a[1]);
  const decades = tally(r => r.year ? [decade(r.year)] : []).sort((a, b) => a[0] - b[0]);

  const search = h('input', { type: 'search', placeholder: 'Search records, artists, labels…', value: q.get('q') || '', autocomplete: 'off', 'aria-label': 'Search records' });
  search.addEventListener('input', () => { if (search.value.trim()) q.set('q', search.value.trim()); else q.delete('q'); setQuery(q); draw(); });
  const sort = h('select', { 'aria-label': 'Sort records' },
    [['added', 'Recently added'], ['year', 'Year, oldest first'], ['yeard', 'Year, newest first'], ['artist', 'Artist'], ['title', 'Title']]
      .map(([v, l]) => h('option', { value: v, selected: (q.get('sort') || 'added') === v }, l)));
  sort.addEventListener('change', () => { if (sort.value !== 'added') q.set('sort', sort.value); else q.delete('sort'); setQuery(q); draw(); });

  const count = h('p', { class: 'count', role: 'status' });
  const grid = h('ul', { class: 'grid', 'aria-label': 'Records' });
  put(
    h('h2', { class: 'sr-only' }, 'Records'),
    h('div', { class: 'toolbar' },
      h('label', { class: 'search' }, searchIcon(), search),
      opts(genres, 'Genre', 'genre'), opts(styles, 'Style', 'style'), opts(decades, 'Decade', 'decade'), sort),
    count, grid);

  function draw() {
    const f = (q.get('q') || '').toLowerCase();
    const g = q.get('genre'), st = q.get('style'), dc = +q.get('decade') || 0;
    let list = all.filter(r =>
      (!g || r.genres.includes(g)) && (!st || r.styles.includes(st)) && (!dc || decade(r.year) === dc) &&
      (!f || [r.title, r.artist, ...r.labels.map(l => l.name + ' ' + l.catno), ...r.styles].join(' ').toLowerCase().includes(f)));
    const s = q.get('sort') || 'added';
    const by = {
      added: (a, b) => b.added.localeCompare(a.added),
      year: (a, b) => (a.year || 9999) - (b.year || 9999),
      yeard: (a, b) => (b.year || 0) - (a.year || 0),
      artist: (a, b) => coll.compare(a.artist.replace(/^the /i, ''), b.artist.replace(/^the /i, '')),
      title: (a, b) => coll.compare(a.title, b.title),
    }[s];
    list = list.slice().sort((a, b) => by(a, b) || coll.compare(a.title, b.title));
    count.textContent = list.length === all.length ? all.length + ' records' : list.length + ' of ' + all.length + ' records';
    grid.textContent = '';
    if (!list.length) { grid.append(h('li', { class: 'empty' }, 'Nothing in the crate matches that.')); return; }
    const frag = document.createDocumentFragment();
    for (const r of list) frag.append(h('li', { class: 'rec' }, h('a', { href: '#/r/' + r.id },
      sleeve(r), h('div', { class: 'tt' }, r.title), h('div', { class: 'ta' }, r.artist), h('div', { class: 'ty' }, r.year ? String(r.year) : ''))));
    grid.append(frag);
  }
  draw();
}
function searchIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>';
  return s;
}

/* ---------- one record ---------- */
function renderRecord(r, pulled) {
  document.title = r.title + ' · ' + r.artist + ' · House Collection';
  const note = NOTES.releases[r.id];
  const facts = h('dl', { class: 'facts' });
  const fact = (k, v) => { if (v) facts.append(h('dt', {}, k), h('dd', {}, v)); };
  fact('Year', r.year ? String(r.year) + (r.released && r.released.length > 4 && !r.released.startsWith('0') ? ' (released ' + r.released + ')' : '') : '');
  fact('Label', r.labels.length ? r.labels.map((l, i) => [i ? ', ' : '', h('a', { href: '#/l/' + enc(l.name) }, l.name), l.catno && l.catno !== 'none' ? ' · ' + l.catno : '']) : '');
  fact('Format', r.format);
  fact('Country', r.country);
  fact('Added', r.added);

  const tags = h('ul', { class: 'tags', 'aria-label': 'Genres and styles' },
    r.genres.map(g => h('li', {}, h('a', { href: '#/?genre=' + enc(g) }, g))),
    r.styles.map(s => h('li', {}, h('a', { href: '#/?style=' + enc(s) }, s))));

  const tl = h('ol', { class: 'tl' });
  for (const t of r.tracks) {
    tl.append(h('li', {},
      h('span', { class: 'pos' }, t.pos),
      h('span', {}, t.title, t.artist ? h('div', { class: 'ta' }, t.artist) : null),
      t.bpm ? h('span', { class: 'badge', title: 'BPM from the digital copy in the Tracks list' }, t.bpm.toFixed(1) + ' BPM') : h('span'),
      h('span', { class: 'dur' }, t.dur || '')));
  }

  const right = h('div', {},
    h('h2', {}, r.title),
    h('p', { class: 'by' }, r.artist),
    note ? h('blockquote', { class: 'liner' }, paragraphs(note), h('p', { class: 'sig' }, 'Liner note, Andrew')) : null,
    facts, tags,
    r.tracks.length ? [h('h3', {}, 'Tracklist'), tl] : null,
    r.credits.length ? h('details', { class: 'credits' }, h('summary', {}, 'Credits (' + r.credits.length + ')'),
      h('ul', {}, r.credits.map(c => h('li', {}, c.name + (c.role ? ': ' + c.role : ''))))) : null,
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: pull }, 'Pull another'),
      h('a', { class: 'btn', href: r.url }, 'View on Discogs')));

  put(
    h('a', { class: 'back', href: '#/' }, '← All records'),
    h('article', { class: 'record' + (pulled && !reduceMotion ? ' pulled' : '') }, sleeve(r, true), right));
}

/* ---------- labels (lineage) ---------- */
function buildLabels() {
  const m = new Map();
  for (const r of C.releases) for (const l of r.labels) {
    if (/^not on label/i.test(l.name)) continue;
    if (!m.has(l.name)) m.set(l.name, { name: l.name, id: l.id, recs: [] });
    const e = m.get(l.name);
    if (!e.recs.some(x => x.r === r)) e.recs.push({ r, catno: l.catno });
  }
  labelsIdx = [...m.values()].sort((a, b) => b.recs.length - a.recs.length || coll.compare(a.name, b.name));
}
function yearsOf(e) {
  const ys = e.recs.map(x => x.r.year).filter(Boolean);
  if (!ys.length) return '';
  const a = Math.min(...ys), b = Math.max(...ys);
  return a === b ? String(a) : a + '–' + b;
}
function renderLabels() {
  document.title = 'Labels · House Collection';
  const q = route().q;
  const genres = ['Electronic', 'Jazz', 'Funk / Soul', 'Rock', 'Hip Hop'];
  let g = genres.includes(q.get('genre')) ? q.get('genre') : '';
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Show labels by genre' });
  const intro = h('p', { class: 'count', role: 'status' });
  const multi = h('ul', { class: 'labels', 'aria-labelledby': 'lab-multi' });
  const singles = h('p', { class: 'singles' });
  const multiH = h('h3', { id: 'lab-multi' }, 'More than one record');
  const singlesH = h('h3', {}, 'One record each');
  put(h('h2', {}, 'Labels'), chips, intro, multiH, multi, singlesH, singles);

  function draw() {
    chips.textContent = '';
    for (const x of ['', ...genres]) chips.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(g === x),
      onclick: () => { g = x; const p = new URLSearchParams(); if (g) p.set('genre', g); setQuery(p); draw(); } }, x || 'All'));
    const pick = labelsIdx.map(e => ({ ...e, recs: g ? e.recs.filter(x => x.r.genres.includes(g)) : e.recs })).filter(e => e.recs.length)
      .sort((a, b) => b.recs.length - a.recs.length || coll.compare(a.name, b.name));
    const many = pick.filter(e => e.recs.length > 1), one = pick.filter(e => e.recs.length === 1).sort((a, b) => coll.compare(a.name, b.name));
    const noted = pick.filter(e => NOTES.labels[e.name]).length;
    intro.textContent = pick.length + ' labels' + (g ? ' with ' + g + ' records' : '') + (noted ? ', ' + noted + ' with notes' : '') + '. Each opens a timeline of its records, oldest first.';
    multi.textContent = '';
    for (const e of many) {
      const strip = h('div', { class: 'strip', 'aria-hidden': 'true' },
        e.recs.slice().sort((a, b) => (a.r.year || 0) - (b.r.year || 0)).slice(0, 14)
          .map(x => x.r.thumb ? h('img', { src: x.r.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null));
      const note = NOTES.labels[e.name];
      multi.append(h('li', { class: 'lab' }, h('a', { href: '#/l/' + enc(e.name) },
        h('span', { class: 'ln' }, e.name),
        h('span', { class: 'lc' }, e.recs.length + ' records' + (yearsOf(e) ? ' · ' + yearsOf(e) : '')),
        note ? h('p', { class: 'lnote' }, String(note).split(/\n/)[0]) : null,
        strip)));
    }
    multiH.hidden = !many.length;
    singles.textContent = '';
    one.forEach((e, i) => singles.append(i ? ' · ' : '', h('a', { href: '#/l/' + enc(e.name) }, e.name)));
    singlesH.hidden = !one.length;
  }
  draw();
}
function renderLabel(name) {
  const e = labelsIdx.find(x => x.name === name);
  if (!e) { put(h('h2', {}, 'Label not found'), h('a', { class: 'back', href: '#/labels' }, '← All labels')); return; }
  document.title = e.name + ' · House Collection';
  const note = NOTES.labels[e.name];
  const tl = h('ol', { class: 'timeline' });
  for (const x of e.recs.slice().sort((a, b) => (a.r.year || 9999) - (b.r.year || 9999))) {
    tl.append(h('li', {}, h('span', { class: 'yr' }, x.r.year ? String(x.r.year) : 'Year unknown'),
      h('a', { href: '#/r/' + x.r.id },
        x.r.thumb ? h('img', { src: x.r.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : h('span', { class: 'ph' }),
        h('span', {}, h('b', {}, x.r.title), h('div', { class: 'ta' }, x.r.artist), x.catno && x.catno !== 'none' ? h('div', { class: 'cat' }, x.catno) : null))));
  }
  put(
    h('a', { class: 'back', href: '#/labels' }, '← All labels'),
    h('h2', {}, e.name),
    h('p', { class: 'count' }, e.recs.length + (e.recs.length === 1 ? ' record' : ' records') + (yearsOf(e) ? ', ' + yearsOf(e) : '') + ' · ',
      h('a', { href: 'https://www.discogs.com/label/' + e.id }, 'label on Discogs')),
    note ? h('blockquote', { class: 'liner' }, paragraphs(note)) : null,
    tl);
}

/* ---------- tracks (BPM) ---------- */
const RANGES = [
  { id: 'all', label: 'All', min: 0, max: Infinity },
  { id: 'lt115', label: 'Under 115', min: 0, max: 114.95 },
  { id: '115', label: '115–119', min: 114.95, max: 119.95 },
  { id: '120', label: '120–122', min: 119.95, max: 122.95 },
  { id: '123', label: '123–125', min: 122.95, max: 125.95 },
  { id: '126', label: '126–128', min: 125.95, max: 128.95 },
  { id: '129', label: '129–132', min: 128.95, max: 132.95 },
  { id: '133', label: '133+', min: 132.95, max: Infinity },
];
function renderTracks(q) {
  document.title = 'Tracks · House Collection';
  let range = RANGES.find(r => r.id === q.get('bpm')) || RANGES[0];
  let sortKey = ['title', 'artist', 'bpm'].includes(q.get('sort')) ? q.get('sort') : 'title';
  let asc = q.get('dir') ? q.get('dir') !== 'desc' : sortKey !== 'bpm';
  let vinylOnly = q.get('vinyl') === '1';

  const search = h('input', { type: 'search', placeholder: 'Search title, artist, album…', value: q.get('q') || '', autocomplete: 'off', 'aria-label': 'Search tracks' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'BPM range' });
  const sorts = h('div', { class: 'sorts', role: 'group', 'aria-label': 'Sort and show' });
  const count = h('p', { class: 'count', role: 'status' });
  const list = h('ol', { class: 'tracks', 'aria-label': 'Tracks' });
  put(h('h2', { class: 'sr-only' }, 'Tracks'),
    h('div', { class: 'toolbar' }, h('label', { class: 'search' }, searchIcon(), search)), chips, sorts, count, list);

  const save = () => {
    const p = new URLSearchParams();
    if (search.value.trim()) p.set('q', search.value.trim());
    if (range.id !== 'all') p.set('bpm', range.id);
    if (sortKey !== 'title' || !asc) { p.set('sort', sortKey); p.set('dir', asc ? 'asc' : 'desc'); }
    if (vinylOnly) p.set('vinyl', '1');
    setQuery(p);
  };
  function drawControls() {
    chips.textContent = '';
    for (const r of RANGES) {
      const n = TRACKS.filter(t => t.bpm > r.min && t.bpm <= r.max).length;
      chips.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': String(r === range),
        onclick: () => { range = r; drawControls(); draw(); } }, r.label, h('span', { class: 'n' }, String(n))));
    }
    sorts.textContent = '';
    for (const [k, l] of [['title', 'Title'], ['artist', 'Artist'], ['bpm', 'BPM']]) {
      const on = k === sortKey;
      sorts.append(h('button', { type: 'button', 'aria-pressed': String(on), 'aria-label': 'Sort by ' + l + (on ? (asc ? ', ascending' : ', descending') : ''),
        onclick: () => { if (sortKey === k) asc = !asc; else { sortKey = k; asc = k !== 'bpm'; } drawControls(); draw(); } },
        l + (on ? (asc ? ' ↑' : ' ↓') : '')));
    }
    sorts.append(h('button', { type: 'button', 'aria-pressed': String(vinylOnly), onclick: () => { vinylOnly = !vinylOnly; drawControls(); draw(); } },
      'On vinyl (' + vinylOf.size + ')'));
  }
  function draw() {
    const f = search.value.trim().toLowerCase();
    const idx = TRACKS.map((t, i) => i).filter(i => {
      const t = TRACKS[i];
      return t.bpm > range.min && t.bpm <= range.max && (!vinylOnly || vinylOf.has(i)) &&
        (!f || (t.title + ' ' + t.artist + ' ' + t.album).toLowerCase().includes(f));
    });
    idx.sort((a, b) => {
      const A = TRACKS[a], B = TRACKS[b];
      const r = sortKey === 'bpm' ? A.bpm - B.bpm : coll.compare(A[sortKey] || '￿', B[sortKey] || '￿');
      return (asc ? r : -r) || coll.compare(A.title, B.title);
    });
    count.textContent = idx.length === TRACKS.length ? TRACKS.length + ' tracks' : idx.length + ' of ' + TRACKS.length + ' tracks';
    list.textContent = '';
    if (!idx.length) { list.append(h('li', { class: 'empty' }, 'No tracks match.')); save(); return; }
    const frag = document.createDocumentFragment();
    idx.forEach((i, n) => {
      const t = TRACKS[i], rid = vinylOf.get(i);
      frag.append(h('li', { class: 'trk' },
        h('span', { class: 'num' }, String(n + 1)),
        h('div', {}, h('div', { class: 't' }, t.title),
          t.artist ? h('div', { class: 'a' }, t.artist) : null,
          t.album ? h('div', { class: 'al' }, t.album) : null,
          rid ? h('a', { class: 'vin', href: '#/r/' + rid }, 'On the shelf: ' + byId.get(rid).title + ' →') : null),
        h('div', { class: 'bpm' }, h('b', {}, t.bpm.toFixed(1)), h('span', {}, 'BPM'),
          t.bpm > 140 ? h('i', {}, '½ ' + (t.bpm / 2).toFixed(1)) : null)));
    });
    list.append(frag);
    save();
  }
  search.addEventListener('input', draw);
  drawControls(); draw();
}

/* ---------- pull a record ---------- */
let lastPulled = [];
function pull() {
  if (!C) return;
  // Avoid repeating any of the last 20 pulls.
  const cur = route().parts[0] === 'r' ? +route().parts[1] : null;
  const pool = C.releases.filter(r => r.id !== cur && !lastPulled.includes(r.id));
  const r = pool[Math.floor(Math.random() * pool.length)] || C.releases[0];
  lastPulled.push(r.id); if (lastPulled.length > 20) lastPulled.shift();
  location.hash = '#/r/' + r.id + '?pulled=1';
  announce('Pulled ' + r.title + ' by ' + r.artist);
}
document.getElementById('pull').addEventListener('click', pull);

/* ---------- load ---------- */
const getJSON = (u, fallback) => fetch(u, { cache: 'no-cache' }).then(r => r.ok ? r.json() : fallback).catch(() => fallback);
Promise.all([getJSON('data/collection.json', null), getJSON('tracks.json', []), getJSON('data/notes.json', { releases: {}, labels: {} })])
  .then(([c, t, n]) => {
    if (!c) { view.textContent = ''; put(h('p', { class: 'empty' }, 'The collection could not be loaded. Try refreshing.')); return; }
    C = c; TRACKS = t; NOTES = { releases: n.releases || {}, labels: n.labels || {} };
    byId = new Map(C.releases.map(r => [r.id, r]));
    for (const r of C.releases) for (const tr of r.tracks) if (tr.digital != null && !vinylOf.has(tr.digital)) vinylOf.set(tr.digital, r.id);
    buildLabels();
    document.getElementById('synced').textContent = C.count + ' records · synced ' + C.synced;
    render(false);
  });
})();
