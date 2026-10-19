// Workouts and cue rules for the Phase 1 prototype. Pure module: no DOM, so
// tools/make-clips.mjs can import it to know which phrases need audio clips.

export const WORKOUTS = [
  {
    id: 'test4',
    name: '4-minute test',
    steps: [
      { type: 'warmup', label: 'Warm-up', seconds: 40, watts: 130 },
      { type: 'work', label: 'Hard', seconds: 60, watts: 205, rep: { n: 1, of: 2 } },
      { type: 'recovery', label: 'Recovery', seconds: 40, watts: 110 },
      { type: 'work', label: 'Hard', seconds: 60, watts: 205, rep: { n: 2, of: 2 } },
      { type: 'cooldown', label: 'Cool down', seconds: 40, watts: 110 },
    ],
  },
  {
    id: 'spec75',
    name: 'Spec timings (75 s)',
    steps: [
      { type: 'warmup', label: 'Warm-up', seconds: 10, watts: 130 },
      { type: 'work', label: 'Hard', seconds: 20, watts: 205, rep: { n: 1, of: 2 } },
      { type: 'recovery', label: 'Recovery', seconds: 15, watts: 110 },
      { type: 'work', label: 'Hard', seconds: 20, watts: 205, rep: { n: 2, of: 2 } },
      { type: 'cooldown', label: 'Cool down', seconds: 10, watts: 110 },
    ],
  },
  {
    id: 'test30',
    name: '30-minute accuracy test',
    steps: (() => {
      const steps = [{ type: 'warmup', label: 'Warm-up', seconds: 180, watts: 130 }];
      for (let n = 1; n <= 5; n++) {
        steps.push({ type: 'work', label: 'Hard', seconds: 240, watts: 205, rep: { n, of: 5 } });
        if (n < 5) steps.push({ type: 'recovery', label: 'Recovery', seconds: 60, watts: 110 });
      }
      steps.push({ type: 'cooldown', label: 'Cool down', seconds: 180, watts: 110 });
      return steps;
    })(),
  },
];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "40 seconds", "1 minute", "1 minute 30 seconds"
export function durationText(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return plural(s, 'second');
  if (s === 0) return plural(m, 'minute');
  return `${plural(m, 'minute')} ${plural(s, 'second')}`;
}

export function wattsText(low, high = low) {
  return low === high ? `${low} watts` : `${low} to ${high} watts`;
}

// Resume cue split into pieces so recorded clips can be chained.
export function resumeSegments(secondsLeft) {
  secondsLeft = Math.max(1, Math.ceil(secondsLeft));
  const m = Math.floor(secondsLeft / 60);
  const s = secondsLeft % 60;
  const segs = ['Resuming.'];
  if (m) segs.push(plural(m, 'minute'));
  if (s) segs.push(plural(s, 'second'));
  segs.push('left.');
  return segs;
}

export const FIXED_PHRASES = ['Workout ended.', 'Voice test. 205 watts for 1 minute.'];

// Every phrase the resume cue can need, up to 30 minutes left.
export function resumeVocabulary() {
  const out = new Set(['Resuming.', 'left.']);
  for (let m = 1; m <= 30; m++) out.add(plural(m, 'minute'));
  for (let s = 1; s <= 59; s++) out.add(plural(s, 'second'));
  return [...out];
}

// Lay out step start/end times on the workout timeline (seconds).
export function timeline(workout) {
  let t = 0;
  return workout.steps.map((step, i) => {
    const s = { ...step, index: i, start: t, end: t + step.seconds };
    t = s.end;
    return s;
  });
}

// Build the full cue list for a workout. Each cue: { t, text, countdown }.
// t is seconds from the start of the workout (excluding pauses).
export function buildCues(workout) {
  const steps = timeline(workout);
  const cues = [];
  const add = (t, text, countdown = false) => {
    if (t >= 0) cues.push({ t, text, countdown });
  };
  const countdown = endT => {
    for (let k = 5; k >= 1; k--) add(endT - k, `${k}.`, true);
  };

  steps.forEach((step, i) => {
    const prev = steps[i - 1];
    const isLast = i === steps.length - 1;
    if (step.type === 'warmup') add(step.start, `Warm-up, ${durationText(step.seconds)}.`);
    if (step.type === 'recovery') add(step.start, `Recovery, ${durationText(step.seconds)}.`);
    if (step.type === 'cooldown' && isLast) add(step.start, `Cool down, ${durationText(step.seconds)}.`);
    if (step.type === 'work') {
      const w = wattsText(step.watts);
      const d = durationText(step.seconds);
      // A preceding step shorter than 20 s skips the 15-second notice.
      if (prev && prev.seconds >= 20) {
        add(step.start - 15, `Next interval starting in 15 seconds: ${w} for ${d}.`);
      }
      if (prev) countdown(step.start);
      const rep = step.rep ? `Rep ${step.rep.n} of ${step.rep.of}. ` : '';
      add(step.start, `${rep}${w}. ${d}.`);
      if (step.seconds >= 240) add(step.start + step.seconds / 2, 'Halfway.');
      if (step.seconds >= 180) add(step.end - 60, 'One minute left.');
      countdown(step.end);
    }
  });
  add(steps[steps.length - 1].end, 'Workout complete.');
  // Stable sort keeps a countdown digit ahead of a cue due at the same moment.
  return cues.sort((a, b) => a.t - b.t);
}

export function totalSeconds(workout) {
  return workout.steps.reduce((sum, s) => sum + s.seconds, 0);
}

export function allPhrases() {
  const set = new Set(FIXED_PHRASES);
  for (const w of WORKOUTS) for (const c of buildCues(w)) set.add(c.text);
  for (const p of resumeVocabulary()) set.add(p);
  return [...set];
}

export function clipName(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.mp3';
}
