'use strict';
/* FieldApp TEST prototype — one farmer, one day. Throwaway demo code, not the real build. */

/* ===================== RATING SCALES =====================
 * The farmer sees WORDS only. Numbers (and any color coding) are manager-only;
 * there is no manager view in this demo, so the mapping lives here.
 * 5 = always good … 1 = always bad.
 *   Pests:       None 5 · Low 4 · Moderate 3 · High 2 · Severe 1
 *   Crop health: Thriving 5 · Healthy 4 · Struggling 3 · Declining 2 · Failed/Dead 1
 *   "Done" (retired) is a separate terminal crop status — NOT a 1, has no score.
 * RULE: any rating ≤ 3 makes a description REQUIRED and shows "photo suggested".
 */
const PEST_SCALE = [['None', 5], ['Low', 4], ['Moderate', 3], ['High', 2], ['Severe', 1]];
const CROP_SCALE = [['Thriving', 5], ['Healthy', 4], ['Struggling', 3], ['Declining', 2], ['Failed', 1]];
const CROP_DONE = 'Done';
const scoreOf = (scale, word) => { const s = scale.find((x) => x[0] === word); return s ? s[1] : null; };
const isLow = (scale, word) => { const v = scoreOf(scale, word); return v !== null && v <= 3; };

/* ===================== THE DAY (hardcoded) ===================== */
const CROPS = [
  { name: 'Kale', count: 50, last: 'Healthy' },
  { name: 'Collards', count: 30, last: 'Healthy' },
  { name: 'Peppers', count: 30, last: 'Thriving' },
  { name: 'Cukes', count: 20, last: 'Healthy' },
];

const DAY = {
  farmer: 'Hannah',
  sites: [
    {
      id: 'washington', name: 'The Washington Building', window: '8:00–10:00',
      // Quiet nudges: plain Peachy text. clearedBy 'any' = any entry in that section; 'photo' = a photo there.
      nudges: { pests: { text: 'No pest update logged in 2 weeks.', clearedBy: 'any' } },
      workOrder: { id: 'wo-pest-weekly', title: 'Weekly pest check', section: 'pests', recurring: 'Weekly', requireDescription: true, requirePhoto: false },
    },
    {
      id: 'columbia', name: 'Columbia Square', window: '10:30–12:30',
      workOrder: { id: 'wo-irrigation-timer', title: 'Irrigation: reset timer to 3x daily', section: 'irrigation', requireDescription: false, requirePhoto: true },
    },
    {
      id: 'district', name: 'District Center', window: '1:00–3:00',
      nudges: { external: { text: 'No external photos uploaded in 2 weeks.', clearedBy: 'photo' } },
      workOrder: { id: 'wo-crops-status', title: 'Crops: update kale + collard status', section: 'crops', requireDescription: false, requirePhoto: false, cropsToUpdate: ['Kale', 'Collards'] },
    },
  ],
  nonSite: { id: 'wo-shredder', title: 'Drop shredder at 1015 Half Street' },
  // Featured check type. Photo is REQUIRED to complete: it's the quality + client-facing record.
  harvestTable: { id: 'ht-columbia', siteId: 'columbia', time: '12:30' },
};

const SECTIONS = [
  { key: 'irrigation', label: 'Irrigation' },
  { key: 'crops', label: 'Crops' },
  { key: 'pests', label: 'Pests' },
  { key: 'harvest', label: 'Harvest' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'external', label: 'External' },
  { key: 'incident', label: 'Incident / Interaction' },
];

const QUICK_REASONS = ['Not needed today', 'No access', 'Ran out of time', 'Weather'];

/* ===================== DATA SERVICE =====================
 * Demo "submit": records land in a local outbox. To wire a real backend later,
 * set `endpoint` (or replace the body of submit) — callers don't change.
 */
const STORE_KEY = 'fieldapp-test:state:v3';
const OUTBOX_KEY = 'fieldapp-test:outbox:v1';

const DataService = {
  endpoint: null,
  async submit(type, payload = {}) {
    const record = { type, payload, farmer: DAY.farmer, date: state.date, at: new Date().toISOString() };
    if (this.endpoint) {
      try {
        const res = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
        if (res.ok) return;
      } catch { /* offline — fall through to outbox */ }
    }
    try {
      const box = JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]');
      box.push(record);
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(box));
    } catch { /* storage unavailable — demo only */ }
  },
};

/* ===================== STATE ===================== */
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function freshSite(site) {
  const sections = {};
  for (const s of SECTIONS) sections[s.key] = { note: '', photos: [] };
  sections.pests.rating = null;
  sections.crops.crops = CROPS.map((c) => ({ name: c.name, count: c.count, status: null, note: '' }));
  sections.harvest.rows = [];
  const open = {};
  if (site.workOrder) open[site.workOrder.section] = true; // work orders open pre-expanded
  return { submittedAt: null, touched: false, open, sections, wo: site.workOrder ? { resolution: null, reason: '' } : null };
}

function freshState() {
  return {
    v: 3,
    date: todayKey(),
    clock: { inAt: null, outAt: null },
    sites: Object.fromEntries(DAY.sites.map((s) => [s.id, freshSite(s)])),
    nonSite: { resolution: null, reason: '' },
    harvestTable: { status: null, photos: [] }, // status: 'ontime' | 'late'
    celebrated: false,
  };
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.v === 3 && s.date === todayKey()) return s;
  } catch { /* fall through */ }
  return freshState();
}

let state = load();
const ui = { tried: {}, woTried: {}, harvestPicker: false }; // ephemeral, not persisted

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch { toast('Phone storage is full — latest photos may not survive a refresh.'); }
}

/* ===================== HELPERS ===================== */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const siteById = (id) => DAY.sites.find((s) => s.id === id);
const lastStatus = (name) => CROPS.find((c) => c.name === name).last;
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDur = (ms) => { const m = Math.floor(ms / 60000); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
const elapsedHTML = (ms) => `${fmtDur(ms)}<small>${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}s</small>`;

const svg = (body, size = 24) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  chev: svg('<path d="M6 9l6 6 6-6"/>', 20),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', 20),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>', 22),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 16),
  home: svg('<path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z"/>'),
  history: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  harvest: svg('<path d="M3.5 10h17l-2 9.5h-13z"/><path d="M8 10l4-6 4 6"/>'),
  more: svg('<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>'),
};

/* ===================== RULES / DERIVED STATE ===================== */
const woFor = (site, key) => (site.workOrder && site.workOrder.section === key ? site.workOrder : null);

// What it takes to mark a section work order DONE. Toggles add requirements; the ≤3 rule always applies.
function woChecklist(site, st) {
  const wo = site.workOrder;
  if (!wo) return [];
  const sec = st.sections[wo.section];
  const items = [];
  if (wo.section === 'pests') items.push({ label: 'Pick a pest level', met: !!sec.rating, field: 'pests-rating' });
  (wo.cropsToUpdate || []).forEach((name) => {
    const i = sec.crops.findIndex((c) => c.name === name);
    items.push({ label: `Update ${name} status`, met: !!sec.crops[i].status, field: `cropstatus-${i}` });
  });
  const lowPest = wo.section === 'pests' && isLow(PEST_SCALE, sec.rating);
  if (wo.requireDescription || lowPest) items.push({ label: 'Add a description', met: !!sec.note.trim(), field: `note-${wo.section}` });
  if (wo.section === 'crops') {
    sec.crops.forEach((c, i) => {
      if (isLow(CROP_SCALE, c.status)) items.push({ label: `Describe ${c.name} (${c.status})`, met: !!c.note.trim(), field: `cropnote-${i}` });
    });
  }
  if (wo.requirePhoto) items.push({ label: 'Add a photo', met: sec.photos.length > 0, field: `photos-${wo.section}` });
  return items;
}

function woResolved(site, st) {
  if (!site.workOrder) return true;
  if (st.wo.resolution === 'skip') return !!st.wo.reason.trim();
  if (st.wo.resolution === 'done') return woChecklist(site, st).every((i) => i.met);
  return false;
}

// What blocks SUBMIT: unresolved work order + any ≤3 rating without a description.
function submitBlockers(site, st) {
  const out = [];
  if (site.workOrder && !woResolved(site, st)) out.push({ key: site.workOrder.section, field: 'wo', msg: `Resolve “${site.workOrder.title}”` });
  const p = st.sections.pests;
  if (isLow(PEST_SCALE, p.rating) && !p.note.trim()) out.push({ key: 'pests', field: 'note-pests', msg: 'Pests: describe what you saw' });
  st.sections.crops.crops.forEach((c, i) => {
    if (isLow(CROP_SCALE, c.status) && !c.note.trim()) out.push({ key: 'crops', field: `cropnote-${i}`, msg: `Crops: describe ${c.name}` });
  });
  return out;
}

function noteRequirement(site, st, key) {
  const sec = st.sections[key];
  if (key === 'pests' && isLow(PEST_SCALE, sec.rating)) return `Required · ${sec.rating} pests`;
  const wo = woFor(site, key);
  if (wo && wo.requireDescription && st.wo.resolution !== 'skip') return 'Required by work order';
  return null;
}

function photoPrompt(site, st, key) {
  const sec = st.sections[key];
  const wo = woFor(site, key);
  if (wo && wo.requirePhoto && st.wo.resolution !== 'skip') return 'required';
  if (key === 'pests' && isLow(PEST_SCALE, sec.rating)) return 'suggested';
  if (key === 'crops' && sec.crops.some((c) => isLow(CROP_SCALE, c.status))) return 'suggested';
  return null;
}

function invalidFields(site, st) {
  const bad = new Set();
  if (ui.tried[site.id]) submitBlockers(site, st).forEach((b) => bad.add(b.field));
  if (st.wo && (ui.woTried[site.id] || st.wo.resolution === 'done')) {
    woChecklist(site, st).filter((i) => !i.met).forEach((i) => bad.add(i.field));
  }
  return bad;
}

function sectionSummary(st, key) {
  const sec = st.sections[key];
  const bits = [];
  if (key === 'pests' && sec.rating) bits.push(sec.rating);
  if (key === 'crops') { const n = sec.crops.filter((c) => c.status).length; if (n) bits.push(`${n} updated`); }
  if (key === 'harvest' && sec.rows.length) bits.push(plural(sec.rows.length, 'crop'));
  if (sec.note.trim()) bits.push('note');
  if (sec.photos.length) bits.push(plural(sec.photos.length, 'photo'));
  return bits.join(' · ');
}

// A nudge shows until the farmer logs what it asks for.
function nudgeFor(site, st, key) {
  const n = site.nudges && site.nudges[key];
  if (!n) return null;
  const cleared = n.clearedBy === 'photo' ? st.sections[key].photos.length > 0 : !!sectionSummary(st, key);
  return cleared ? null : n.text;
}
const activeNudges = (site, st) => Object.keys(site.nudges || {}).map((k) => nudgeFor(site, st, k)).filter(Boolean);

/* ----- Check math: each site form = 1, each section work order = 1, the non-site work order = 1 ----- */
function siteChecks(site) {
  const st = state.sites[site.id];
  const total = site.workOrder ? 2 : 1;
  const done = (st.submittedAt ? 1 : 0) + (site.workOrder && woResolved(site, st) ? 1 : 0);
  return { done, total };
}
function dayChecks() {
  let done = 0, total = 0;
  for (const s of DAY.sites) { const c = siteChecks(s); done += c.done; total += c.total; }
  total += 2;
  if (state.nonSite.resolution) done += 1;
  if (state.harvestTable.status) done += 1;
  return { done, total }; // 3 sites + 3 section WOs + 1 non-site + 1 Harvest Table = 8
}
function siteState(site) {
  const st = state.sites[site.id];
  if (st.submittedAt) return 'done';
  if (st.touched) return 'progress';
  return 'new';
}

/* ===================== HOME ===================== */
function bandHTML() {
  const { done, total } = dayChecks();
  const complete = done === total;
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `<header class="band${complete ? ' complete' : ''}" id="band">
    <div class="band-top"><span>${esc(DAY.farmer)}</span><span>${esc(dateStr)}</span></div>
    <div class="band-main">
      <span class="band-num">${done}</span><span class="band-of">/ ${total}</span>
      <span class="band-lbl">${complete ? 'Day complete' : 'done today'}</span>
    </div>
    <div class="bar"><i style="width:${Math.round((done / total) * 100)}%"></i></div>
    ${complete ? `<div class="band-cheer">Every check is in. Nice work, ${esc(DAY.farmer)}.</div>` : ''}
  </header>`;
}

function clockHTML() {
  const c = state.clock;
  if (!c.inAt) {
    return `<section class="clockband clock-ready"><button class="clock-in" data-action="clock-in">
      <span class="clock-in-big">Clock in</span><span class="clock-in-sub">Start your day</span></button></section>`;
  }
  if (!c.outAt) {
    return `<section class="clockband clock-on"><div class="clock-inner">
      <div class="clock-txt"><div class="clock-live"><span class="pulse"></span>On the clock · <span id="clock-elapsed">${elapsedHTML(Date.now() - c.inAt)}</span></div>
      <div class="clock-sub">Since ${fmtTime(c.inAt)}</div></div>
      <button class="btn btn-clockout" data-action="clock-out">Clock out</button></div></section>`;
  }
  return `<section class="clockband clock-off"><div class="clock-inner">
    <div class="clock-txt"><div class="clock-live">Clocked out · ${fmtDur(c.outAt - c.inAt)}</div>
    <div class="clock-sub">${fmtTime(c.inAt)} – ${fmtTime(c.outAt)}</div></div></div></section>`;
}

function siteRowHTML(site) {
  const st = state.sites[site.id];
  const s = siteState(site);
  const c = siteChecks(site);
  const chips = [];
  if (site.workOrder) {
    const ok = woResolved(site, st);
    chips.push(`<span class="chip ${ok ? 'chip-ok' : 'chip-wo'}">${ok ? '✓ ' : ''}${esc(site.workOrder.title)}</span>`);
  }
  const nudges = activeNudges(site, st).map((n) => `<span class="nudge-text">${esc(n)}</span>`).join('');
  return `<button class="row st-${s}" data-open-site="${site.id}">
    <span class="row-main">
      <span class="row-time">${esc(site.window)}</span>
      <span class="row-title">${esc(site.name)}</span>
      ${chips.length ? `<span class="chips">${chips.join('')}</span>` : ''}
      ${nudges}
    </span>
    <span class="row-side">
      <span class="row-count"><b>${c.done}</b>/${c.total}</span>
      <span class="row-state">${{ new: 'Not started', progress: 'In progress', done: 'Done' }[s]}</span>
    </span>
  </button>`;
}

function nonSiteRowHTML() {
  const ns = state.nonSite;
  const sub = ns.resolution === 'skip' ? `Skipped · ${esc(ns.reason)}` : 'Non-site work order';
  return `<button class="row st-${ns.resolution ? 'done' : 'new'}" data-action="nonsite">
    <span class="row-main">
      <span class="row-time">${sub}</span>
      <span class="row-title">${esc(DAY.nonSite.title)}</span>
    </span>
    <span class="row-side">
      <span class="row-count"><b>${ns.resolution ? 1 : 0}</b>/1</span>
      <span class="row-state">${{ done: 'Done', skip: 'Skipped' }[ns.resolution] || 'To do'}</span>
    </span>
  </button>`;
}

function harvestRowHTML() {
  const ht = state.harvestTable;
  const site = siteById(DAY.harvestTable.siteId);
  const st = ht.status ? 'done' : ht.photos.length ? 'progress' : 'new';
  const sub = ht.status ? `${ht.status === 'ontime' ? 'On time' : 'Late'} · photo on file` : 'Photo required to complete';
  return `<button class="row row-featured st-${st}" data-action="harvest-table">
    <span class="feat-icon">${ICON.harvest}</span>
    <span class="row-main">
      <span class="row-time">${esc(DAY.harvestTable.time)} · ${esc(site.name)}</span>
      <span class="row-title">Harvest Table</span>
      <span class="feat-sub">${sub}</span>
    </span>
    <span class="row-side">
      <span class="row-count"><b>${ht.status ? 1 : 0}</b>/1</span>
      <span class="row-state">${ht.status ? 'Done' : 'Featured'}</span>
    </span>
  </button>`;
}

function harvestTableSheet() {
  const ht = state.harvestTable;
  const has = ht.photos.length > 0;
  const photos = `<div class="photos">
    ${ht.photos.map((p, i) => `<div class="thumb"><img src="${p}" alt="Harvest Table photo ${i + 1}">${ht.status ? '' : `<button class="thumb-x" data-action="ht-photo-del" data-idx="${i}" aria-label="Remove photo">×</button>`}</div>`).join('')}
    ${ht.status ? '' : `<label class="photo-add">${ICON.camera}<span>Add</span><input class="vh" type="file" accept="image/*" multiple data-photo="harvest-table"></label>`}
  </div>`;
  const head = `<div class="sheet-kicker feat-kicker">Featured · ${esc(DAY.harvestTable.time)} · ${esc(siteById(DAY.harvestTable.siteId).name)}</div>
    <h3 class="sheet-title">Harvest Table</h3>`;
  if (ht.status) {
    openSheet(`${head}<p class="sheet-p">✓ Done · ${ht.status === 'ontime' ? 'on time' : 'late'}</p>${photos}
      <div class="sheet-actions"><button class="btn btn-ghost" data-action="ht-undo">Undo</button><button class="btn btn-primary" data-action="sheet-cancel">Close</button></div>`);
    return;
  }
  openSheet(`${head}
    <div class="field-label"><span>Table photo</span>${has ? '<span class="ok">✓ Photo added</span>' : '<span class="req">Required</span>'}</div>
    <p class="sheet-p small">This photo is the quality and client record. No photo, not complete.</p>
    ${photos}
    <div class="sheet-actions">
      <button class="btn btn-ghost${has ? '' : ' is-locked'}" data-action="ht-done" data-val="late">Done · late</button>
      <button class="btn btn-primary${has ? '' : ' is-locked'}" data-action="ht-done" data-val="ontime">Done · on time</button>
    </div>`);
}

function navHTML() {
  const item = (icon, label, active) => `<span class="nav-item${active ? ' active' : ''}">${icon}<span>${label}</span></span>`;
  return `<nav class="bottom-nav" aria-label="Main (demo only)">
    ${item(ICON.home, 'Home', true)}${item(ICON.history, 'History')}${item(ICON.harvest, 'Harvest')}${item(ICON.more, 'More')}
  </nav>`;
}

function renderHome() {
  const app = $('#app');
  app.className = 'view-home';
  app.innerHTML = `${clockHTML()}
    ${bandHTML()}
    <main class="home">
      <h2 class="list-h">Sites today</h2>
      <div class="list">${DAY.sites.map((s) => siteRowHTML(s) + (s.id === DAY.harvestTable.siteId ? harvestRowHTML() : '')).join('')}</div>
      <h2 class="list-h">Other work</h2>
      <div class="list">${nonSiteRowHTML()}</div>
      <button class="reset-link" data-action="reset">Reset demo day</button>
    </main>
    ${navHTML()}`;
  checkCelebrate();
}

/* ===================== SITE FORM ===================== */
function formSubText(site) {
  const c = siteChecks(site);
  return `${site.window} · ${c.done}/${c.total} checks${state.sites[site.id].submittedAt ? ' · Submitted' : ''}`;
}

function sectionClass(site, st, key) {
  const c = ['sec'];
  if (st.open[key]) c.push('open');
  if (woFor(site, key)) c.push(woResolved(site, st) ? 'wo-ok' : 'has-wo');
  if (sectionSummary(st, key)) c.push('has-data');
  return c.join(' ');
}

function secMetaHTML(site, st, key) {
  const bits = [];
  const sum = sectionSummary(st, key);
  if (sum) bits.push(`<span class="sec-sum">${esc(sum)}</span>`);
  if (woFor(site, key)) {
    bits.push(woResolved(site, st) ? '<span class="chip chip-ok">✓ Work order</span>' : '<span class="chip chip-wo">Work order</span>');
  } else if (nudgeFor(site, st, key)) {
    bits.push('<span class="nudge-text">Overdue</span>');
  }
  return bits.join('');
}

function micBtn(targetId) {
  return `<button type="button" class="mic" data-action="mic" data-target="${targetId}" aria-label="Dictate">${ICON.mic}</button>`;
}

function woCardHTML(site, st) {
  const wo = site.workOrder;
  const w = st.wo;
  const list = woChecklist(site, st);
  const tags = [];
  if (wo.recurring) tags.push(`<span class="tag">↻ ${esc(wo.recurring)}</span>`);
  if (wo.requireDescription) tags.push('<span class="tag">Description required</span>');
  if (wo.requirePhoto) tags.push('<span class="tag">Photo required</span>');

  let body;
  if (w.resolution === 'skip') {
    body = `<div class="wo-status skip">Can't do · ${esc(w.reason)}</div>`;
  } else if (w.resolution === 'done' && woResolved(site, st)) {
    body = `<div class="wo-status ok">${ICON.check} Done</div>`;
  } else {
    const warn = w.resolution === 'done' ? '<div class="wo-status warn">Marked done, but something changed:</div>' : '';
    body = `${warn}${list.length ? `<ul class="wo-list">${list.map((i) => `<li class="${i.met ? 'met' : ''}">${i.met ? ICON.check : '<span class="box"></span>'}${esc(i.label)}</li>`).join('')}</ul>` : ''}`;
  }
  const actions = w.resolution
    ? '<button class="btn-link" data-action="wo-undo">Undo</button>'
    : '<button class="btn btn-small btn-primary" data-action="wo-done">Mark done</button><button class="btn btn-small btn-ghost" data-action="wo-skip">Can\'t do</button>';
  return `<div class="wo-kicker">Work order</div>
    <div class="wo-title">${esc(wo.title)}</div>
    ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
    ${body}
    <div class="wo-actions">${actions}</div>`;
}

function noteReqHTML(site, st, key) {
  const r = noteRequirement(site, st, key);
  return r ? `<span class="req">${esc(r)}</span>` : '<span class="opt">Optional</span>';
}

function photoPromptHTML(site, st, key) {
  const p = photoPrompt(site, st, key);
  const has = st.sections[key].photos.length > 0;
  if (p === 'required') return has ? '<span class="ok">✓ Photo added</span>' : '<span class="req">Photo required</span>';
  if (p === 'suggested' && !has) return '<span class="sugg">Photo suggested</span>';
  return '';
}

const cropReqHTML = (c) => (isLow(CROP_SCALE, c.status) ? `<span class="req">${esc(c.status)} — describe what's wrong · photo suggested</span>` : '');

function pestsHTML(sec) {
  return `<div class="field" data-field="pests-rating">
    <div class="field-label"><span>Pest pressure</span></div>
    <div class="seg">${PEST_SCALE.map(([w]) => `<button class="seg-btn${sec.rating === w ? ' on' : ''}" data-action="rate" data-val="${w}">${w}</button>`).join('')}</div>
  </div>`;
}

function cropsHTML(sec, wo) {
  const targets = (wo && wo.cropsToUpdate) || [];
  const opts = (cur) => `<option value="">Update status…</option>${CROP_SCALE.map(([w]) => `<option value="${w}"${cur === w ? ' selected' : ''}>${w}</option>`).join('')}<option value="${CROP_DONE}"${cur === CROP_DONE ? ' selected' : ''}>Done (retired)</option>`;
  return `<div class="field"><div class="field-label"><span>Crop list</span><span class="opt">${sec.crops.length} crops</span></div>
    <div class="crops">${sec.crops.map((c, i) => `
      <div class="crop${targets.includes(c.name) && !c.status ? ' crop-target' : ''}" data-field="cropstatus-${i}">
        <div class="crop-top">
          <div class="crop-id"><div class="crop-name">${esc(c.name)}</div><div class="crop-count">${c.count} plants · last: ${esc(lastStatus(c.name))}</div></div>
          <select class="pick${c.status ? ' set' : ''}" data-bind="cropStatus" data-idx="${i}" aria-label="${esc(c.name)} status">${opts(c.status)}</select>
        </div>
        <div class="crop-note" data-field="cropnote-${i}">
          <div class="note-wrap"><textarea id="cropnote-${i}" rows="1" data-bind="cropNote" data-idx="${i}" placeholder="Note on ${esc(c.name)}">${esc(c.note)}</textarea>${micBtn(`cropnote-${i}`)}</div>
          <div class="hint" data-derived="crop-req" data-idx="${i}">${cropReqHTML(c)}</div>
        </div>
      </div>`).join('')}
    </div></div>`;
}

function harvestHTML(sec) {
  const used = new Set(sec.rows.map((r) => r.crop));
  const avail = CROPS.filter((c) => !used.has(c.name));
  const rows = sec.rows.map((r, i) => `
    <div class="hrow">
      <span class="hrow-name">${esc(r.crop)}</span>
      <div class="stepper">
        <button data-action="step" data-idx="${i}" data-d="-1" aria-label="Less ${esc(r.crop)}">−</button>
        <span class="qty" data-qty="${i}">${r.qty}</span>
        <button data-action="step" data-idx="${i}" data-d="1" aria-label="More ${esc(r.crop)}">+</button>
      </div>
      <button class="x" data-action="harvest-del" data-idx="${i}" aria-label="Remove ${esc(r.crop)}">×</button>
    </div>`).join('');
  let add = '';
  if (avail.length) {
    add = ui.harvestPicker
      ? `<div class="pick-chips">${avail.map((c) => `<button class="chip-btn" data-action="harvest-add" data-val="${esc(c.name)}">+ ${esc(c.name)}</button>`).join('')}</div>`
      : '<button class="add-row" data-action="harvest-open">+ Add a crop</button>';
  }
  return `<div class="field"><div class="field-label"><span>Harvested</span><span class="opt">qty</span></div>${rows}${add}</div>`;
}

function photosHTML(st, key) {
  const sec = st.sections[key];
  return `<div class="field" data-field="photos-${key}">
    <div class="field-label"><span>Photos</span><span data-derived="photo-prompt"></span></div>
    <div class="photos">
      ${sec.photos.map((p, i) => `<div class="thumb"><img src="${p}" alt="Photo ${i + 1}"><button class="thumb-x" data-action="photo-del" data-idx="${i}" aria-label="Remove photo">×</button></div>`).join('')}
      <label class="photo-add">${ICON.camera}<span>Add</span><input class="vh" type="file" accept="image/*" multiple data-photo="${key}"></label>
    </div>
  </div>`;
}

function sectionBodyHTML(site, st, key) {
  const sec = st.sections[key];
  const wo = woFor(site, key);
  const nudge = nudgeFor(site, st, key);
  let h = '';
  if (wo) h += '<div class="wo-card" data-field="wo" data-derived="wo"></div>';
  if (nudge) h += `<p class="nudge-text nudge-line">${esc(nudge)}</p>`;
  if (key === 'pests') h += pestsHTML(sec);
  if (key === 'crops') h += cropsHTML(sec, wo);
  if (key === 'harvest') h += harvestHTML(sec);
  const placeholder = { incident: 'Who, what happened?', infrastructure: 'Beds, fences, tools, structures…', external: 'Exterior, frontage, signage, street side…', irrigation: 'Timers, leaks, watering…' }[key] || 'What did you see or do?';
  h += `<div class="field" data-field="note-${key}">
    <div class="field-label"><label for="note-${key}">${key === 'incident' ? 'What happened' : 'Description'}</label><span data-derived="note-req"></span></div>
    <div class="note-wrap"><textarea id="note-${key}" rows="2" data-bind="note" placeholder="${placeholder}">${esc(sec.note)}</textarea>${micBtn(`note-${key}`)}</div>
  </div>`;
  h += photosHTML(st, key);
  return h;
}

function sectionHTML(site, st, s) {
  return `<section class="${sectionClass(site, st, s.key)}" data-sec="${s.key}" id="sec-${s.key}">
    <button class="sec-head" data-action="toggle" aria-expanded="${!!st.open[s.key]}">
      <span class="sec-label">${esc(s.label)}</span>
      <span class="sec-meta" data-derived="meta"></span>
      <span class="chev">${ICON.chev}</span>
    </button>
    <div class="sec-body">${sectionBodyHTML(site, st, s.key)}</div>
  </section>`;
}

function renderForm(siteId) {
  const site = siteById(siteId);
  if (!site) return go('');
  const st = state.sites[siteId];
  ui.harvestPicker = false;
  const app = $('#app');
  app.className = 'view-form';
  app.innerHTML = `<header class="form-head">
      <button class="back" data-action="home" aria-label="Back to today">${ICON.back}</button>
      <div class="form-head-txt"><div class="form-title">${esc(site.name)}</div><div class="form-sub" id="form-sub"></div></div>
    </header>
    <main class="form">
      <p class="form-hint">Tap a section if it happened. Blank means nothing to report.</p>
      ${SECTIONS.map((s) => sectionHTML(site, st, s)).join('')}
    </main>
    <div class="actionbar">
      <button class="btn btn-ghost" data-action="save">Save</button>
      <button class="btn btn-primary" data-action="submit">Submit site</button>
    </div>`;
  refreshDerived(site);
}

// Update requirement hints, chips, and validation without touching inputs (keeps focus while typing).
function refreshDerived(site) {
  const st = state.sites[site.id];
  const sub = $('#form-sub');
  if (sub) sub.textContent = formSubText(site);
  const bad = invalidFields(site, st);
  for (const { key } of SECTIONS) {
    const el = document.getElementById(`sec-${key}`);
    if (!el) continue;
    const wo = el.querySelector('[data-derived="wo"]');
    if (wo) wo.innerHTML = woCardHTML(site, st);
    const nr = el.querySelector('[data-derived="note-req"]');
    if (nr) nr.innerHTML = noteReqHTML(site, st, key);
    const pp = el.querySelector('[data-derived="photo-prompt"]');
    if (pp) pp.innerHTML = photoPromptHTML(site, st, key);
    el.querySelectorAll('[data-derived="crop-req"]').forEach((n) => { n.innerHTML = cropReqHTML(st.sections.crops.crops[+n.dataset.idx]); });
    el.querySelectorAll('[data-field]').forEach((f) => f.classList.toggle('invalid', bad.has(f.dataset.field)));
    el.className = sectionClass(site, st, key) + (el.querySelector('.invalid') ? ' invalid' : '');
    el.querySelector('[data-derived="meta"]').innerHTML = secMetaHTML(site, st, key);
    el.querySelector('.sec-head').setAttribute('aria-expanded', String(!!st.open[key]));
  }
  const btn = $('[data-action="submit"]');
  if (btn) btn.textContent = st.submittedAt ? 'Resubmit' : 'Submit site';
}

function rerenderSection(site, key) {
  const body = $(`#sec-${key} .sec-body`);
  if (body) body.innerHTML = sectionBodyHTML(site, state.sites[site.id], key);
  refreshDerived(site);
}

function touch(st) { st.touched = true; save(); }

function sitePayload(site, st) {
  return {
    siteId: site.id,
    siteName: site.name,
    sections: Object.fromEntries(SECTIONS.map(({ key }) => {
      const sec = st.sections[key];
      const out = { note: sec.note.trim(), photoCount: sec.photos.length };
      if (key === 'pests') out.rating = sec.rating ? { word: sec.rating, score: scoreOf(PEST_SCALE, sec.rating) } : null;
      if (key === 'crops') out.crops = sec.crops.map((c) => ({ name: c.name, count: c.count, status: c.status, score: scoreOf(CROP_SCALE, c.status), note: c.note.trim() }));
      if (key === 'harvest') out.rows = sec.rows;
      return [key, out];
    })),
    workOrder: site.workOrder ? { id: site.workOrder.id, ...st.wo } : null,
  };
}

function submitSite(site) {
  const st = state.sites[site.id];
  const blockers = submitBlockers(site, st);
  if (blockers.length) {
    ui.tried[site.id] = true;
    blockers.forEach((b) => { st.open[b.key] = true; });
    save();
    refreshDerived(site);
    const first = $('.view-form [data-field].invalid');
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(blockers.length === 1 ? blockers[0].msg : `${blockers.length} things left — ${blockers[0].msg}`);
    return;
  }
  st.submittedAt = Date.now();
  st.touched = true;
  save();
  DataService.submit('site_visit', sitePayload(site, st));
  toast(`${site.name} submitted`);
  go('');
}

/* ===================== PHOTOS ===================== */
// Downscale before storing so localStorage doesn't fill up (demo keeps photos on-device only).
function downscale(file, max = 900, q = 0.68) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

/* ===================== VOICE ===================== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function toggleMic(btn) {
  const ta = document.getElementById(btn.dataset.target);
  if (!ta) return;
  if (rec) { rec.stop(); return; }
  if (!SR) {
    toast('Voice typing isn’t available in this browser — use the keyboard mic or type.');
    ta.focus();
    return;
  }
  rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  const base = ta.value.trim() ? `${ta.value.trim()} ` : '';
  rec.onresult = (ev) => {
    let txt = '';
    for (const r of ev.results) txt += r[0].transcript;
    ta.value = base + txt;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const end = () => { btn.classList.remove('listening'); rec = null; };
  rec.onend = end;
  rec.onerror = (ev) => {
    end();
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast('Voice input is blocked here — use the keyboard mic or type.');
  };
  btn.classList.add('listening');
  try { rec.start(); } catch { end(); }
}

/* ===================== SHEETS / TOAST / CONFETTI ===================== */
function openSheet(html) {
  const open = $('.sheet-backdrop.show .sheet');
  if (open) { open.innerHTML = html; return; } // already up: swap content, no slide-in replay
  $('#sheet-root').innerHTML = `<div class="sheet-backdrop" data-action="sheet-close"><div class="sheet" role="dialog" aria-modal="true">${html}</div></div>`;
  requestAnimationFrame(() => { const b = $('.sheet-backdrop'); if (b) b.classList.add('show'); });
}
function closeSheet() { $('#sheet-root').innerHTML = ''; }

function reasonHTML(confirmAction, title, kicker) {
  return `<div class="sheet-kicker">${esc(kicker)}</div><h3 class="sheet-title">${esc(title)}</h3>
    <label class="field-label" for="reason"><span>Why can't it be done?</span><span class="req">Required</span></label>
    <div class="note-wrap"><textarea id="reason" rows="3" placeholder="Short reason"></textarea>${micBtn('reason')}</div>
    <div class="pick-chips">${QUICK_REASONS.map((r) => `<button class="chip-btn" data-action="quick-reason" data-val="${esc(r)}">${esc(r)}</button>`).join('')}</div>
    <div class="sheet-actions"><button class="btn btn-ghost" data-action="sheet-cancel">Cancel</button><button class="btn btn-primary" data-action="${confirmAction}">Save reason</button></div>`;
}

function nonSiteSheet() {
  const ns = state.nonSite;
  const head = `<div class="sheet-kicker">Work order · non-site</div><h3 class="sheet-title">${esc(DAY.nonSite.title)}</h3>`;
  if (ns.resolution) {
    openSheet(`${head}<p class="sheet-p">${ns.resolution === 'done' ? '✓ Marked done.' : `Skipped · ${esc(ns.reason)}`}</p>
      <div class="sheet-actions"><button class="btn btn-ghost" data-action="ns-undo">Undo</button><button class="btn btn-primary" data-action="sheet-cancel">Close</button></div>`);
  } else {
    openSheet(`${head}<div class="sheet-actions stack">
      <button class="btn btn-primary btn-big" data-action="ns-done">✓ Done</button>
      <button class="btn btn-ghost" data-action="ns-skip">Skip / N/A…</button></div>`);
  }
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function checkCelebrate() {
  const { done, total } = dayChecks();
  if (done === total && !state.celebrated) {
    state.celebrated = true;
    save();
    const band = $('#band');
    if (band) band.classList.add('just-complete');
    setTimeout(celebrate, 200);
  } else if (done < total && state.celebrated) {
    state.celebrated = false;
    save();
  }
}

function celebrate() {
  const root = $('#confetti');
  const colors = ['#54864C', '#E8EFC5', '#9CCBD0', '#FDCCA5', '#004D40', '#FFFFFF'];
  for (let i = 0; i < 44; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.35}s`;
    p.style.setProperty('--dx', `${Math.random() * 140 - 70}px`);
    p.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
    root.appendChild(p);
  }
  setTimeout(() => { root.innerHTML = ''; }, 2600);
  if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
}

/* ===================== ROUTING ===================== */
function go(path) { location.hash = path ? `#/${path}` : '#/'; }
function currentSite() {
  const m = location.hash.match(/^#\/site\/([\w-]+)/);
  return m ? siteById(m[1]) : null;
}
function route() {
  closeSheet();
  ui.tried = {};
  ui.woTried = {};
  const site = currentSite();
  if (site) renderForm(site.id); else renderHome();
  window.scrollTo(0, 0);
}

/* ===================== EVENTS ===================== */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action],[data-open-site]');
  if (!t) return;
  if (t.dataset.openSite) { go(`site/${t.dataset.openSite}`); return; }
  const a = t.dataset.action;
  if (a === 'sheet-close' && e.target !== t) return; // taps inside the sheet don't close it
  const secEl = t.closest('[data-sec]');
  const key = secEl && secEl.dataset.sec;
  const site = currentSite();
  const st = site && state.sites[site.id];
  const sec = st && key ? st.sections[key] : null;

  switch (a) {
    case 'home': go(''); break;
    case 'sheet-close': case 'sheet-cancel': closeSheet(); break;

    // --- clock ---
    case 'clock-in':
      state.clock.inAt = Date.now(); save();
      DataService.submit('clock_in', { at: state.clock.inAt });
      renderHome(); toast('Clocked in — have a good day');
      break;
    case 'clock-out':
      openSheet(`<div class="sheet-kicker">Time clock</div><h3 class="sheet-title">Clock out for the day?</h3>
        <p class="sheet-p">You've been on the clock ${fmtDur(Date.now() - state.clock.inAt)}. One punch per day — you won't be able to clock back in.</p>
        <div class="sheet-actions"><button class="btn btn-ghost" data-action="sheet-cancel">Not yet</button><button class="btn btn-primary" data-action="clock-out-confirm">Clock out</button></div>`);
      break;
    case 'clock-out-confirm':
      state.clock.outAt = Date.now(); save();
      DataService.submit('clock_out', { inAt: state.clock.inAt, outAt: state.clock.outAt });
      closeSheet(); renderHome(); toast(`Clocked out · ${fmtDur(state.clock.outAt - state.clock.inAt)}`);
      break;

    // --- non-site work order ---
    case 'nonsite': nonSiteSheet(); break;

    // --- Harvest Table (featured; photo required) ---
    case 'harvest-table': harvestTableSheet(); break;
    case 'ht-done':
      if (!state.harvestTable.photos.length) { toast('Add a photo of the table to complete it'); return; }
      state.harvestTable.status = t.dataset.val; save();
      DataService.submit('harvest_table', { id: DAY.harvestTable.id, siteId: DAY.harvestTable.siteId, status: t.dataset.val, photoCount: state.harvestTable.photos.length });
      closeSheet(); renderHome(); toast('Harvest Table done');
      break;
    case 'ht-undo': state.harvestTable.status = null; save(); renderHome(); harvestTableSheet(); break;
    case 'ht-photo-del': state.harvestTable.photos.splice(+t.dataset.idx, 1); save(); renderHome(); harvestTableSheet(); break;
    case 'ns-done':
      state.nonSite = { resolution: 'done', reason: '' }; save();
      DataService.submit('work_order', { id: DAY.nonSite.id, resolution: 'done' });
      closeSheet(); renderHome(); toast('Shredder drop-off done');
      break;
    case 'ns-skip': openSheet(reasonHTML('ns-skip-confirm', DAY.nonSite.title, 'Skip / N/A')); break;
    case 'ns-skip-confirm': {
      const reason = $('#reason').value.trim();
      if (!reason) { toast('Add a short reason'); $('#reason').focus(); return; }
      state.nonSite = { resolution: 'skip', reason }; save();
      DataService.submit('work_order', { id: DAY.nonSite.id, resolution: 'skip', reason });
      closeSheet(); renderHome();
      break;
    }
    case 'ns-undo': state.nonSite = { resolution: null, reason: '' }; save(); closeSheet(); renderHome(); break;
    case 'quick-reason': { const r = $('#reason'); r.value = t.dataset.val; r.focus(); break; }

    case 'reset':
      openSheet(`<div class="sheet-kicker">Demo</div><h3 class="sheet-title">Reset the demo day?</h3>
        <p class="sheet-p">Clears the clock, every form, photos and work orders.</p>
        <div class="sheet-actions"><button class="btn btn-ghost" data-action="sheet-cancel">Cancel</button><button class="btn btn-danger" data-action="reset-confirm">Reset</button></div>`);
      break;
    case 'reset-confirm':
      state = freshState(); save();
      try { localStorage.removeItem(OUTBOX_KEY); } catch { /* ignore */ }
      closeSheet(); renderHome(); toast('Demo day reset');
      break;

    // --- site form ---
    case 'toggle':
      st.open[key] = !st.open[key]; save();
      refreshDerived(site);
      break;
    case 'rate':
      sec.rating = sec.rating === t.dataset.val ? null : t.dataset.val;
      touch(st); rerenderSection(site, key);
      break;
    case 'step': {
      const row = sec.rows[+t.dataset.idx];
      row.qty = Math.max(0, row.qty + Number(t.dataset.d));
      $(`#sec-${key} [data-qty="${t.dataset.idx}"]`).textContent = row.qty;
      touch(st); refreshDerived(site);
      break;
    }
    case 'harvest-open': ui.harvestPicker = true; rerenderSection(site, key); break;
    case 'harvest-add':
      sec.rows.push({ crop: t.dataset.val, qty: 1 });
      ui.harvestPicker = false; touch(st); rerenderSection(site, key);
      break;
    case 'harvest-del': sec.rows.splice(+t.dataset.idx, 1); touch(st); rerenderSection(site, key); break;
    case 'photo-del': sec.photos.splice(+t.dataset.idx, 1); touch(st); rerenderSection(site, key); break;
    case 'mic': toggleMic(t); break;

    case 'wo-done': {
      const missing = woChecklist(site, st).filter((i) => !i.met);
      if (missing.length) {
        ui.woTried[site.id] = true; refreshDerived(site);
        const f = $(`[data-field="${missing[0].field}"]`);
        if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast(`Still needed: ${missing.map((i) => i.label.toLowerCase()).join(', ')}`);
        return;
      }
      st.wo = { resolution: 'done', reason: '' }; touch(st);
      DataService.submit('work_order', { id: site.workOrder.id, siteId: site.id, resolution: 'done' });
      refreshDerived(site); toast('Work order done');
      break;
    }
    case 'wo-skip': openSheet(reasonHTML('wo-skip-confirm', site.workOrder.title, "Can't do")); break;
    case 'wo-skip-confirm': {
      const reason = $('#reason').value.trim();
      if (!reason) { toast('Add a short reason'); $('#reason').focus(); return; }
      st.wo = { resolution: 'skip', reason }; touch(st);
      DataService.submit('work_order', { id: site.workOrder.id, siteId: site.id, resolution: 'skip', reason });
      closeSheet(); refreshDerived(site);
      break;
    }
    case 'wo-undo': st.wo = { resolution: null, reason: '' }; ui.woTried[site.id] = false; save(); refreshDerived(site); break;

    case 'save': save(); toast('Draft saved'); break;
    case 'submit': submitSite(site); break;
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  const site = currentSite();
  if (!site || !t.dataset.bind) return;
  const st = state.sites[site.id];
  const key = t.closest('[data-sec]').dataset.sec;
  if (t.dataset.bind === 'note') st.sections[key].note = t.value;
  else if (t.dataset.bind === 'cropNote') st.sections.crops.crops[+t.dataset.idx].note = t.value;
  else return;
  touch(st);
  refreshDerived(site);
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.photo === 'harvest-table') {
    const files = [...t.files];
    t.value = '';
    for (const f of files) {
      try { state.harvestTable.photos.push(await downscale(f)); } catch { toast('Couldn’t read that photo'); }
    }
    save(); renderHome(); harvestTableSheet();
    return;
  }
  const site = currentSite();
  if (!site) return;
  const st = state.sites[site.id];
  if (t.dataset.bind === 'cropStatus') {
    st.sections.crops.crops[+t.dataset.idx].status = t.value || null;
    touch(st);
    rerenderSection(site, 'crops');
  } else if (t.dataset.photo) {
    const key = t.dataset.photo;
    const files = [...t.files];
    t.value = '';
    for (const f of files) {
      try { st.sections[key].photos.push(await downscale(f)); } catch { toast('Couldn’t read that photo'); }
    }
    touch(st);
    rerenderSection(site, key);
  }
});

// Live clock tick
setInterval(() => {
  const el = $('#clock-elapsed');
  if (el && state.clock.inAt && !state.clock.outAt) el.innerHTML = elapsedHTML(Date.now() - state.clock.inAt);
}, 1000);

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator) {
  // When a new deploy's worker takes over, reload once onto it (state is in localStorage, so nothing is lost).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      // Installed iOS apps resume rather than relaunch, so check for a new version on every resume.
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    }).catch(() => {});
  });
}
