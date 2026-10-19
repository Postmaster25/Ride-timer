// Run with: node test/run.mjs
import assert from 'node:assert/strict';
import { validatePlan, description, scaledStep, calendar, toYMD, scaleWatts, planTotals, stageHours } from '../js/plan.js';
import { buildCues, vocabulary } from '../js/cues.js';
import { SAMPLE } from './sample-plan.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('spec example validates', () => {
  const r = validatePlan(SAMPLE);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.stats, { name: 'Mueller Sub-30 Plan', version: '2026-10-17', weeks: 1, rides: 1 });
});

test('validation reports week and weekday', () => {
  const bad = structuredClone(SAMPLE);
  bad.weeks[0].days[1].steps[5].wattsLow = 300;
  bad.weeks[0].days[1].steps[0].seconds = 0;
  bad.weeks[0].days.push({ weekday: 9, kind: 'ride', title: 'W5 SS', steps: [{ type: 'work', seconds: 10 }] });
  delete bad.version;
  const { errors } = validatePlan(bad);
  assert.ok(errors.some(e => e.includes('"version" is missing')), errors.join('\n'));
  assert.ok(errors.some(e => e.startsWith('Week 5, Wed (W5 SS), step 6: "wattsLow" is greater')), errors.join('\n'));
  assert.ok(errors.some(e => e.startsWith('Week 5, Wed (W5 SS), step 1: "seconds"')), errors.join('\n'));
  assert.ok(errors.some(e => e.includes('"weekday" must be 1')), errors.join('\n'));
  assert.ok(errors.some(e => e.includes('title is also used in Week 5, Wed')), errors.join('\n'));
});

test('description matches the spec example', () => {
  const day = SAMPLE.weeks[0].days[1];
  assert.equal(description(day, SAMPLE, 235), [
    'W5 SS | Sweet spot',
    'Planned: 2 x 10 min at 205 W (87% of FTP 235), HR about 150 to 158 bpm, 5 min recovery.',
    'Warm-up 10 min, cool-down 5 min.',
    'Plan version: 2026-10-17',
  ].join('\n'));
});

test('watts scale to FTP, rounded to 5', () => {
  assert.equal(scaleWatts(205, 235, 250), 220); // 218.1 -> 220
  assert.equal(scaleWatts(0, 235, 250), 0);
  assert.equal(scaledStep({ wattsLow: 130, wattsHigh: 165 }, SAMPLE, 260).wattsHigh, 185);
});

test('calendar: Oct 19, 2026 start makes May 22, 2027 week 31', () => {
  const cal = calendar('2026-10-19');
  assert.equal(toYMD(cal.dateOf(1, 1)), '2026-10-19');
  assert.equal(cal.weekOf(new Date(2027, 4, 22, 12)), 31);
  const mid = calendar('2026-10-22'); // a Thursday
  assert.equal(toYMD(mid.week1), '2026-10-19');
  assert.equal(mid.beforeStart(mid.dateOf(1, 2)), true);
  assert.equal(mid.beforeStart(mid.dateOf(1, 4)), false);
});

const say = cues => cues.map(c => `${c.t} ${c.segments.join(' ')}`);

test('cues for the spec example', () => {
  const steps = SAMPLE.weeks[0].days[1].steps.map(s => scaledStep(s, SAMPLE, 235));
  const lines = say(buildCues(steps, 'SS'));
  const expect = [
    '0 Warm-up, 10 minutes',
    '360 Go.', '390 Ease.', '450 Go.', '480 Ease.',
    '585 Next interval starting in 15 seconds: 205 watts for 10 minutes',
    '595 5.', '596 4.', '597 3.', '598 2.', '599 1.',
    '600 Rep 1 of 2. 205 watts 10 minutes',
    '900 Halfway.', '1140 One minute left.',
    '1195 5.', '1196 4.', '1197 3.', '1198 2.', '1199 1.',
    '1200 Recovery, 5 minutes',
    '1485 Next interval starting in 15 seconds: 205 watts for 10 minutes',
    '1495 5.', '1496 4.', '1497 3.', '1498 2.', '1499 1.',
    '1500 Rep 2 of 2. 205 watts 10 minutes',
    '1800 Halfway.', '2040 One minute left.',
    '2095 5.', '2096 4.', '2097 3.', '2098 2.', '2099 1.',
    '2100 Cool down, 5 minutes',
    '2400 Workout complete.',
  ];
  assert.deepEqual(lines, expect);
});

test('V30: Go and Ease, reps left, no countdowns', () => {
  const steps = [{ type: 'warmup', seconds: 300 }];
  for (let n = 1; n <= 6; n++) {
    steps.push({ type: 'work', seconds: 30, wattsLow: 300, wattsHigh: 300, rep: { n, of: 6 } });
    if (n < 6) steps.push({ type: 'recovery', seconds: 15 });
  }
  steps.push({ type: 'cooldown', seconds: 300 });
  const lines = say(buildCues(steps, 'V30'));
  assert.ok(lines.includes('285 Next interval starting in 15 seconds: 300 watts for 30 seconds'));
  assert.ok(lines.includes('300 Go.'));
  assert.ok(lines.includes('330 Ease. 5 to go.'));
  assert.ok(lines.includes('375 Ease.'));
  assert.ok(lines.includes('465 Ease. 2 to go.'));
  assert.ok(lines.includes('510 Ease. 1 to go.'));
  assert.ok(!lines.some(l => / [1-5]\.$/.test(l)), lines.join('\n'));
});

test('short recovery skips the advance notice; test rides get a plain countdown', () => {
  const steps = [
    { type: 'warmup', seconds: 600 },
    { type: 'work', seconds: 1800, extraCues: [{ atSeconds: 600, say: 'Ten minutes in. The next 20 minutes are the ones to track.' }] },
    { type: 'cooldown', seconds: 600 },
  ];
  const lines = say(buildCues(steps, 'T'));
  assert.ok(lines.includes('600 Go. 30 minutes'));
  assert.ok(lines.includes('1200 Ten minutes in. The next 20 minutes are the ones to track.'));
  assert.ok(!lines.some(l => l.includes('Halfway')));
  const s2 = [{ type: 'work', seconds: 60, wattsLow: 300, wattsHigh: 300 }, { type: 'recovery', seconds: 15 }, { type: 'work', seconds: 60, wattsLow: 300, wattsHigh: 300 }];
  assert.ok(!say(buildCues(s2, 'X')).some(l => l.includes('Next interval')));
});

test('every cue phrase in the spec example has a clip', () => {
  const vocab = new Set(vocabulary());
  const steps = SAMPLE.weeks[0].days[1].steps.map(s => scaledStep(s, SAMPLE, 235));
  for (const c of buildCues(steps, 'SS')) for (const seg of c.segments) assert.ok(vocab.has(seg), seg);
});

test('minutes and optional: validated, optional days and missing minutes skipped in totals', () => {
  const p = structuredClone(SAMPLE);
  const { days } = p.weeks[0];
  days[0].minutes = 45; // Volt counts as 60 whatever it says
  days.push({ weekday: 2, kind: 'run', summary: 'Easy run', minutes: 30 });
  days.push({ weekday: 5, kind: 'run', summary: 'Optional short run', minutes: 20, optional: true });
  days.push({ weekday: 7, kind: 'rest', summary: 'Rest' });
  assert.deepEqual(validatePlan(p).errors, []);
  // The ride has no "minutes" (a plan saved before the field existed): 0.
  const t = planTotals(p);
  assert.equal(t.count, 3);
  assert.equal(t.minutes, 90);
  assert.deepEqual(t.byKind.run, { count: 1, minutes: 30 });
  assert.deepEqual(t.byKind.strength, { count: 1, minutes: 60 });
  days[1].minutes = 75;
  assert.deepEqual(stageHours(p, { startWeek: 5, endWeek: 6 }), { avg: 1.375, min: 0, max: 2.75 });
  days[1].minutes = -5;
  days[2].optional = 'yes';
  const { errors } = validatePlan(p);
  assert.ok(errors.some(e => e.startsWith('Week 5, Wed: "minutes"')), errors.join('\n'));
  assert.ok(errors.some(e => e.startsWith('Week 5, Tue: "optional"')), errors.join('\n'));
});

test('stages must start at week 1 and cover every week in order', () => {
  const p = structuredClone(SAMPLE);
  p.stages = [{ name: 'A', startWeek: 1, endWeek: 3, days: {} }, { name: 'B', startWeek: 4, endWeek: 5, days: {} }];
  assert.deepEqual(validatePlan(p).errors, []);
  p.stages[1].startWeek = 5;
  assert.ok(validatePlan(p).errors.some(e => e.includes('week 4 was expected')));
  p.stages = [{ name: 'A', startWeek: 1, endWeek: 3, days: {} }];
  assert.ok(validatePlan(p).errors.some(e => e.includes('plan runs to week 5')));
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}\n${e.message}`); }
}
console.log(`${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
