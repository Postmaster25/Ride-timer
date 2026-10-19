import {
  validatePlan, scaledStep, findRide, allRides, lastWeek, calendar, toYMD, addDays, mondayOf, WEEKDAYS,
  description, shortDuration, wattsLabel, hrLabel, cadenceLabel, totalSeconds,
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
  voiceOn: store.get('voiceOn', true),
  skips: store.get('skips', {}),
};
const save = key => store.set(key, state[key]);

const voice = new Voice();
const wake = new Wake($('#wakeVideo'));
const keepAlive = $('#keepAliveAudio');

const today = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; };
const fmtDate = d => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
const fmtClock = sec => {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
};

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
  const old = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = old; }, 1500);
}

// ---------- routing ----------
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
window.addEventListener('hashchange', route);

function route() {
  if (run && !run.done && location.hash !== '#/timer') { location.hash = '#/timer'; return; }
  const [, page, arg] = (location.hash || '#/').split('/');
  document.body.dataset.page = page || 'week';
  if (page === 'ride') return renderRide(decodeURIComponent(arg || ''));
  if (page === 'timer') return run ? renderTimer() : go('#/');
  if (page === 'settings') return renderSettings();
  return renderWeek(arg ? parseInt(arg, 10) : null);
}

// ---------- week view ----------
const KIND_ICON = { ride: '🚴', strength: '🏋️', run: '🏃', rest: '😴', free: '·' };

function renderWeek(weekNum) {
  const plan = state.plan;
  if (!plan) {
    view.innerHTML = `<section class="card empty">
      <h2>No plan loaded yet</h2>
      <p>Import the plan JSON in Settings to see your weeks.</p>
      <button data-go="#/settings">Open Settings</button></section>`;
    return;
  }
  const cal = calendar(state.startDate);
  const last = lastWeek(plan);
  const now = today();
  const curWeek = cal ? cal.weekOf(now) : 1;
  const wk = Math.min(Math.max(weekNum || Math.min(Math.max(curWeek, 1), last), 1), last);
  const weekData = plan.weeks.find(w => w.week === wk);

  let banner = '';
  if (!cal) banner = `<div class="banner"><span>Set your start date to put the plan on the calendar.</span><button data-go="#/settings">Set start date</button></div>`;
  else if (cal.daysUntilStart(now) > 0) banner = `<div class="banner">Plan starts in ${cal.daysUntilStart(now)} day${cal.daysUntilStart(now) === 1 ? '' : 's'}.</div>`;
  else if (curWeek > last) banner = `<div class="banner">Plan complete.</div>`;

  const rows = [];
  for (let wd = 1; wd <= 7; wd++) {
    const date = cal ? cal.dateOf(wk, wd) : null;
    const isToday = date && toYMD(date) === toYMD(now);
    const before = date && cal.beforeStart(date);
    const items = (weekData?.days || []).filter(d => d.weekday === wd);
    let body;
    if (before) body = `<div class="item muted">Before start</div>`;
    else if (!items.length) body = `<div class="item muted">${wd === 7 ? 'Free' : 'Nothing planned'}</div>`;
    else body = items.map(itemHtml).join('');
    rows.push(`<li class="day${isToday ? ' today' : ''}${before ? ' before' : ''}">
      <div class="when"><b>${WEEKDAYS[wd - 1]}</b>${date ? `<span>${fmtDate(date)}</span>` : ''}</div>
      <div class="items">${body}</div></li>`);
  }
  const range = cal ? `${fmtDate(cal.dateOf(wk, 1))} to ${fmtDate(cal.dateOf(wk, 7))}` : 'Preview';
  view.innerHTML = `${banner}
    <div class="weeknav">
      <button class="icon" data-go="#/week/${wk - 1}" ${wk <= 1 ? 'disabled' : ''} aria-label="Previous week">‹</button>
      <div><h2>Week ${wk}</h2><span class="muted">${range}</span></div>
      <button class="icon" data-go="#/week/${wk + 1}" ${wk >= last ? 'disabled' : ''} aria-label="Next week">›</button>
    </div>
    <ul class="days">${rows.join('')}</ul>
    ${cal && curWeek >= 1 && curWeek <= last && wk !== curWeek ? `<button class="secondary wide" data-go="#/week/${curWeek}">Back to this week</button>` : ''}`;
}

function itemHtml(day) {
  if (day.kind !== 'ride') {
    const text = day.summary || (day.kind === 'rest' ? 'Rest' : day.kind === 'free' ? 'Free' : day.kind);
    return `<div class="item"><span class="k">${KIND_ICON[day.kind] || ''}</span><span>${esc(text)}</span></div>`;
  }
  const skipped = !!state.skips[day.title];
  return `<div class="item ride${skipped ? ' skipped' : ''}">
    <a href="#/ride/${encodeURIComponent(day.title)}"><span class="k">${KIND_ICON.ride}</span>
      <span><span class="title">${esc(day.title)}</span>${skipped ? ' <span class="tag">Skipped</span>' : ''}<br>${esc(day.summary || day.name || '')}</span></a>
    <button class="skip" data-skip="${esc(day.title)}">${skipped ? 'Unskip' : 'Skip'}</button></div>`;
}

function toggleSkip(title) {
  if (state.skips[title]) delete state.skips[title];
  else state.skips[title] = true;
  save('skips');
  route();
}

// ---------- workout view ----------
function renderRide(title) {
  const found = findRide(state.plan, title);
  if (!found) { view.innerHTML = `<section class="card empty"><h2>Workout not found</h2><button data-go="#/">Back to week</button></section>`; return; }
  const { week, day } = found;
  const steps = day.steps.map(s => scaledStep(s, state.plan, state.ftp));
  const desc = description(day, state.plan, state.ftp);
  const skipped = !!state.skips[day.title];
  const cal = calendar(state.startDate);
  const date = cal ? fmtDate(cal.dateOf(week, day.weekday)) : '';
  view.innerHTML = `
    <a class="back" href="#/week/${week}">‹ Week ${week}</a>
    <section class="card">
      <h2>${esc(day.name || day.title)}</h2>
      <p class="muted">${WEEKDAYS[day.weekday - 1]}${date ? ` ${date}` : ''} · ${shortDuration(totalSeconds(steps))}${skipped ? ' · <span class="tag">Skipped</span>' : ''}</p>
      <div class="copyrow"><code class="title">${esc(day.title)}</code><button class="secondary" data-copy="title">Copy title</button></div>
      <pre class="desc">${esc(desc)}</pre>
      <div class="actions">
        <button class="secondary" data-copy="desc">Copy description</button>
        <button class="secondary" data-skip="${esc(day.title)}">${skipped ? 'Unskip' : 'Mark skipped'}</button>
      </div>
      <button class="big" id="startRide">Start</button>
    </section>
    <h3>Steps</h3>
    <ol class="steps">${steps.map(stepHtml).join('')}</ol>`;
  view.querySelector('[data-copy="title"]').onclick = e => copyText(day.title, e.target);
  view.querySelector('[data-copy="desc"]').onclick = e => copyText(desc, e.target);
  $('#startRide').onclick = () => startRun(found, steps);
}

function stepHtml(s) {
  const name = s.label || { warmup: 'Warm-up', work: 'Interval', recovery: 'Recovery', cooldown: 'Cool down', steady: 'Steady' }[s.type];
  const bits = [wattsLabel(s.wattsLow, s.wattsHigh), hrLabel(s), cadenceLabel(s), s.rpe ? `RPE ${esc(s.rpe)}` : ''].filter(Boolean);
  return `<li class="step ${s.type}"><div class="dur">${shortDuration(s.seconds)}</div>
    <div><b>${esc(name)}</b>${s.rep ? ` <span class="muted">rep ${s.rep.n} of ${s.rep.of}</span>` : ''}
    <div class="muted">${bits.join(' · ')}</div>${s.notes ? `<div class="notes">${esc(s.notes)}</div>` : ''}</div></li>`;
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
  const cues = state.voiceOn ? buildCues(steps, found.day.workoutCode) : [];
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

function closeRun() {
  const week = run.found.week;
  voice.cancel();
  wake.off();
  keepAlive.pause();
  run = null;
  go(`#/week/${week}`);
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
  const day = run.found.day;
  view.innerHTML = `
    <section class="timer">
      <div class="ride-title">${esc(day.title)} · ${esc(day.name || '')}</div>
      <div id="tStep" class="tstep">Loading…</div>
      <div id="tRep" class="trep"></div>
      <div id="tClock" class="tclock">0:00</div>
      <div id="tTarget" class="ttarget"></div>
      <div id="tHr" class="thr"></div>
      <div id="tNext" class="tnext"></div>
      <div class="progress"><div id="tBar"></div></div>
      <div class="tmeta"><span id="tElapsed"></span><span id="tLeft"></span></div>
      <div class="tcontrols" id="tControls"></div>
    </section>`;
  const c = $('#tControls');
  if (run.done) {
    c.innerHTML = `<button class="big" id="tClose">Back to week</button>`;
    $('#tClose').onclick = closeRun;
  } else {
    c.innerHTML = `<button class="big" id="tPause" ${run.loading ? 'disabled' : ''}>${run.pausedAt != null ? 'Resume' : 'Pause'}</button>
      <div class="row2"><button class="danger" id="tFinish">Finish</button><button class="secondary" id="tLock">Lock</button></div>`;
    $('#tPause').onclick = togglePause;
    $('#tFinish').onclick = finishRun;
    $('#tLock').onclick = () => $('#lockOverlay').classList.add('on');
  }
  updateTimer();
}

function updateTimer() {
  if (!run || !$('#tClock')) return;
  if (run.loading) return;
  const t = Math.min(elapsed(), run.total);
  const step = currentStep(t);
  const next = run.steps[step.index + 1];
  const name = step.label || { warmup: 'Warm-up', work: 'Interval', recovery: 'Recovery', cooldown: 'Cool down', steady: 'Steady' }[step.type];
  $('#tStep').textContent = run.done ? (run.endedEarly != null ? 'Workout ended' : 'Workout complete') : run.pausedAt != null ? `Paused · ${name}` : name;
  $('#tStep').className = `tstep ${run.done ? '' : step.type}`;
  $('#tRep').textContent = !run.done && step.rep ? `Rep ${step.rep.n} of ${step.rep.of}` : '';
  $('#tClock').textContent = run.done ? fmtClock(run.endedEarly ?? run.total) : fmtClock(step.end - t);
  $('#tTarget').textContent = run.done ? '' : wattsLabel(step.wattsLow, step.wattsHigh);
  $('#tHr').textContent = run.done ? '' : [hrLabel(step), cadenceLabel(step)].filter(Boolean).join(' · ');
  $('#tNext').textContent = run.done ? '' : next ? `Next: ${next.label || next.type} ${shortDuration(next.seconds)}${next.wattsHigh ? `, ${wattsLabel(next.wattsLow, next.wattsHigh)}` : ''}` : 'Last step';
  $('#tBar').style.width = `${(t / run.total) * 100}%`;
  $('#tElapsed').textContent = `${fmtClock(t)} elapsed`;
  $('#tLeft').textContent = run.done ? '' : `${fmtClock(run.total - t)} left`;
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

function renderSettings() {
  const p = state.plan;
  view.innerHTML = `
    <section class="card">
      <h2>Settings</h2>
      <label class="field">Plan start date
        <input type="date" id="sStart" value="${esc(state.startDate)}">
        <small>Week 1 starts on the Monday of this date's week. Changing it moves the whole plan.</small></label>
      <label class="field">FTP (watts)
        <input type="number" id="sFtp" inputmode="numeric" min="50" max="600" step="1" value="${esc(state.ftp)}">
        <small>All watt targets are worked out from this, rounded to the nearest 5 W.</small></label>
      <label class="field row">Voice cues <input type="checkbox" id="sVoice" ${state.voiceOn ? 'checked' : ''}></label>
      <button class="secondary" id="sTest">Test voice volume</button>
    </section>
    <section class="card">
      <h2>Plan</h2>
      <p class="muted">${p ? `${esc(p.planName || 'Untitled plan')}, version ${esc(p.version)}, ${p.weeks.length} weeks, ${allRides(p).length} rides.` : 'No plan loaded.'}</p>
      <div class="field">Import plan JSON
        <label class="filepick secondary">Choose a .json file<input type="file" id="sFile" accept=".json,application/json,text/plain"></label>
        <textarea id="sJson" placeholder="…or paste the plan JSON here" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea></div>
      <button id="sCheck">Check plan</button>
      <div id="sResult"></div>
    </section>
    <p class="muted center">Ride Timer <span id="sVersion">${esc(appVersion)}</span>${storageOk ? '' : ' · <b class="warn">Storage is blocked; settings will not be saved.</b>'}</p>`;

  $('#sStart').onchange = e => { state.startDate = e.target.value; save('startDate'); };
  $('#sFtp').onchange = e => {
    const v = Math.round(Number(e.target.value));
    if (v >= 50 && v <= 600) { state.ftp = v; save('ftp'); } else e.target.value = state.ftp;
  };
  $('#sVoice').onchange = e => { state.voiceOn = e.target.checked; save('voiceOn'); };
  $('#sTest').onclick = async () => {
    voice.unlock();
    const segs = ['Rep 1 of 2.', '205 watts', '12 minutes'];
    try { await voice.prepare([segs]); } catch { /* speech fallback */ }
    voice.sayNow(segs);
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
  const text = $('#sJson').value.replace(/^\uFEFF/, '').replace(/[\u201C\u201D\u201E\u201F]/g, '"').replace(/[\u2018\u2019]/g, "'").trim();
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
  show(`<div class="preview"><b>${esc(stats.name)}</b>
    <p>Version ${esc(stats.version)} · ${stats.weeks} weeks · ${stats.rides} rides</p>
    ${state.plan ? `<p class="muted">Replaces the current plan. Start date stays. ${keptSkips} skip mark${keptSkips === 1 ? '' : 's'} kept.</p>` : ''}
    <button id="sConfirm">Import this plan</button></div>`);
  $('#sConfirm').onclick = () => {
    const titles2 = new Set(allRides(pendingPlan).map(r => r.day.title));
    state.plan = pendingPlan;
    state.skips = Object.fromEntries(Object.entries(state.skips).filter(([t]) => titles2.has(t)));
    const ok = save('plan');
    save('skips');
    pendingPlan = null;
    renderSettings();
    $('#sResult').innerHTML = ok ? `<div class="preview"><b>Plan imported.</b> <a href="#/">See this week</a></div>` : `<div class="errors"><b>The plan could not be saved on this device.</b></div>`;
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
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); go(g.dataset.go); return; }
  const s = e.target.closest('[data-skip]');
  if (s) { e.preventDefault(); toggleSkip(s.dataset.skip); }
});
document.addEventListener('keydown', e => {
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
