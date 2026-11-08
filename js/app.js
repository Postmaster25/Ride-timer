import {
  validatePlan, rideSteps, findRide, allRides, lastWeek, calendar, toYMD, WEEKDAYS,
  description, totalSeconds, stageHours, planTotals, weekMinutes, mainSteps, dayMinutes,
} from './plan.js';
import { buildCues, resumeSegs, durSegs } from './cues.js';
import { Voice, Wake } from './audio.js';

const $ = sel => document.querySelector(sel);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Show unexpected errors on the page, so a broken button never fails silently.
const showError = msg => {
  let bar = document.getElementById('errorBar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'errorBar'; bar.className = 'errorbar'; document.body.prepend(bar); bar.onclick = () => bar.remove(); }
  bar.textContent = `Something went wrong: ${msg} (tap to dismiss)`;
};
window.addEventListener('error', e => showError(e.message));
window.addEventListener('unhandledrejection', e => showError(e.reason?.message || String(e.reason)));

// ---------- storage (Safari can block or clear it) ----------
let storageOk = true;
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`rt.${key}`); return v == null ? fallback : JSON.parse(v); } catch { storageOk = false; return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`rt.${key}`, JSON.stringify(value)); return true; } catch { storageOk = false; return false; }
  },
};

const state = {
  plan: store.get('plan', null),
  startDate: store.get('startDate', ''),
  ftp: store.get('ftp', 235),
  ftpHistory: store.get('ftpHistory', []), // newest first: { date: 'YYYY-MM-DD', from, to }
  voiceOn: store.get('voiceOn', true),
  skips: store.get('skips', {}),
};
const save = key => store.set(key, state[key]);

const voice = new Voice();
const wake = new Wake($('#wakeVideo'));
const keepAlive = $('#keepAliveAudio');

// ---------- icons ----------
const svg = (body, fill = false) => `<svg viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;
const ICON = {
  ride: svg('<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/><path d="M15 6h2l1.5 11M5.5 17l4-8h6l-6.5 8M9 6h3"/>'),
  run: svg('<circle cx="14" cy="4" r="2"/><path d="M6 21l3-6 3 2v5M8 12l2-4 4 1 3 4h3M10 8l-3 1-2 3"/>'),
  strength: svg('<path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/>'),
  rest: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  cal: svg('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  left: svg('<path d="M15 5l-7 7 7 7"/>'),
  right: svg('<path d="M9 5l7 7-7 7"/>'),
  down: svg('<path d="M6 9l6 6 6-6"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  bolt: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', true),
  heart: svg('<path d="M12 21s-7.5-4.6-9.5-9.3C1 8 3.4 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.6 0 6 3.5 4.5 7.2C19.5 16.4 12 21 12 21z"/>', true),
  copy: svg('<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
  play: svg('<path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z"/>', true),
  pause: svg('<rect x="6" y="4" width="4.5" height="16" rx="1.5"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.5"/>', true),
  stop: svg('<rect x="5" y="5" width="14" height="14" rx="3"/>', true),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="3"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  volume: svg('<path d="M11 5L6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3"/>'),
  paste: svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};
const KIND_COLOR = { ride: '--bike', run: '--run', strength: '--lift', rest: '--off', free: '--off' };
const kico = kind => `<div class="kico k-${kind}">${ICON[kind] || ICON.rest}</div>`;
const STEP_HEX = { warmup: '#3EA6FF', cooldown: '#3EA6FF', recovery: '#3EA6FF', work: '#FF6B2C', steady: '#34D399' };
const STEP_NAME = { warmup: 'Warm-up', work: 'Interval', recovery: 'Recovery', cooldown: 'Cool down', steady: 'Steady' };
const stepName = s => s.label || STEP_NAME[s.type] || s.type;

// ---------- formatting ----------
const WEEKDAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const today = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; };
const fmtDate = d => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
const fmtLongDate = d => d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const fmtClock = sec => {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
};
// "1 h 30 min", "50 min", "45 s"
const hmin = sec => {
  sec = Math.round(sec);
  if (sec < 60) return `${sec} s`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};
const hrs = min => (min / 60).toFixed(1);
// Ranges: "185–195", "under 130" (a 0 W floor or HR ceiling only), "over 150".
const rng = (lo, hi) => {
  if (lo == null && hi == null) return '';
  if (lo != null && hi != null && lo > 0) return lo === hi ? `${hi}` : `${lo}–${hi}`;
  return hi != null ? `under ${hi}` : `over ${lo}`;
};
// Watts for a step: trainer watts, or an outdoor step's indoor watts.
const wattsOf = s => (s.wattsHigh != null || s.wattsLow != null) ? [s.wattsLow, s.wattsHigh]
  : (s.indoorHigh != null || s.indoorLow != null) ? [s.indoorLow, s.indoorHigh] : null;
const wTxt = s => { const w = wattsOf(s); return w ? rng(w[0], w[1]) : ''; };
const hTxt = s => rng(s.hrLow, s.hrHigh);
const cadTxt = s => s.cadenceLow != null && s.cadenceHigh != null ? `${rng(s.cadenceLow, s.cadenceHigh)} rpm` : s.cadenceLow != null ? `${s.cadenceLow}+ rpm` : '';
const rpeNum = s => { const m = /\d+/.exec(String(s.rpe ?? '')); return m ? Math.min(10, +m[0]) : null; };
const stripNum = name => String(name || '').replace(/^\s*\d+\s*[.)]\s*/, '');

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const old = btn.innerHTML;
  btn.innerHTML = `${ICON.check}Copied`;
  setTimeout(() => { btn.innerHTML = old; }, 1500);
}

// Bar chart of a ride's shape: width is time, height is the watt target
// (heart rate or effort when a step has no watts), colored by step type.
function profile(steps, { w = 320, h = 46, ftp = null } = {}) {
  const val = s => wattsOf(s)?.[1] ?? s.hrHigh ?? (rpeNum(s) ? rpeNum(s) * 20 : 60);
  const usesWatts = steps.some(s => wattsOf(s));
  const total = totalSeconds(steps) || 1;
  const top = Math.max(...steps.map(val), 1);
  const max = usesWatts && ftp ? Math.max(ftp * 1.15, top * 1.05) : top * 1.05;
  let x = 0;
  const rects = steps.map(s => {
    const ww = s.seconds / total * w, hh = Math.max(6, val(s) / max * (h - 2));
    const r = `<rect x="${(x + 1).toFixed(1)}" y="${(h - hh).toFixed(1)}" width="${Math.max(1, ww - 2).toFixed(1)}" height="${hh.toFixed(1)}" rx="${Math.min(4, Math.max(0.5, (ww - 2) / 2)).toFixed(1)}" fill="${STEP_HEX[s.type] || '#888'}"/>`;
    x += ww;
    return r;
  }).join('');
  let line = '';
  if (usesWatts && ftp) {
    const y = (h - ftp / max * (h - 2)).toFixed(1);
    line = `<line x1="0" x2="${w}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,.35)" stroke-dasharray="3 4"/><text x="${w - 2}" y="${y - 5}" fill="rgba(255,255,255,.55)" font-size="10" font-weight="600" text-anchor="end">FTP ${ftp}</text>`;
  }
  return `<svg class="prof" viewBox="0 0 ${w} ${h}" aria-hidden="true">${rects}${line}</svg>`;
}

// ---------- sheet ----------
function openSheet(html) {
  $('#sheetBody').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.classList.add('noscroll');
}
function closeSheet() {
  $('#sheet').hidden = true;
  document.body.classList.remove('noscroll');
}

// ---------- routing ----------
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
window.addEventListener('hashchange', route);

let lastHash = null;
function route() {
  if (run && !run.done && location.hash !== '#/timer') { location.hash = '#/timer'; return; }
  closeSheet();
  // A new page starts at the top; re-rendering the same page keeps its place.
  if (location.hash !== lastHash) { lastHash = location.hash; window.scrollTo(0, 0); }
  const [, page, arg] = (location.hash || '#/').split('/');
  const p = page || 'week';
  document.body.dataset.page = p;
  const tab = p === 'ride' ? 'week' : p;
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  if (p === 'ride') return renderRide(decodeURIComponent(arg || ''));
  if (p === 'timer') return run ? renderTimer() : go('#/');
  if (p === 'settings') return renderSettings();
  if (p === 'overview') return renderOverview();
  return renderWeek(arg ? parseInt(arg, 10) : null);
}

const noPlan = what => `<section class="card empty">
  <h2>No plan loaded yet</h2>
  <p class="muted">Import the plan JSON in Settings to see ${what}.</p>
  <button data-go="#/settings">Open Settings</button></section>`;

// ---------- week view ----------
let picked = null; // { week, title } of a ride tapped in the week view

function stageOf(plan, week) {
  return (Array.isArray(plan.stages) ? plan.stages : []).find(s => week >= s.startWeek && week <= s.endWeek) || null;
}

function renderWeek(weekNum) {
  const plan = state.plan;
  if (!plan) { view.innerHTML = noPlan('your weeks'); return; }
  const cal = calendar(state.startDate);
  const last = lastWeek(plan);
  const now = today();
  const nowYMD = toYMD(now);
  const curWeek = cal ? cal.weekOf(now) : 1;
  const wk = Math.min(Math.max(weekNum || Math.min(Math.max(curWeek, 1), last), 1), last);
  const weekData = plan.weeks.find(w => w.week === wk);

  let banner = '';
  if (!cal) banner = `<div class="banner"><span>Set your start date to put the plan on the calendar.</span><button data-go="#/settings">Set start date</button></div>`;
  else if (cal.daysUntilStart(now) > 0) banner = `<div class="banner">Plan starts in ${cal.daysUntilStart(now)} day${cal.daysUntilStart(now) === 1 ? '' : 's'}.</div>`;
  else if (curWeek > last) banner = `<div class="banner">Plan complete.</div>`;

  const days = [1, 2, 3, 4, 5, 6, 7].map(wd => {
    const date = cal ? cal.dateOf(wk, wd) : null;
    const ymd = date ? toYMD(date) : null;
    return { wd, date, ymd, isToday: ymd === nowYMD, past: ymd != null && ymd < nowYMD, before: date && cal.beforeStart(date),
      items: (weekData?.days || []).filter(d => d.weekday === wd) };
  });
  // Days stay in order and one ride is open as a card: today's, until another
  // ride is tapped. That one opens in place; a second tap brings back today's.
  const openTitle = picked?.week === wk ? picked.title : null;

  const stage = stageOf(plan, wk);
  const range = cal ? `${fmtDate(cal.dateOf(wk, 1))} – ${fmtDate(cal.dateOf(wk, 7))}` : 'Preview';
  const eyebrow = [stage ? stripNum(stage.name) : '', range, `${hrs(weekMinutes(plan, wk))} h`].filter(Boolean).join(' · ');

  const strip = days.map(d => {
    const kinds = [...new Set(d.items.map(i => i.kind).filter(k => k === 'ride' || k === 'run' || k === 'strength'))];
    const ride = d.items.find(i => i.kind === 'ride');
    const sel = ride && ride.title === openTitle;
    return `<button class="d${d.isToday ? ' today' : ''}${d.past || d.before ? ' past' : ''}${sel ? ' sel' : ''}" ${ride && !d.before ? `data-open="${esc(ride.title)}"` : 'tabindex="-1"'}>
      <b>${WEEKDAYS[d.wd - 1][0]}</b><span class="num">${d.date ? d.date.getDate() : d.wd}</span>
      <i>${kinds.map(k => `<em style="background:var(${KIND_COLOR[k]})"></em>`).join('')}</i></button>`;
  }).join('');

  const rows = [];
  for (const d of days) {
    const base = `<div class="wd"><b>${WEEKDAYS[d.wd - 1]}</b>${d.date ? `<span>${d.date.getDate()}</span>` : ''}</div>`;
    const cls = `${d.past || d.before ? ' past' : ''}${d.isToday ? ' today' : ''}`;
    if (d.before) { rows.push(`<div class="row${cls}">${kico('rest')}${base}<div class="tx"><b>Before start</b></div></div>`); continue; }
    if (!d.items.length) { rows.push(`<div class="row${cls}">${kico('rest')}${base}<div class="tx"><b>${d.wd === 7 ? 'Free' : 'Nothing planned'}</b></div></div>`); continue; }
    for (const item of d.items) {
      if (item.kind === 'ride' && (openTitle ? item.title === openTitle : d.isToday)) {
        rows.push(heroHtml({ ride: item, day: d }, !d.isToday, cal, now));
        continue;
      }
      if (item.kind === 'ride') {
        const steps = rideSteps(item, plan, state.ftp);
        const main = mainSteps(steps)[0] || steps[0];
        const skipped = !!state.skips[item.title];
        const sub = [item.title, hmin(totalSeconds(steps)), wTxt(main) ? `${wTxt(main)} W` : hTxt(main) ? `${hTxt(main)} bpm` : ''].filter(Boolean).join(' · ');
        rows.push(`<button class="row${cls}${skipped ? ' skipped' : ''}" data-pick="${esc(item.title)}" data-card="${esc(item.title)}">${kico('ride')}${base}
          <div class="tx"><b>${esc(item.name || item.title)}</b><span>${esc(sub)}</span></div>${skipped ? '<span class="tag">Skipped</span>' : `<span class="chev">${ICON.right}</span>`}</button>`);
      } else {
        const text = item.summary || (item.kind === 'rest' ? 'Rest' : item.kind === 'free' ? 'Free' : item.kind);
        const mins = dayMinutes(item);
        const sub = [{ strength: 'Strength', run: 'Run', rest: 'Rest', free: '' }[item.kind], mins ? hmin(mins * 60) : '', item.optional ? 'optional' : ''].filter(Boolean).join(' · ');
        rows.push(`<div class="row${cls}">${kico(item.kind)}${base}<div class="tx"><b>${esc(text)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div></div>`);
      }
    }
  }

  view.innerHTML = `${banner}
    <div class="wkhead"><div style="min-width:0"><div class="eyebrow">${esc(eyebrow)}</div>
      <button class="titlebtn" data-act="weeks" aria-label="Choose a week">Week ${wk} <span class="caret">${ICON.down}</span></button></div>
      <div class="navpills"><button data-go="#/week/${wk - 1}" ${wk <= 1 ? 'disabled' : ''} aria-label="Previous week">${ICON.left}</button>
        <button data-go="#/week/${wk + 1}" ${wk >= last ? 'disabled' : ''} aria-label="Next week">${ICON.right}</button></div></div>
    <div class="strip">${strip}</div>
    <div class="rows">${rows.join('')}</div>
    ${cal && curWeek >= 1 && curWeek <= last && wk !== curWeek ? `<button class="ghost wide" style="margin-top:14px" data-go="#/week/${curWeek}">Back to this week</button>` : ''}`;
}

function relDay(d, now) {
  if (!d.date) return WEEKDAY_FULL[d.wd - 1];
  const diff = Math.round((d.date - now) / 86400000);
  const when = diff === 0 ? 'Today' : diff === -1 ? 'Yesterday' : diff === 1 ? 'Tomorrow' : WEEKDAYS[d.wd - 1];
  return `${when} · ${diff === 0 || Math.abs(diff) === 1 ? `${WEEKDAYS[d.wd - 1]} ` : ''}${fmtDate(d.date)}`;
}

function heroHtml({ ride, day }, other, cal, now) {
  const steps = rideSteps(ride, state.plan, state.ftp);
  const main = mainSteps(steps)[0] || steps[0];
  const skipped = !!state.skips[ride.title];
  const chips = [`<span class="chip">${ICON.clock}${hmin(totalSeconds(steps))}</span>`];
  if (wTxt(main)) chips.push(`<span class="chip watts">${ICON.bolt}${wTxt(main)} W</span>`);
  if (hTxt(main)) chips.push(`<span class="chip hr">${ICON.heart}${hTxt(main)}</span>`);
  if (ride.outdoor) chips.push(`<span class="chip">Outdoor</span>`);
  if (skipped) chips.push(`<span class="tag">Skipped</span>`);
  return `<div class="hero${other ? ' other' : ''}" data-card="${esc(ride.title)}">
    <div class="top"><span class="eyebrow">${esc(relDay(day, now))}</span><span class="topr"><span class="code">${esc(ride.title)}</span>${other ? `<button class="iconbtn collapse" data-pick="${esc(ride.title)}" aria-label="Close">${ICON.down}</button>` : ''}</span></div>
    <h3><a href="#/ride/${encodeURIComponent(ride.title)}">${esc(ride.name || ride.title)}</a></h3>
    <div class="meta">${chips.join('')}</div>
    ${profile(steps, { w: 326, h: 46 })}
    <div class="btns"><button class="ghost" data-go="#/ride/${encodeURIComponent(ride.title)}">Details</button>
      <button data-start="${esc(ride.title)}">${ICON.play}Start ride</button></div>
  </div>`;
}

function weekPicker() {
  const plan = state.plan;
  const cal = calendar(state.startDate);
  const now = today();
  const curWeek = cal ? cal.weekOf(now) : null;
  const viewing = parseInt((location.hash.split('/')[2] || ''), 10) || Math.min(Math.max(curWeek || 1, 1), lastWeek(plan));
  const weeks = plan.weeks.map(w => w.week).sort((a, b) => a - b);
  const row = n => {
    const cur = n === curWeek, past = curWeek != null && n < curWeek;
    const dates = cal ? `${fmtDate(cal.dateOf(n, 1))} – ${fmtDate(cal.dateOf(n, 7))}` : '';
    return `<button class="wkr${cur ? ' cur' : ''}${past ? ' pastw' : ''}" data-week="${n}"><div class="wn num">${n}</div>
      <div class="tx"><b>Week ${n}${cur ? '<span class="nowtag">This week</span>' : ''}</b>${dates ? `<span>${dates}</span>` : ''}</div>
      <div class="wh num">${hrs(weekMinutes(plan, n))} h</div>${n === viewing ? `<span class="viewing">${ICON.check}</span>` : ''}</button>`;
  };
  const stages = Array.isArray(plan.stages) && plan.stages.length ? plan.stages : null;
  let body;
  if (stages) {
    body = stages.map((st, i) => {
      const isCur = curWeek != null && curWeek >= st.startWeek && curWeek <= st.endWeek;
      const dates = cal ? `${fmtDate(cal.dateOf(st.startWeek, 1))} – ${fmtDate(cal.dateOf(st.endWeek, 7))}` : '';
      return `<div class="stg"><span class="dot" style="background:${isCur ? 'var(--accent)' : 'var(--s3)'}"></span>${i + 1} · ${esc(stripNum(st.name))}<em>${dates}</em></div>
        ${weeks.filter(n => n >= st.startWeek && n <= st.endWeek).map(row).join('')}`;
    }).join('');
  } else body = weeks.map(row).join('');
  openSheet(`<div class="sheethead"><b>Jump to week</b>${curWeek && curWeek >= 1 && curWeek <= lastWeek(plan) ? `<button class="chipbtn" style="color:var(--accent)" data-week="${curWeek}">Today</button>` : ''}</div>${body}`);
  const target = $('#sheetBody .wkr.cur') || $(`#sheetBody [data-week="${viewing}"]`);
  if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
}

function toggleSkip(title) {
  if (state.skips[title]) delete state.skips[title];
  else state.skips[title] = true;
  save('skips');
  route();
}

// ---------- overview ----------

const patternKind = text => /volt|weight|strength|gym/i.test(text) ? '--lift' : /\brun/i.test(text) ? '--run'
  : /^\s*(free|rest|off)\b/i.test(text) || !text.trim() ? '--off' : '--bike';

function renderOverview() {
  const plan = state.plan;
  if (!plan) { view.innerHTML = noPlan('the overview'); return; }
  const cal = calendar(state.startDate);
  const now = today();
  const nowYMD = toYMD(now);
  const last = lastWeek(plan);
  const started = cal && cal.daysUntilStart(now) <= 0;
  const curWeek = started ? cal.weekOf(now) : null;
  const todayWd = started && curWeek <= last ? (now.getDay() + 6) % 7 + 1 : null;

  // What's left: every counted day from today on (all of it before the plan starts).
  const t = planTotals(plan);
  const left = cal ? planTotals(plan, (week, day) => toYMD(cal.dateOf(week, day.weekday)) >= nowYMD) : t;
  const pct = (part, whole) => whole ? Math.round((1 - part / whole) * 1000) / 10 : 0;
  const totalCard = `<div class="card m"><div class="k">Total hours</div><div class="v num">${hrs(t.minutes)}</div>
    <div class="s">${t.count} activities</div>
    <div class="bar"><div style="width:${pct(left.minutes, t.minutes)}%;background:var(--accent)"></div></div>
    <div class="left num"><b>${hrs(left.minutes)} h</b> · ${left.count} left</div></div>`;
  const kindCard = (label, k, noun) => `<div class="card m"><div class="k"><span class="dot" style="background:var(${KIND_COLOR[k]})"></span>${label}</div>
    <div class="v num">${t.byKind[k].count}<small>${noun}</small></div>
    <div class="s num">${hrs(t.byKind[k].minutes)} h</div>
    <div class="bar"><div style="width:${pct(left.byKind[k].count, t.byKind[k].count)}%;background:var(${KIND_COLOR[k]})"></div></div>
    <div class="left num"><b>${left.byKind[k].count} left</b> · ${hrs(left.byKind[k].minutes)} h</div></div>`;
  const cards = `<div class="mgrid">${totalCard}${kindCard('Bike', 'ride', 'rides')}${kindCard('Run', 'run', 'runs')}${kindCard('Weights', 'strength', 'sessions')}</div>`;

  const stages = Array.isArray(plan.stages) ? plan.stages : [];
  const curIdx = curWeek != null ? stages.findIndex(s => curWeek >= s.startWeek && curWeek <= s.endWeek) : -1;

  let progress = '';
  if (cal) {
    const head = started ? (curWeek > last ? `<b>Plan complete</b>` : `<b>Week ${curWeek} <span>of ${last}</span></b>`)
      : `<b>Starts ${fmtDate(cal.start)} <span>· ${last} weeks</span></b>`;
    const segs = stages.length ? stages : [{ name: '', startWeek: 1, endWeek: last }];
    progress = `<div class="card progcard"><div class="ph">${head}<span class="eyebrow">ends ${fmtDate(cal.dateOf(last, 7))}</span></div>
      <div class="bar stagebar">${segs.map((s, i) => `<div class="${i === curIdx ? 'cur' : curWeek != null && curWeek > s.endWeek ? 'done' : ''}" style="flex:${s.endWeek - s.startWeek + 1}"></div>`).join('')}</div>
      ${stages.length ? `<div class="stagelabels">${stages.map((s, i) => `<span class="${i === curIdx ? 'cur' : ''}" style="flex:${s.endWeek - s.startWeek + 1}">${esc(stripNum(s.name))}</span>`).join('')}</div>` : ''}</div>`;
  }

  const stageCards = stages.map((st, i) => {
    const h = stageHours(plan, st);
    const cur = i === curIdx;
    const wk = cur ? curWeek : st.startWeek; // the week a tapped day opens
    const weeks = st.startWeek === st.endWeek ? `Wk ${st.startWeek}` : `Wk ${st.startWeek}–${st.endWeek}`;
    const dates = cal ? ` · ${fmtDate(cal.dateOf(st.startWeek, 1))} – ${fmtDate(cal.dateOf(st.endWeek, 7))}` : '';
    const texts = [1, 2, 3, 4, 5, 6, 7].map(wd => String(st.days?.[wd] ?? st.days?.[String(wd)] ?? ''));
    const pattern = `<div class="pattern">${texts.map((x, j) => `<button class="${cur && todayWd === j + 1 ? 'today' : ''}" data-pday="${wk}:${j + 1}" aria-label="${WEEKDAY_FULL[j]}, week ${wk}">
        <b>${WEEKDAYS[j][0]}</b><span class="dot" style="background:var(${patternKind(x)})"></span><span>${esc(x || '–')}</span></button>`).join('')}</div>
      <a class="open-week" href="#/week/${wk}">Open week ${wk}${ICON.right}</a>`;
    return `<div class="card stage${cur ? ' cur' : ''}">
      <div class="h"><div class="t"><div class="n">${i + 1}</div><div><b>${esc(stripNum(st.name))}</b><span>${weeks}${dates}</span></div></div>
        <div style="display:flex;align-items:center;gap:8px"><div class="hr"><b class="num">${h.avg.toFixed(1)}<small> h/wk</small></b><span class="num">${h.min.toFixed(1)} – ${h.max.toFixed(1)}</span></div>
        </div></div>${pattern}</div>`;
  }).join('');

  view.innerHTML = `<div class="eyebrow">${esc(plan.planName || 'Training plan')} · v${esc(plan.version)}</div><h1 class="ltitle">Overview</h1>
    ${progress || '<div style="height:14px"></div>'}${cards}
    ${stages.length ? `<div class="sect"><h4>Stages</h4><span>Hours per week</span></div>${stageCards}` : ''}`;
}

// ---------- workout view ----------
// Repeated blocks (3 x tempo + recovery) are shown once with their total time.
// A last repeat that drops its recovery still counts toward the block.
function groupSteps(steps) {
  const same = (a, b) => a && b && a.type === b.type && a.seconds === b.seconds && (a.label || '') === (b.label || '')
    && a.wattsLow === b.wattsLow && a.wattsHigh === b.wattsHigh && a.indoorHigh === b.indoorHigh;
  const out = [];
  let i = 0;
  while (i < steps.length) {
    let best = null;
    for (let L = 1; L <= 4 && i + 2 * L <= steps.length + L; L++) {
      const block = steps.slice(i, i + L);
      if (block.length < L || !block.some(s => s.type === 'work')) continue;
      let k = 1;
      while (block.every((s, j) => same(s, steps[i + k * L + j]))) k++;
      let p = 0;
      while (p < L - 1 && same(block[p], steps[i + k * L + p])) p++;
      if (p && !block.slice(0, p).some(s => s.type === 'work')) p = 0;
      const cover = k * L + p;
      if (k >= 2 && (!best || cover > best.cover)) best = { block, times: k + (p ? 1 : 0), cover };
    }
    if (best) {
      const part = steps.slice(i, i + best.cover);
      out.push({ group: true, block: best.block, times: best.times, seconds: totalSeconds(part) });
      i += best.cover;
    } else out.push({ group: false, s: steps[i++] });
  }
  return out;
}

function stepRow(s, outdoor) {
  const w = wTxt(s);
  const subs = [w || !hTxt(s) ? (hTxt(s) ? `${hTxt(s)} bpm` : '') : '', outdoor ? '' : cadTxt(s), s.rpe ? `RPE ${s.rpe}` : ''].filter(Boolean);
  const right = w ? `<div class="w num">${w}<small>watts</small></div>` : hTxt(s) ? `<div class="w hr num">${hTxt(s)}<small>bpm</small></div>` : '';
  return `<div class="st"><div class="rail ${s.type}"></div><div class="dur num">${fmtClock(s.seconds)}</div>
    <div class="what"><b>${esc(stepName(s))}</b>${subs.length ? `<span>${esc(subs.join(' · '))}</span>` : ''}${s.notes ? `<span class="notes">${esc(s.notes)}</span>` : ''}</div>${right}</div>`;
}

function renderRide(title) {
  const found = findRide(state.plan, title);
  if (!found) { view.innerHTML = `<section class="card empty"><h2>Workout not found</h2><button data-go="#/">Back to week</button></section>`; return; }
  const { week, day } = found;
  const steps = rideSteps(day, state.plan, state.ftp);
  const desc = description(day, state.plan, state.ftp);
  const skipped = !!state.skips[day.title];
  const cal = calendar(state.startDate);
  const date = cal ? cal.dateOf(week, day.weekday) : null;
  const outdoor = !!day.outdoor;
  const total = totalSeconds(steps);
  const work = steps.filter(s => s.type === 'work').reduce((a, s) => a + s.seconds, 0);
  const steady = steps.filter(s => s.type === 'steady').reduce((a, s) => a + s.seconds, 0);
  const watts = steps.map(s => wattsOf(s)?.[1]).filter(v => v != null);
  const hrMax = steps.map(s => s.hrHigh).filter(v => v != null);
  const mins = sec => `${Math.round(sec / 60)}<small> min</small>`;
  const peak = watts.length ? `${Math.max(...watts)}<small> W</small>` : hrMax.length ? `${Math.max(...hrMax)}<small> bpm</small>` : '–';
  const groups = groupSteps(steps);
  let mainNamed = false;
  const stepsHtml = groups.map(g => {
    if (!g.group) return stepRow(g.s, outdoor);
    const isMain = !mainNamed && g.block.some(s => s.type === 'work' && s.cue !== 'short');
    if (isMain) mainNamed = true;
    return `<div class="repgroup"><div class="rg"><span>${isMain ? 'Main set · ' : ''}Repeat ${g.times} ×</span><b class="num">${fmtClock(g.seconds)}</b></div>
      ${g.block.map(s => stepRow(s, outdoor)).join('')}</div>`;
  }).join('');
  const axis = [0, total / 2, total].map(fmtClock);
  view.innerHTML = `
    <div class="navbar"><a class="back" href="#/week/${week}">${ICON.left}Week ${week}</a>
      <button class="iconbtn" data-copy="title" aria-label="Copy title">${ICON.copy}</button></div>
    <div class="eyebrow">${[WEEKDAY_FULL[day.weekday - 1], date ? fmtDate(date) : '', outdoor ? 'Outdoor' : 'Indoor'].filter(Boolean).join(' · ').toUpperCase()}</div>
    <h1 class="ltitle" style="font-size:30px">${esc(day.name || day.title)}${skipped ? ' <span class="tag" style="vertical-align:middle">Skipped</span>' : ''}</h1>
    <div class="stats">
      <div class="stat"><span>Time</span><b class="num">${total >= 5400 ? hmin(total).replace(/ (h|min)/g, '<small> $1</small>') : mins(total)}</b></div>
      <div class="stat"><span>${work ? 'Hard time' : 'Steady'}</span><b class="num">${mins(work || steady)}</b></div>
      <div class="stat"><span>Peak</span><b class="num">${peak}</b></div>
    </div>
    <div class="card profcard">${profile(steps, { w: 320, h: 80, ftp: outdoor ? null : state.ftp })}
      <div class="axis num"><span>${axis[0]}</span><span>${axis[1]}</span><span>${axis[2]}</span></div></div>
    <div class="steps">${stepsHtml}</div>
    <div class="card copybox">
      <div class="r"><code>${esc(day.title)}</code><button class="chipbtn" data-copy="title">${ICON.copy}Copy title</button></div>
      <div class="r"><div class="desc">${esc(desc)}</div><button class="chipbtn" data-copy="desc">${ICON.copy}Copy</button></div>
    </div>
    <div class="dock"><button class="ghost" data-skip="${esc(day.title)}">${skipped ? 'Unskip' : 'Skip'}</button>
      <button id="startRide">${ICON.play}Start workout</button></div>`;
  view.querySelectorAll('[data-copy="title"]').forEach(b => { b.onclick = () => copyText(day.title, b); });
  view.querySelector('[data-copy="desc"]').onclick = e => copyText(desc, e.currentTarget);
  $('#startRide').onclick = () => startRun(found, steps);
}

// ---------- timer ----------
let run = null;

function elapsed() {
  if (!run) return 0;
  return ((run.pausedAt ?? Date.now()) - run.startedAt - run.pausedTotal) / 1000;
}
const wallAt = t => run.startedAt + run.pausedTotal + t * 1000;

async function startRun(found, steps) {
  // Everything that needs the tap's user gesture happens before any await.
  voice.unlock();
  keepAlive.play().catch(() => {});
  wake.on();
  let t = 0;
  const laid = steps.map((s, i) => { const x = { ...s, index: i, start: t, end: t + s.seconds }; t = x.end; return x; });
  const cues = state.voiceOn ? buildCues(steps, found.day.workoutCode, !!found.day.outdoor) : [];
  run = { found, steps: laid, cues, total: t, startedAt: 0, pausedAt: null, pausedTotal: 0, next: 0, done: false, loading: true, fallback: [] };
  go('#/timer');
  if (state.voiceOn) {
    const maxMin = Math.ceil(Math.max(...steps.map(s => s.seconds)) / 60);
    const extra = [['Workout ended.'], resumeSegs(1)];
    for (let m = 1; m <= maxMin; m++) extra.push(durSegs(m * 60));
    for (let s = 1; s < 60; s++) extra.push(durSegs(s));
    try { await voice.prepare([...cues.map(c => c.segments), ...extra]); } catch { /* falls back to speech */ }
  }
  run.loading = false;
  run.startedAt = Date.now();
  scheduleFrom(0);
  renderTimer();
}

// Queue every remaining cue on the audio clock; anything without clips is
// spoken from the timer loop when it falls due.
function scheduleFrom(t, lead = []) {
  if (!state.voiceOn) return;
  const items = [...lead, ...run.cues.filter(c => c.t >= t).map(c => ({ at: wallAt(c.t), segments: c.segments, countdown: c.countdown, t: c.t }))];
  const missing = voice.schedule(items);
  run.fallback = missing.filter(i => i.t != null);
  missing.filter(i => i.t == null).forEach(i => voice.speak(i.segments));
}

function currentStep(t) {
  return run.steps.find(s => t < s.end) || run.steps[run.steps.length - 1];
}

function togglePause() {
  if (!run || run.done || run.loading) return;
  if (run.pausedAt == null) {
    run.pausedAt = Date.now();
    voice.cancel();
  } else {
    const t = elapsed();
    run.pausedTotal += Date.now() - run.pausedAt;
    run.pausedAt = null;
    const step = currentStep(t);
    // "Resuming" and the time left; later cues follow the step's new end time.
    scheduleFrom(t, state.voiceOn ? [{ at: Date.now(), segments: resumeSegs(step.end - t), countdown: false }] : []);
  }
  renderTimer();
}

function finishRun() {
  if (!run || run.done) return;
  if (!confirm('End this workout now?')) return;
  voice.cancel();
  if (run.pausedAt != null) { run.pausedTotal += Date.now() - run.pausedAt; run.pausedAt = null; }
  run.endedEarly = elapsed();
  if (state.voiceOn) voice.sayNow(['Workout ended.']);
  endRun();
}

function endRun() {
  run.done = true;
  run.doneAt = Date.now();
  const thisRun = run;
  setTimeout(() => {
    if (run !== thisRun) return;
    wake.off();
    keepAlive.pause();
  }, 4000);
  $('#lockOverlay').classList.remove('on');
  renderTimer();
}

function closeRun(dest) {
  const week = run.found.week;
  voice.cancel();
  wake.off();
  keepAlive.pause();
  run = null;
  go(dest || `#/week/${week}`);
}

function tick() {
  if (!run || run.done || run.loading) return;
  const t = elapsed();
  if (run.pausedAt == null) {
    // Phrases with no recorded clip fall back to speech when due.
    while (run.fallback.length && run.fallback[0].t <= t) {
      const item = run.fallback.shift();
      if (t - item.t < 3) voice.speak(item.segments);
    }
    // If iOS suspended the audio clock, queued cues are late: reschedule.
    if (state.voiceOn && Math.abs(voice.drift()) > 0.5) {
      voice.cancel();
      if (voice.ctx && voice.ctx.state !== 'running') voice.ctx.resume().catch(() => {});
      scheduleFrom(t);
    }
    if (t >= run.total) { endRun(); return; }
  }
  if (document.body.dataset.page === 'timer') updateTimer();
}

function renderTimer() {
  if (!run) return go('#/');
  if (run.done) return renderDone();
  const day = run.found.day;
  const paused = run.pausedAt != null;
  view.innerHTML = `<div class="tbg" id="tBg"></div>
    <section class="timer">
      <div class="tt"><span>${esc(day.title)} · ${esc(day.name || '')}</span><span class="num" id="tPct"></span></div>
      <div class="seg" id="tSeg">${run.steps.map(s => `<div style="flex:${s.seconds};background:${STEP_HEX[s.type] || '#888'}"></div>`).join('')}<i class="playhead" id="tHead"></i></div>
      <div class="tmeta num"><span id="tElapsed"></span><span id="tLeft"></span></div>
      <div class="phase"><span class="pill" id="tPill">Loading…</span><span class="rep" id="tRep"></span></div>
      <div class="big num" id="tClock">0:00</div>
      <div class="stepbar"><div id="tBar"></div></div>
      <div class="tline num" id="tLine"><span class="ti" id="tIco"></span><b id="tTarget"></b><span class="u" id="tUnit"></span></div>
      <div class="hrline num" id="tHr"></div>
      <div class="rpe hidden" id="tRpe">${'<i></i>'.repeat(10)}</div>
      <div class="spacer"></div>
      <div class="next" id="tNextBox"><div class="nb" id="tNb"></div><div class="tx"><span>Next</span><b id="tNext"></b></div></div>
      <div class="ctrls">
        <button class="main${paused ? ' resume' : ''}" id="tPause" ${run.loading ? 'disabled' : ''}>${paused ? `${ICON.play}Resume` : `${ICON.pause}Pause`}</button>
        <button class="sq" id="tLock" aria-label="Lock screen">${ICON.lock}</button>
        <button class="sq stop" id="tFinish" aria-label="Finish workout">${ICON.stop}</button>
      </div>
    </section>`;
  run.lastIdx = -1;
  $('#tPause').onclick = togglePause;
  $('#tFinish').onclick = finishRun;
  $('#tLock').onclick = () => $('#lockOverlay').classList.add('on');
  updateTimer();
}

function updateTimer() {
  if (!run || run.done || !$('#tClock')) return;
  if (run.loading) return;
  const t = Math.min(elapsed(), run.total);
  const step = currentStep(t);
  const next = run.steps[step.index + 1];
  const outdoor = !!run.found.day.outdoor;
  const paused = run.pausedAt != null;

  $('#tBg').className = `tbg ${paused ? 'paused' : step.type}`;
  $('#tPct').textContent = `${Math.floor(t / run.total * 100)}%`;
  $('#tHead').style.left = `calc(${(t / run.total) * 100}% - 2px)`;
  $('#tElapsed').textContent = `${fmtClock(t)} elapsed`;
  $('#tLeft').textContent = `${fmtClock(run.total - t)} left`;
  const clock = fmtClock(step.end - t);
  const el = $('#tClock');
  if (el.textContent !== clock) { el.textContent = clock; el.className = `big num${clock.length >= 7 ? ' len7' : clock.length >= 5 ? ' len5' : ''}`; }
  $('#tBar').className = step.type;
  $('#tBar').style.width = `${Math.min(100, (t - step.start) / step.seconds * 100)}%`;

  if (run.lastIdx === step.index && run.lastPaused === paused) return;
  run.lastIdx = step.index;
  run.lastPaused = paused;
  [...$('#tSeg').children].forEach((d, i) => { if (i < run.steps.length) d.style.opacity = i <= step.index ? 1 : 0.3; });
  const pill = $('#tPill');
  pill.textContent = stepName(step);
  pill.className = `pill ${step.type}`;
  $('#tRep').textContent = paused ? 'Paused' : step.rep ? `Rep ${step.rep.n} of ${step.rep.of}` : step.rpe ? `RPE ${step.rpe}` : '';

  // Watts are the main target (an outdoor ride's indoor watts too); heart
  // rate is a smaller pink line. With no watts, heart rate takes the big line.
  const w = wTxt(step), h = hTxt(step), cad = outdoor ? '' : cadTxt(step);
  const line = $('#tLine');
  if (w) {
    line.className = 'tline num';
    $('#tIco').innerHTML = ICON.bolt; $('#tTarget').textContent = w; $('#tUnit').textContent = 'W';
  } else if (h) {
    line.className = 'tline num hrbig';
    $('#tIco').innerHTML = ICON.heart; $('#tTarget').textContent = h; $('#tUnit').textContent = 'bpm';
  } else if (step.rpe) {
    line.className = 'tline num';
    $('#tIco').innerHTML = ''; $('#tTarget').textContent = `RPE ${step.rpe}`; $('#tUnit').textContent = '';
  } else line.className = 'tline num hidden';
  const small = [];
  if (w && h) small.push(`${ICON.heart}<b>${esc(h)}</b><span>bpm</span>`);
  if (cad) small.push(`<em>${small.length ? '· ' : ''}${esc(cad)}</em>`);
  $('#tHr').innerHTML = small.join('');
  const rpe = rpeNum(step);
  const showRpe = rpe != null && (outdoor || !w);
  $('#tRpe').classList.toggle('hidden', !showRpe);
  if (showRpe) [...$('#tRpe').children].forEach((i, k) => { i.className = k < rpe ? `on ${step.type === 'work' ? 'work' : ''}` : ''; });

  $('#tNb').className = `nb ${next ? next.type : ''}`;
  const nextTarget = next && (wTxt(next) ? `${wTxt(next)} W` : hTxt(next) ? `${hTxt(next)} bpm` : next.rpe ? `RPE ${next.rpe}` : '');
  $('#tNext').textContent = next ? [stepName(next), fmtClock(next.seconds), nextTarget].filter(Boolean).join(' · ') : 'Last step, finish strong';
}

function nextRideAfter(found) {
  const rides = allRides(state.plan).sort((a, b) => a.week - b.week || a.day.weekday - b.day.weekday);
  const i = rides.findIndex(r => r.day.title === found.day.title);
  return rides.slice(i + 1).find(r => !state.skips[r.day.title]) || null;
}

function renderDone() {
  const { found, steps } = run;
  const day = found.day;
  const endT = run.endedEarly ?? run.total;
  const early = run.endedEarly != null;
  const main = steps.filter(s => s.type === 'work' && s.cue !== 'short' && s.cue !== 'none');
  const counted = main.length ? main : steps;
  const doneCount = counted.filter(s => s.end <= endT + 0.5).length;
  const up = nextRideAfter(found);
  const cal = calendar(state.startDate);
  let upHtml = '';
  if (up) {
    const upSteps = rideSteps(up.day, state.plan, state.ftp);
    const when = cal ? `${WEEKDAYS[up.day.weekday - 1]} ${fmtDate(cal.dateOf(up.week, up.day.weekday))}` : `Week ${up.week}, ${WEEKDAYS[up.day.weekday - 1]}`;
    upHtml = `<button class="card upnext" data-upnext="${esc(up.day.title)}">${kico('ride')}<div style="flex:1;text-align:left"><b>Up next: ${esc(up.day.name || up.day.title)}</b>
      <span>${esc(when)} · ${hmin(totalSeconds(upSteps))}</span></div><span class="chev">${ICON.right}</span></button>`;
  }
  view.innerHTML = `<div class="tbg ${early ? 'paused' : 'done'}"></div>
    <section class="donepage">
      <div class="ring${early ? ' ended' : ''}">${early ? ICON.stop : ICON.check}</div>
      <h2>${early ? 'Workout ended' : 'Workout complete'}</h2><p class="c">${esc(day.name || '')} · ${esc(day.title)}</p>
      <div class="dgrid">
        <div class="stat"><span>Ride time</span><b class="num">${fmtClock(endT)}</b></div>
        <div class="stat"><span>${main.length ? 'Intervals' : 'Steps'}</span><b class="num">${doneCount}<small> of ${counted.length}</small></b></div>
      </div>
      <div class="card profcard" style="margin-top:10px">${profile(steps, { w: 320, h: 70 })}</div>
      ${upHtml}
      <div class="btns"><button class="ghost" id="tCopy">${ICON.copy}Copy description</button><button id="tClose">Back to week</button></div>
    </section>`;
  $('#tClose').onclick = () => closeRun();
  $('#tCopy').onclick = e => copyText(description(day, state.plan, state.ftp), e.currentTarget);
}

// ---------- pocket lock: hold to unlock ----------
(() => {
  const btn = $('#unlock'), fill = $('#unlockFill');
  const HOLD = 1500;
  let timer = null, startT = 0, raf = 0;
  const cancel = () => { clearTimeout(timer); cancelAnimationFrame(raf); fill.style.width = '0'; };
  const grow = () => { fill.style.width = `${Math.min(100, (Date.now() - startT) / HOLD * 100)}%`; raf = requestAnimationFrame(grow); };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    startT = Date.now();
    grow();
    timer = setTimeout(() => { cancel(); $('#lockOverlay').classList.remove('on'); }, HOLD);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, cancel);
  btn.addEventListener('contextmenu', e => e.preventDefault());
})();

// ---------- settings ----------
let pendingPlan = null;
let pickedName = '';

// FTP changes on the same day count as one change (from the morning's value).
function setFtp(v) {
  v = Math.round(Number(v));
  if (!(v >= 50 && v <= 600)) return false;
  if (v === state.ftp) return true;
  const date = toYMD(today());
  const h = state.ftpHistory;
  if (h[0]?.date === date) {
    h[0].to = v;
    if (h[0].to === h[0].from) h.shift();
  } else h.unshift({ date, from: state.ftp, to: v });
  state.ftpHistory = h.slice(0, 20);
  state.ftp = v;
  save('ftp');
  save('ftpHistory');
  return true;
}

function ftpHistoryHtml() {
  const rows = state.ftpHistory.slice(0, 3).map(e => {
    const d = e.to - e.from;
    const date = new Date(`${e.date}T12:00:00`);
    return `<div class="li hist"><div class="tx"><b class="num">${fmtLongDate(date)}</b></div><span class="num from">${e.from} W</span><span class="arrow">→</span>
      <span class="num to">${e.to} W</span><span class="delta num ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</span></div>`;
  });
  return rows.length ? rows.join('') : '<div class="li emptyhist">Your FTP changes will show here.</div>';
}

function renderSettings() {
  const p = state.plan;
  view.innerHTML = `
    <h1 class="ltitle">Settings</h1>
    <div class="gl">Training</div>
    <div class="list">
      <label class="li"><div class="ico blue">${ICON.cal}</div><div class="tx"><b>Plan start</b><span>Week 1 starts that Monday</span></div>
        <input type="date" class="datechip" id="sStart" value="${esc(state.startDate)}"></label>
      <div class="li"><div class="ico yellow">${ICON.bolt}</div><div class="tx"><b>FTP</b><span>Tap the number to type</span></div>
        <div class="stepper"><button id="sFtpDown" aria-label="Lower FTP">−</button>
          <label class="ftpfield"><input id="sFtp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" value="${esc(state.ftp)}" aria-label="FTP in watts"><small>W</small></label>
          <button id="sFtpUp" aria-label="Raise FTP">+</button></div></div>
    </div>
    <div class="gl">FTP history</div>
    <div class="list" id="sHist">${ftpHistoryHtml()}</div>
    <div class="gl">Voice</div>
    <div class="list">
      <div class="li"><div class="ico green">${ICON.volume}</div><div class="tx"><b>Voice cues</b><span>Works with the silent switch on</span></div>
        <label class="switch"><input type="checkbox" id="sVoice" ${state.voiceOn ? 'checked' : ''} aria-label="Voice cues"><i></i></label></div>
      <button class="li" id="sTest"><div class="ico grey">${ICON.play}</div><div class="tx"><b>Test voice volume</b><span>Plays a sample cue</span></div><span class="chev">${ICON.right}</span></button>
    </div>
    <div class="gl">Plan</div>
    <div class="card planbox">
      <div class="ph">${kico('ride')}<div style="flex:1;min-width:0"><b>${p ? esc(p.planName || 'Untitled plan') : 'No plan loaded'}</b>
        <span>${p ? `v${esc(p.version)} · ${p.weeks.length} weeks · ${allRides(p).length} rides` : 'Import the plan JSON below'}</span></div></div>
      <label class="drop"><div class="ico">${ICON.file}</div><div style="flex:1"><b>Import ${p ? 'new ' : ''}plan</b><span>Choose a .json file</span></div>
        <input type="file" id="sFile" accept=".json,application/json,text/plain">
        <button class="chipbtn" id="sPaste" type="button">${ICON.paste}Paste</button></label>
      <div class="pastebox hidden" id="sPasteBox">
        <textarea id="sJson" placeholder="Paste the plan JSON here" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>
        <button id="sCheck">Check plan</button></div>
      <div class="result" id="sResult"></div>
    </div>
    <p class="version">Ride Timer <span id="sVersion">${esc(appVersion)}</span>${storageOk ? '' : ' · <b class="warn">Storage is blocked; settings will not be saved.</b>'}</p>`;

  $('#sStart').onchange = e => { state.startDate = e.target.value; save('startDate'); picked = null; };
  const ftpIn = $('#sFtp');
  const commit = v => {
    setFtp(v);
    ftpIn.value = state.ftp;
    $('#sHist').innerHTML = ftpHistoryHtml();
  };
  ftpIn.onchange = () => commit(ftpIn.value);
  ftpIn.onkeydown = e => { if (e.key === 'Enter') ftpIn.blur(); };
  ftpIn.onfocus = () => ftpIn.select();
  $('#sFtpDown').onclick = () => commit(state.ftp - 1);
  $('#sFtpUp').onclick = () => commit(state.ftp + 1);
  $('#sVoice').onchange = e => { state.voiceOn = e.target.checked; save('voiceOn'); };
  $('#sTest').onclick = async () => {
    voice.unlock();
    const segs = ['Rep 1 of 2.', '205 watts', '12 minutes'];
    try { await voice.prepare([segs]); } catch { /* speech fallback */ }
    voice.sayNow(segs);
  };
  $('#sPaste').onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    $('#sPasteBox').classList.toggle('hidden');
    if (!$('#sPasteBox').classList.contains('hidden')) $('#sJson').focus();
  };
  $('#sFile').onchange = async e => {
    const input = e.target;
    const f = input.files[0];
    if (!f) return;
    $('#sResult').innerHTML = `<p class="muted">Reading ${esc(f.name)}…</p>`;
    try {
      $('#sJson').value = await f.text();
      pickedName = `${f.name} (${Math.round(f.size / 1024)} KB)`;
    } catch (err) {
      $('#sResult').innerHTML = `<div class="errors"><b>${esc(f.name)} couldn't be read.</b><p>${esc(err.message)}</p></div>`;
      return;
    } finally {
      input.value = ''; // so picking the same file again still fires
    }
    checkPlan();
  };
  $('#sCheck').onclick = checkPlan;
  $('#sJson').oninput = () => { pickedName = ''; };
}

function checkPlan() {
  try { checkPlanInner(); } catch (e) {
    $('#sResult').innerHTML = `<div class="errors"><b>Something went wrong checking the plan.</b><p>${esc(e.message)}</p></div>`;
  }
}

function checkPlanInner() {
  const out = $('#sResult');
  // Close the keyboard and bring the result into view; on a phone it would
  // otherwise land below the keyboard and the button seems to do nothing.
  document.activeElement?.blur?.();
  const checkedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const show = html => {
    out.innerHTML = `<p class="muted">Checked ${pickedName ? esc(pickedName) : 'pasted text'} at ${checkedAt}</p>${html}`;
    requestAnimationFrame(() => out.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  pendingPlan = null;
  // iOS "smart punctuation" can turn pasted quotes into curly ones.
  const text = $('#sJson').value.replace(/^﻿/, '').replace(/[“”„‟]/g, '"').replace(/[‘’]/g, "'").trim();
  if (!text) {
    show(`<div class="errors"><b>Paste the plan JSON or choose a file first.</b></div>`);
    return;
  }
  let plan;
  try { plan = JSON.parse(text); } catch (e) {
    show(`<div class="errors"><b>That isn't valid JSON.</b><p>${esc(e.message)}</p></div>`);
    return;
  }
  let errors, stats;
  try { ({ errors, stats } = validatePlan(plan)); } catch (e) {
    show(`<div class="errors"><b>The plan couldn't be checked.</b><p>${esc(e.message)}</p></div>`);
    return;
  }
  if (errors.length) {
    show(`<div class="errors"><b>${errors.length} problem${errors.length === 1 ? '' : 's'} found. Your current plan was not changed.</b>
      <ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`);
    return;
  }
  pendingPlan = plan;
  const titles = new Set(allRides(plan).map(r => r.day.title));
  const keptSkips = Object.keys(state.skips).filter(t => titles.has(t)).length;
  show(`<div class="ok"><div class="r">${ICON.check}Plan looks good</div>
    <p><b>${esc(stats.name)}</b><br>v${esc(stats.version)} · ${stats.weeks} weeks · ${stats.rides} rides${state.plan ? `<br>Replaces the current plan. Start date stays. ${keptSkips} skip mark${keptSkips === 1 ? '' : 's'} kept.` : ''}</p>
    <button id="sConfirm">Import this plan</button></div>`);
  $('#sConfirm').onclick = () => {
    const titles2 = new Set(allRides(pendingPlan).map(r => r.day.title));
    state.plan = pendingPlan;
    state.skips = Object.fromEntries(Object.entries(state.skips).filter(([t]) => titles2.has(t)));
    const ok = save('plan');
    save('skips');
    pendingPlan = null;
    picked = null;
    renderSettings();
    $('#sResult').innerHTML = ok ? `<div class="ok"><div class="r">${ICON.check}Plan imported</div><p><a href="#/">See this week</a></p></div>` : `<div class="errors"><b>The plan could not be saved on this device.</b></div>`;
    $('#sResult').scrollIntoView({ block: 'start' });
  };
}

// ---------- app version and updates ----------
let appVersion = 'dev';
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.version) { appVersion = e.data.version; const el = $('#sVersion'); if (el) el.textContent = appVersion; }
  });
  navigator.serviceWorker.ready.then(reg => reg.active?.postMessage('version')).catch(() => {});
  // A new version took over. Reload to use it only when that can't lose
  // anything: before the first tap, or when the app is next opened. Never
  // in the middle of a ride or while a plan is being imported.
  let reloadWanted = false, touched = false;
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { touched = true; }, { capture: true, passive: true });
  const maybeReload = () => {
    if (!reloadWanted || (run && !run.done)) return;
    if (!touched || document.visibilityState === 'hidden') location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => { reloadWanted = true; maybeReload(); });
  document.addEventListener('visibilitychange', maybeReload);
}

// ---------- global wiring ----------
document.addEventListener('click', e => {
  const el = sel => e.target.closest(sel);
  if (el('[data-close-sheet]')) { closeSheet(); return; }
  const wkBtn = el('[data-week]');
  if (wkBtn) { closeSheet(); go(`#/week/${wkBtn.dataset.week}`); return; }
  const g = el('[data-go]');
  if (g) { e.preventDefault(); go(g.dataset.go); return; }
  const s = el('[data-skip]');
  if (s) { e.preventDefault(); toggleSkip(s.dataset.skip); return; }
  // Rides in the week list open in place: a row toggles, a day chip opens.
  const pk = el('[data-pick]') || el('[data-open]');
  if (pk) {
    const title = pk.dataset.pick ?? pk.dataset.open;
    const wk = parseInt(location.hash.split('/')[2], 10) || null;
    picked = pk.dataset.pick != null && picked?.title === title ? null : { week: findRide(state.plan, title)?.week ?? null, title };
    renderWeek(wk);
    const card = [...document.querySelectorAll('[data-card]')].find(c => c.dataset.card === title);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  if (el('[data-act="weeks"]')) { if (state.plan) weekPicker(); return; }
  const st = el('[data-start]');
  if (st) {
    const found = findRide(state.plan, st.dataset.start);
    if (found) startRun(found, rideSteps(found.day, state.plan, state.ftp));
    return;
  }
  const up = el('[data-upnext]');
  if (up) { closeRun(`#/ride/${encodeURIComponent(up.dataset.upnext)}`); return; }
  const pd = el('[data-pday]');
  if (pd) { const [w, wd] = pd.dataset.pday.split(':').map(Number); openDay(w, wd); }
});

// A day tapped in a stage's week: its ride's page, or a sheet with that day's plan.
function openDay(week, wd) {
  const items = (state.plan.weeks.find(w => w.week === week)?.days || []).filter(d => d.weekday === wd);
  const rides = items.filter(d => d.kind === 'ride');
  if (rides.length === 1 && items.length === 1) { go(`#/ride/${encodeURIComponent(rides[0].title)}`); return; }
  const cal = calendar(state.startDate);
  const when = `${WEEKDAY_FULL[wd - 1]} · Week ${week}${cal ? ` · ${fmtDate(cal.dateOf(week, wd))}` : ''}`;
  const rows = items.map(item => {
    if (item.kind === 'ride') {
      const steps = rideSteps(item, state.plan, state.ftp);
      return `<button class="row" data-go="#/ride/${encodeURIComponent(item.title)}">${kico('ride')}<div class="tx"><b>${esc(item.name || item.title)}</b>
        <span>${esc([item.title, hmin(totalSeconds(steps))].join(' · '))}</span></div><span class="chev">${ICON.right}</span></button>`;
    }
    const mins = dayMinutes(item);
    const text = item.summary || (item.kind === 'rest' ? 'Rest' : item.kind === 'free' ? 'Free' : item.kind);
    const sub = [{ strength: 'Strength', run: 'Run', rest: 'Rest', free: '' }[item.kind], mins ? hmin(mins * 60) : '', item.optional ? 'optional' : ''].filter(Boolean).join(' · ');
    return `<div class="row">${kico(item.kind)}<div class="tx"><b>${esc(text)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div></div>`;
  });
  openSheet(`<div class="sheethead"><b>${esc(when)}</b></div>
    <div class="rows" style="margin-top:6px">${rows.join('') || `<div class="row">${kico('rest')}<div class="tx"><b>Nothing planned</b></div></div>`}</div>
    <button class="ghost wide" style="margin-top:14px" data-go="#/week/${week}">Open week ${week}</button>`);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSheet();
  if (e.code === 'Space' && run && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName)) {
    e.preventDefault();
    togglePause();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { wake.refresh(); tick(); }
});
setInterval(tick, 200);
(function frame() { if (run && !run.done) updateTimer(); requestAnimationFrame(frame); })();

route();
window.__rt = { state, get run() { return run; }, voice };
