import { WORKOUTS, buildCues, timeline, totalSeconds, resumeSegments, wattsText, clipName } from './cues.js';

const $ = id => document.getElementById(id);

// ---------- storage (Safari can block or clear it) ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

const fmt = sec => {
  sec = Math.max(0, Math.ceil(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`;
};
const clockTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });

// ---------- voice engines ----------
// Speech: fires each cue from the timer loop when it falls due.
class SpeechEngine {
  kind = 'tick';
  current = null;
  prepare() {
    if (!('speechSynthesis' in window)) throw new Error('Speech synthesis is not available');
    // iOS only allows speech after a user gesture; a silent utterance unlocks it.
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }
  say(text, { countdown = false, onStart } = {}) {
    // Newer cues interrupt older ones, but a countdown is never cut off.
    if (speechSynthesis.speaking && !(this.current && this.current.countdown)) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    u.lang = 'en-US';
    const entry = { countdown };
    u.onstart = () => { this.current = entry; onStart && onStart(); };
    u.onend = u.onerror = () => { if (this.current === entry) this.current = null; };
    speechSynthesis.speak(u);
  }
  cancel() { speechSynthesis.cancel(); this.current = null; }
  health() { return speechSynthesis.speaking ? 'speaking' : 'idle'; }
}

// Clips: decodes recorded MP3s and schedules every remaining cue on the audio
// clock up front, so cues still play if the page's timers are frozen.
class ClipEngine {
  kind = 'schedule';
  ctx = null;
  buffers = new Map();
  sources = [];
  offset = null; // audio clock minus wall clock, seconds
  async prepare() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('Web Audio is not available');
    if (!this.ctx) {
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* ignore */ }
      this.ctx = new AC();
      // A silent tone keeps the audio graph running between cues.
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain).connect(this.ctx.destination);
      osc.start();
    }
    const resumed = this.ctx.resume();
    if (!this.buffers.size) {
      const manifest = await (await fetch('clips/manifest.json')).json();
      await Promise.all(Object.entries(manifest).map(async ([text, file]) => {
        const data = await (await fetch(`clips/${file}`)).arrayBuffer();
        this.buffers.set(text, await new Promise((ok, fail) => this.ctx.decodeAudioData(data, ok, fail)));
      }));
    }
    await resumed;
  }
  // items: [{ at: wall ms, segments: [text], countdown }]
  schedule(items) {
    this.offset = this.ctx.currentTime - Date.now() / 1000;
    let prev = null;
    for (const item of items) {
      let t = Math.max(this.ctx.currentTime, item.at / 1000 + this.offset);
      if (prev && prev.end > t) {
        if (prev.countdown) t = prev.end; // countdowns are never cut off
        else prev.nodes.forEach(n => n.stop(t));
      }
      const nodes = [];
      let cursor = t;
      for (const seg of item.segments) {
        const buf = this.buffers.get(seg);
        if (!buf) { console.warn('No clip for', seg); continue; }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.ctx.destination);
        src.start(cursor);
        nodes.push(src);
        this.sources.push(src);
        cursor += buf.duration;
      }
      prev = { end: cursor, countdown: item.countdown, nodes };
    }
  }
  // Seconds the audio clock has slipped behind the wall clock since scheduling.
  drift() {
    if (!this.ctx || this.offset == null) return 0;
    return (Date.now() / 1000 + this.offset) - this.ctx.currentTime;
  }
  cancel() {
    for (const s of this.sources) { try { s.stop(); } catch { /* not started */ } }
    this.sources = [];
  }
  health() { return this.ctx ? this.ctx.state : 'not started'; }
}

const engines = { speech: new SpeechEngine(), clips: new ClipEngine() };

// ---------- screen wake ----------
const wake = {
  sentinel: null,
  mode: 'off',
  wanted: false,
  async on() {
    this.wanted = true;
    if ('wakeLock' in navigator) {
      try {
        this.sentinel = await navigator.wakeLock.request('screen');
        this.mode = 'Wake Lock API';
        this.sentinel.addEventListener('release', () => { this.sentinel = null; if (this.mode === 'Wake Lock API') this.mode = 'released'; render(); });
        render();
        return;
      } catch (e) {
        this.mode = `Wake Lock refused (${e.name}), video fallback`;
      }
    } else {
      this.mode = 'video fallback';
    }
    $('wakeVideo').play().catch(e => { this.mode = `video fallback failed (${e.name})`; render(); });
    render();
  },
  off() {
    this.wanted = false;
    if (this.sentinel) this.sentinel.release().catch(() => {});
    this.sentinel = null;
    $('wakeVideo').pause();
    this.mode = 'off';
  },
};

// ---------- workout state ----------
let run = null; // { workout, steps, cues, total, startedAt, pausedAt, pausedTotal, next, engine, stats }
let logEntries = [];
let lastRunStats = store.get('lastRunStats', null);

function elapsed() {
  if (!run) return 0;
  const now = run.pausedAt ?? Date.now();
  return (now - run.startedAt - run.pausedTotal) / 1000;
}
// Wall-clock time (ms) at which workout time t falls, given no further pauses.
const wallAt = t => run.startedAt + run.pausedTotal + t * 1000;

function log(t, text, status, bad = false) {
  const entry = { t, text, status, bad };
  logEntries.unshift(entry);
  logEntries = logEntries.slice(0, 60);
  renderLog();
  return entry;
}
function renderLog() {
  $('log').innerHTML = logEntries.map(e =>
    `<li><span class="t">${fmt(e.t)}</span><span>${e.text}</span><span class="s${e.bad ? ' bad' : ''}">${e.status}</span></li>`).join('');
}

function say(text, opts = {}) {
  const engine = run ? run.engine : engines[$('engine').value];
  if (engine.kind === 'tick') engine.say(text, opts);
  else engine.schedule([{ at: Date.now(), segments: opts.segments || [text], countdown: !!opts.countdown }]);
}

function scheduleRemaining(fromT) {
  const items = run.cues.filter(c => c.t >= fromT).map(c => ({ at: wallAt(c.t), segments: [c.text], countdown: c.countdown }));
  run.engine.schedule(items);
}

async function start() {
  if (run && !run.done) return;
  const workout = WORKOUTS.find(w => w.id === $('workout').value);
  const engine = engines[$('engine').value];
  // Everything that needs the tap's user gesture happens before any await.
  if ($('keepAlive').checked) $('keepAliveAudio').play().catch(e => log(0, 'Background audio blocked', e.name, true));
  if ($('keepAwake').checked) wake.on();
  $('start').disabled = true;
  try {
    const ready = engine.prepare();
    $('stepName').textContent = 'Loading…';
    await ready;
  } catch (e) {
    $('start').disabled = false;
    $('stepName').textContent = 'Voice failed';
    log(0, e.message, 'error', true);
    return;
  }
  run = {
    workout, engine, steps: timeline(workout), cues: buildCues(workout), total: totalSeconds(workout),
    startedAt: Date.now(), pausedAt: null, pausedTotal: 0, next: 0, done: false,
    stats: { maxLate: 0, missed: 0, stalls: 0, engine: $('engine').value, workout: workout.name },
  };
  logEntries = [];
  log(0, `${workout.name} started, ${engine === engines.speech ? 'speech' : 'clips'}`, clockTime(run.startedAt));
  if (engine.kind === 'schedule') scheduleRemaining(0);
  setControls();
  tick();
}

function togglePause() {
  if (!run || run.done) return;
  if (run.pausedAt == null) {
    run.pausedAt = Date.now();
    run.engine.cancel();
    log(elapsed(), 'Paused', '');
  } else {
    const t = elapsed();
    run.pausedTotal += Date.now() - run.pausedAt;
    run.pausedAt = null;
    const step = currentStep(t);
    const segs = resumeSegments(step.end - t);
    log(t, segs.join(' '), 'resumed');
    // Cues still ahead keep their place relative to the step's new end time.
    if (run.engine.kind === 'tick') say(segs.join(' '));
    else {
      run.engine.schedule([{ at: Date.now(), segments: segs, countdown: false },
        ...run.cues.filter(c => c.t >= t).map(c => ({ at: wallAt(c.t), segments: [c.text], countdown: c.countdown }))]);
    }
  }
  setControls();
  render();
}

function finish() {
  if (!run || run.done) return;
  if (!confirm('End this workout now?')) return;
  const t = elapsed();
  run.engine.cancel();
  if (run.pausedAt != null) { run.pausedTotal += Date.now() - run.pausedAt; run.pausedAt = null; }
  run.endedEarlyAt = t;
  say('Workout ended.');
  log(t, 'Workout ended.', 'finished early');
  end();
}

function end() {
  run.done = true;
  run.doneAt = Date.now();
  lastRunStats = { ...run.stats, seconds: Math.round(run.endedEarlyAt ?? run.total), at: new Date().toISOString() };
  store.set('lastRunStats', lastRunStats);
  setTimeout(() => {
    if (run && !run.done) return;
    wake.off();
    $('keepAliveAudio').pause();
  }, 4000);
  setControls();
  render();
}

function currentStep(t) {
  return run.steps.find(s => t < s.end) || run.steps[run.steps.length - 1];
}

// ---------- the timer loop: everything is derived from Date.now() ----------
function tick() {
  if (!run || run.done) return;
  const t = elapsed();
  if (run.pausedAt == null) {
    if (run.engine.kind === 'tick') {
      while (run.next < run.cues.length && run.cues[run.next].t <= t) {
        const cue = run.cues[run.next++];
        const late = t - cue.t;
        // A late countdown digit or a stale cue is worse than silence.
        if ((cue.countdown && late > 1) || late > 5) {
          run.stats.missed++;
          log(cue.t, cue.text, `missed, ${late.toFixed(1)} s late`, true);
          continue;
        }
        // Stays "sent, not heard" if the voice never actually starts speaking.
        const entry = log(cue.t, cue.text, 'sent, not heard', true);
        const thisRun = run, due = wallAt(cue.t);
        run.engine.say(cue.text, {
          countdown: cue.countdown,
          onStart: () => {
            const real = (Date.now() - due) / 1000;
            thisRun.stats.maxLate = Math.max(thisRun.stats.maxLate, real);
            entry.status = `${real.toFixed(2)} s late`;
            entry.bad = real > 1;
            renderLog();
          },
        });
      }
    } else {
      while (run.next < run.cues.length && run.cues[run.next].t <= t) {
        const cue = run.cues[run.next++];
        log(cue.t, cue.text, run.engine.health() === 'running' ? 'scheduled' : run.engine.health(), run.engine.health() !== 'running');
      }
      // If iOS suspended the audio clock (screen lock), queued cues are now late:
      // drop them and reschedule from the current time.
      const drift = run.engine.drift();
      if (Math.abs(drift) > 0.5) {
        run.stats.stalls++;
        run.stats.maxLate = Math.max(run.stats.maxLate, drift);
        log(t, `Audio clock stalled ${drift.toFixed(1)} s, rescheduled`, run.engine.health(), true);
        run.engine.cancel();
        if (run.engine.ctx.state !== 'running') run.engine.ctx.resume().catch(() => {});
        scheduleRemaining(t);
      }
    }
    if (t >= run.total) {
      log(run.total, 'Done', clockTime(Date.now()));
      end();
      return;
    }
  }
  render();
}

// ---------- rendering ----------
function render() {
  const status = [];
  if (!run) {
    const w = WORKOUTS.find(x => x.id === $('workout').value);
    $('stepName').textContent = 'Ready';
    $('stepName').className = '';
    $('rep').textContent = w.name;
    $('clock').textContent = fmt(totalSeconds(w));
    $('target').innerHTML = '&nbsp;';
    $('next').textContent = `First: ${w.steps[0].label}, ${fmt(w.steps[0].seconds)}`;
    $('elapsed').textContent = '0:00 elapsed';
    $('endsAt').textContent = '';
  } else {
    const t = Math.min(elapsed(), run.total);
    const step = currentStep(t);
    const nxt = run.steps[step.index + 1];
    $('stepName').textContent = run.done ? (run.endedEarlyAt != null ? 'Workout ended' : 'Workout complete') : (run.pausedAt != null ? `Paused: ${step.label}` : step.label);
    $('stepName').className = step.type;
    $('rep').textContent = step.rep ? `Rep ${step.rep.n} of ${step.rep.of}` : '';
    $('clock').textContent = run.done ? '0:00' : fmt(step.end - t);
    $('target').textContent = wattsText(step.watts).replace('watts', 'W');
    $('next').textContent = nxt ? `Next: ${nxt.label} ${fmt(nxt.seconds)}, ${nxt.watts} W` : 'Last step';
    $('elapsed').textContent = `${fmt(t)} elapsed of ${fmt(run.total)}`;
    $('endsAt').textContent = run.done ? `Stopped ${clockTime(run.doneAt)}` : `Ends ${clockTime(wallAt(run.total) + (run.pausedAt != null ? Date.now() - run.pausedAt : 0))}`;
    status.push(`Max cue delay <b>${run.stats.maxLate.toFixed(2)} s</b>`, `missed <b>${run.stats.missed}</b>`);
    if (run.engine.kind === 'schedule') status.push(`audio stalls <b>${run.stats.stalls}</b>`);
  }
  status.push(`Screen wake <b>${wake.mode}</b>`);
  const engine = run ? run.engine : engines[$('engine').value];
  status.push(`voice <b>${engine.health()}</b>`);
  $('status').innerHTML = status.join(' · ');
}

function setControls() {
  const active = run && !run.done;
  $('start').disabled = !!active;
  $('start').textContent = run && run.done ? 'Start again' : 'Start';
  $('pause').disabled = !active;
  $('pause').textContent = active && run.pausedAt != null ? 'Resume' : 'Pause';
  $('finish').disabled = !active;
  $('lock').disabled = !active;
  for (const id of ['workout', 'engine', 'keepAwake', 'keepAlive']) $(id).disabled = !!active;
}

// ---------- pocket lock ----------
function lock() {
  $('lockOverlay').classList.add('on');
}
(() => {
  const btn = $('unlock'), fill = $('unlockFill');
  const HOLD = 1500;
  let timer = null, startT = 0, raf = 0;
  const cancel = () => { clearTimeout(timer); cancelAnimationFrame(raf); fill.style.width = '0'; };
  const grow = () => { fill.style.width = `${Math.min(100, (Date.now() - startT) / HOLD * 100)}%`; raf = requestAnimationFrame(grow); };
  btn.addEventListener('pointerdown', e => {
    e.preventDefault();
    startT = Date.now();
    grow();
    timer = setTimeout(() => { cancel(); $('lockOverlay').classList.remove('on'); }, HOLD);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, cancel);
  btn.addEventListener('contextmenu', e => e.preventDefault());
  // Swallow every other tap on the overlay.
  $('lockOverlay').addEventListener('click', e => e.stopPropagation());
})();

// ---------- checklist ----------
const CHECKS = [
  ['Cues play with the screen on', 'Earbuds in, phone unlocked'],
  ['Cues play with the screen locked, or the screen stays on', 'Try with Keep screen awake on, then off and press the side button'],
  ['Cues play with the silent switch on', ''],
  ['Timing stays accurate over 30 minutes', 'Run the 30-minute test; compare the end time with the phone clock'],
  ['Works in a pocket', 'Lock, pocket the phone, nothing gets tapped'],
  ['Pause, resume and finish work', 'Resume says the time left; Finish asks once'],
];
let results = store.get('checklist', { speech: {}, clips: {}, notes: '' });

function renderChecks() {
  const key = $('engine').value;
  $('checkEngine').textContent = key === 'speech' ? 'Built-in speech' : 'Recorded clips';
  const r = results[key] || (results[key] = {});
  $('checks').innerHTML = CHECKS.map(([q, hint], i) => `
    <div class="check"><span class="n">${i + 1}</span>
      <span class="q">${q}${hint ? `<small>${hint}</small>` : ''}</span>
      <span class="seg">
        <button class="pass${r[i] === 'pass' ? ' on' : ''}" data-i="${i}" data-v="pass">Pass</button>
        <button class="fail${r[i] === 'fail' ? ' on' : ''}" data-i="${i}" data-v="fail">Fail</button>
      </span></div>`).join('');
  $('notes').value = results.notes || '';
}
$('checks').addEventListener('click', e => {
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  const r = results[$('engine').value];
  r[b.dataset.i] = r[b.dataset.i] === b.dataset.v ? undefined : b.dataset.v;
  store.set('checklist', results);
  renderChecks();
});
$('notes').addEventListener('input', () => { results.notes = $('notes').value; store.set('checklist', results); });

function resultsText() {
  const lines = [`Ride Timer Phase 1 results, ${new Date().toLocaleString()}`,
    `Device: ${navigator.userAgent}`,
    `Opened from home screen: ${navigator.standalone ? 'yes' : 'no'}`,
    `Wake Lock API available: ${'wakeLock' in navigator ? 'yes' : 'no'}; audioSession API: ${navigator.audioSession ? 'yes' : 'no'}`, ''];
  for (const [key, name] of [['speech', 'Built-in speech'], ['clips', 'Recorded clips']]) {
    const r = results[key] || {};
    lines.push(`${name}:`);
    CHECKS.forEach(([q], i) => lines.push(`  ${i + 1}. ${q}: ${r[i] ? r[i].toUpperCase() : 'not tested'}`));
  }
  if (lastRunStats) {
    const s = lastRunStats;
    lines.push('', `Last run: ${s.workout}, ${s.engine}, ${fmt(s.seconds)}; max cue delay ${s.maxLate.toFixed(2)} s, missed ${s.missed}, audio stalls ${s.stalls}`);
  }
  if (results.notes) lines.push('', `Notes: ${results.notes}`);
  return lines.join('\n');
}
$('copy').addEventListener('click', async () => {
  const text = resultsText();
  try { await navigator.clipboard.writeText(text); $('copy').textContent = 'Copied'; }
  catch { prompt('Copy these results:', text); }
  setTimeout(() => { $('copy').textContent = 'Copy results'; }, 2000);
});
$('clear').addEventListener('click', () => {
  if (!confirm('Clear all checklist results?')) return;
  results = { speech: {}, clips: {}, notes: '' };
  store.set('checklist', results);
  renderChecks();
});

// ---------- wiring ----------
$('workout').innerHTML = WORKOUTS.map(w => `<option value="${w.id}">${w.name} (${fmt(totalSeconds(w))})</option>`).join('');
const prefs = store.get('prefs', {});
for (const id of ['workout', 'engine']) if (prefs[id]) $(id).value = prefs[id];
for (const id of ['keepAwake', 'keepAlive']) if (id in prefs) $(id).checked = prefs[id];
const savePrefs = () => store.set('prefs', { workout: $('workout').value, engine: $('engine').value, keepAwake: $('keepAwake').checked, keepAlive: $('keepAlive').checked });
for (const id of ['workout', 'engine', 'keepAwake', 'keepAlive']) $(id).addEventListener('change', () => { savePrefs(); renderChecks(); if (!run || run.done) { run = null; } render(); });

$('start').addEventListener('click', () => { if (run && run.done) run = null; start(); });
$('pause').addEventListener('click', togglePause);
$('finish').addEventListener('click', finish);
$('lock').addEventListener('click', lock);
$('testVoice').addEventListener('click', async () => {
  const engine = engines[$('engine').value];
  try {
    await engine.prepare();
    if (engine.kind === 'tick') engine.say('Voice test. 205 watts for 1 minute.');
    else engine.schedule([{ at: Date.now(), segments: ['Voice test. 205 watts for 1 minute.'], countdown: false }]);
  } catch (e) { log(0, e.message, 'error', true); }
  render();
});
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !['TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement.tagName)) { e.preventDefault(); togglePause(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (run && !run.done && wake.wanted && !wake.sentinel && 'wakeLock' in navigator) wake.on();
  tick();
});

// Timers can be slowed in the background; they only decide when to look at the clock.
setInterval(tick, 200);
(function frame() { if (run && !run.done) render(); requestAnimationFrame(frame); })();
renderChecks();
render();
// Exposed for automated tests only.
window.__rideTimer = { get run() { return run; }, engines };
