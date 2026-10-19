// Voice cue rules (spec "Voice cues"). Each cue is a list of short phrases
// ("segments") so recorded clips can be chained: ["Rep 2 of 2.", "205 watts", "12 minutes"].
// Pure module: tools/make-clips.mjs imports VOCABULARY to record every phrase.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const LIMITS = { minutes: 240, wattsMin: 50, wattsMax: 800, reps: 12, toGo: 20 };

export function durSegs(sec) {
  sec = Math.max(1, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  const out = [];
  if (m) out.push(plural(m, 'minute'));
  if (s) out.push(plural(s, 'second'));
  return out;
}

export function wattsSegs(lo, hi) {
  if (hi == null || hi === 0) return [];
  if (lo == null || lo === 0 || lo === hi) return [`${hi} watts`];
  return [`${lo}`, 'to', `${hi} watts`];
}

export function repSegs(rep) {
  if (!rep) return [];
  if (rep.of <= LIMITS.reps) return [`Rep ${rep.n} of ${rep.of}.`];
  return ['Rep', `${rep.n}`, 'of', `${rep.of}`];
}

export function resumeSegs(secondsLeft) {
  return ['Resuming.', ...durSegs(Math.ceil(secondsLeft)), 'left.'];
}

const TEST_CODE = /^(T|B|M)\d*$/i; // 30-min test, 20-min benchmark, Mueller segment
export const isTestRide = code => TEST_CODE.test(code || '');

// steps: scaled steps (watts already at the rider's FTP). Returns sorted cues
// { t, segments, countdown } with t in seconds from the start of the ride.
export function buildCues(steps, workoutCode) {
  const cues = [];
  const add = (t, segments, countdown = false) => { if (t >= 0 && segments.length) cues.push({ t, segments, countdown }); };
  const countdown = endT => { for (let k = 5; k >= 1; k--) add(endT - k, [`${k}.`], true); };
  const v30 = /^V30/i.test(workoutCode || '');
  const test = isTestRide(workoutCode);

  let t = 0;
  const laid = steps.map(s => { const x = { ...s, start: t, end: t + s.seconds }; t = x.end; return x; });
  let warmupSaid = false;

  laid.forEach((step, i) => {
    const prev = laid[i - 1];
    const mode = step.cue; // undefined = full, 'short', 'none'
    if (mode === 'none') return;
    for (const extra of step.extraCues || []) add(step.start + extra.atSeconds, [extra.say]);
    const isV30Effort = v30 && step.type === 'work' && step.seconds <= 30;
    const isV30Rest = v30 && step.type === 'recovery' && step.seconds <= 15;

    if (step.type === 'warmup' && !warmupSaid && mode !== 'short') {
      // The warm-up runs until the first full-cue step, so openers count toward it.
      let j = i + 1;
      while (j < laid.length && (laid[j].type === 'warmup' || laid[j].cue === 'short' || laid[j].cue === 'none')) j++;
      add(step.start, ['Warm-up,', ...durSegs(laid[j - 1].end - step.start)]);
      warmupSaid = true;
    }
    if (step.type === 'steady' && mode !== 'short') add(step.start, ['Steady,', ...durSegs(step.seconds)]);
    if (step.type === 'cooldown' && mode !== 'short') add(step.start, ['Cool down,', ...durSegs(step.seconds)]);

    if (step.type === 'recovery' && mode !== 'short') {
      if (isV30Rest) {
        // "Ease" at each 15-second recovery, plus the reps left every few reps.
        const segs = ['Ease.'];
        const left = prev?.rep ? prev.rep.of - prev.rep.n : null;
        if (left != null && left > 0 && left <= LIMITS.toGo && (left % 5 === 0 || left <= 3)) segs.push(`${left} to go.`);
        add(step.start, segs);
      } else {
        add(step.start, ['Recovery,', ...durSegs(step.seconds)]);
      }
    }

    if (step.type !== 'work') return;
    if (mode === 'short') {
      add(step.start, ['Go.']);
      add(step.end, ['Ease.']);
      return;
    }
    // Advance notice, unless the step before is shorter than 20 s.
    if (prev && prev.seconds >= 20 && prev.type !== 'work') {
      const w = wattsSegs(step.wattsLow, step.wattsHigh);
      add(step.start - 15, ['Next interval starting in 15 seconds:', ...w, ...(w.length ? ['for'] : []), ...durSegs(step.seconds)]);
    }
    if (isV30Effort) {
      add(step.start, ['Go.']);
      return;
    }
    if (prev && prev.seconds >= 6) countdown(step.start);
    if (test) {
      add(step.start, ['Go.', ...durSegs(step.seconds)]);
    } else {
      add(step.start, [...repSegs(step.rep), ...wattsSegs(step.wattsLow, step.wattsHigh), ...durSegs(step.seconds)]);
      if (step.seconds >= 240) add(step.start + step.seconds / 2, ['Halfway.']);
      if (step.seconds >= 180) add(step.end - 60, ['One minute left.']);
    }
    countdown(step.end);
  });
  add(t, ['Workout complete.']);
  // Cues due at the same moment are joined in the order they were added
  // ("Ease. Recovery, 2 minutes."), so neither cuts the other off.
  const merged = [];
  for (const c of cues.map((c, i) => ({ ...c, i })).sort((a, b) => a.t - b.t || a.i - b.i)) {
    const last = merged[merged.length - 1];
    if (last && last.t === c.t && !last.countdown && !c.countdown) last.segments.push(...c.segments);
    else merged.push({ t: c.t, segments: [...c.segments], countdown: c.countdown });
  }
  return merged;
}

// Every phrase the app can say, for recording clips.
export function vocabulary() {
  const v = new Set([
    'Warm-up,', 'Recovery,', 'Cool down,', 'Steady,', 'Next interval starting in 15 seconds:', 'for', 'to',
    'Halfway.', 'One minute left.', 'Workout complete.', 'Workout ended.', 'Resuming.', 'left.', 'Go.', 'Ease.',
    'Rep', 'of', 'Voice on.',
    'Ten minutes in. The next 20 minutes are the ones to track.',
  ]);
  for (let k = 1; k <= 5; k++) v.add(`${k}.`);
  for (let m = 1; m <= LIMITS.minutes; m++) v.add(plural(m, 'minute'));
  for (let s = 1; s <= 59; s++) v.add(plural(s, 'second'));
  for (let w = LIMITS.wattsMin; w <= LIMITS.wattsMax; w += 5) { v.add(`${w} watts`); v.add(`${w}`); }
  for (let n = 1; n <= 60; n++) v.add(`${n}`);
  for (let of = 1; of <= LIMITS.reps; of++) for (let n = 1; n <= of; n++) v.add(`Rep ${n} of ${of}.`);
  for (let n = 1; n <= LIMITS.toGo; n++) v.add(`${n} to go.`);
  return [...v];
}

export const COUNTDOWN = ['5.', '4.', '3.', '2.', '1.'];

export function clipName(text) {
  // Countdown digits are recorded as words ("Five."), apart from bare numbers.
  if (COUNTDOWN.includes(text)) return `count-${text[0]}.mp3`;
  return (text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x') + '.mp3';
}
