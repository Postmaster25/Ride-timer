// Plan data: validation, FTP scaling, calendar math and the Strava description.
// Pure module (no DOM) so it can be tested in Node.

export const DAY_KINDS = ['ride', 'strength', 'run', 'rest', 'free'];
export const STEP_TYPES = ['warmup', 'work', 'recovery', 'cooldown', 'steady'];
export const CUE_MODES = [undefined, 'short', 'none'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const isInt = n => Number.isInteger(n);
const isNum = n => typeof n === 'number' && Number.isFinite(n);

// Returns { errors: [string], stats } without changing anything.
export function validatePlan(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { errors: ['The file is not a plan object.'] };
  if (!plan.version || typeof plan.version !== 'string') errors.push('Plan: "version" is missing.');
  if (!isNum(plan.ftpReference) || plan.ftpReference <= 0) errors.push('Plan: "ftpReference" must be a positive number of watts.');
  if (!Array.isArray(plan.weeks) || !plan.weeks.length) {
    errors.push('Plan: "weeks" must be a list with at least one week.');
    return { errors };
  }
  const titles = new Map();
  let rides = 0;
  const weekNums = new Set();
  plan.weeks.forEach((wk, wi) => {
    const wLabel = isInt(wk?.week) ? `Week ${wk.week}` : `Week entry ${wi + 1}`;
    if (!isInt(wk?.week) || wk.week < 1) errors.push(`${wLabel}: "week" must be a whole number of 1 or more.`);
    else if (weekNums.has(wk.week)) errors.push(`${wLabel}: this week number appears more than once.`);
    else weekNums.add(wk.week);
    if (!Array.isArray(wk?.days)) { errors.push(`${wLabel}: "days" must be a list.`); return; }
    wk.days.forEach((day, di) => {
      const dLabel = `${wLabel}, ${isInt(day?.weekday) && day.weekday >= 1 && day.weekday <= 7 ? WEEKDAYS[day.weekday - 1] : `day entry ${di + 1}`}`;
      if (!isInt(day?.weekday) || day.weekday < 1 || day.weekday > 7) errors.push(`${dLabel}: "weekday" must be 1 (Monday) to 7 (Sunday).`);
      if (!DAY_KINDS.includes(day?.kind)) { errors.push(`${dLabel}: "kind" must be one of ${DAY_KINDS.join(', ')}.`); return; }
      if (day.kind !== 'ride') return;
      rides++;
      const rLabel = `${dLabel} (${day.title || 'untitled ride'})`;
      if (!day.title || typeof day.title !== 'string') errors.push(`${dLabel}: ride has no "title".`);
      else if (titles.has(day.title)) errors.push(`${rLabel}: title is also used in ${titles.get(day.title)}.`);
      else titles.set(day.title, dLabel);
      if (!Array.isArray(day.steps) || !day.steps.length) { errors.push(`${rLabel}: ride has no "steps".`); return; }
      day.steps.forEach((st, si) => {
        const sLabel = `${rLabel}, step ${si + 1}`;
        if (!STEP_TYPES.includes(st?.type)) errors.push(`${sLabel}: "type" must be one of ${STEP_TYPES.join(', ')}.`);
        if (!isNum(st?.seconds) || st.seconds <= 0) errors.push(`${sLabel}: "seconds" must be a positive number.`);
        if (st?.wattsLow != null && !isNum(st.wattsLow)) errors.push(`${sLabel}: "wattsLow" must be a number.`);
        if (st?.wattsHigh != null && !isNum(st.wattsHigh)) errors.push(`${sLabel}: "wattsHigh" must be a number.`);
        if (isNum(st?.wattsLow) && isNum(st?.wattsHigh) && st.wattsLow > st.wattsHigh) errors.push(`${sLabel}: "wattsLow" is greater than "wattsHigh".`);
        if (isNum(st?.hrLow) && isNum(st?.hrHigh) && st.hrLow > st.hrHigh) errors.push(`${sLabel}: "hrLow" is greater than "hrHigh".`);
        if (!CUE_MODES.includes(st?.cue)) errors.push(`${sLabel}: "cue" must be "short", "none" or left out.`);
        if (st?.extraCues != null) {
          if (!Array.isArray(st.extraCues)) errors.push(`${sLabel}: "extraCues" must be a list.`);
          else st.extraCues.forEach((c, ci) => {
            if (!isNum(c?.atSeconds) || c.atSeconds < 0 || c.atSeconds >= st.seconds || typeof c?.say !== 'string') {
              errors.push(`${sLabel}, extra cue ${ci + 1}: needs "atSeconds" inside the step and "say" text.`);
            }
          });
        }
      });
    });
  });
  return { errors, stats: { name: plan.planName || 'Untitled plan', version: plan.version, weeks: weekNums.size, rides } };
}

export const round5 = w => Math.round(w / 5) * 5;

// Watts are stored at the plan's reference FTP and scaled to the FTP in Settings.
export function scaleWatts(w, ftpReference, ftp) {
  if (!isNum(w)) return null;
  if (w === 0) return 0;
  return round5((w / ftpReference) * ftp);
}

export function scaledStep(step, plan, ftp) {
  const lo = scaleWatts(step.wattsLow, plan.ftpReference, ftp);
  const hi = scaleWatts(step.wattsHigh ?? step.wattsLow, plan.ftpReference, ftp);
  return { ...step, wattsLow: lo ?? hi, wattsHigh: hi ?? lo };
}

export function allRides(plan) {
  const out = [];
  for (const wk of plan?.weeks || []) for (const day of wk.days) if (day.kind === 'ride') out.push({ week: wk.week, day });
  return out;
}

export function findRide(plan, title) {
  return allRides(plan).find(r => r.day.title === title) || null;
}

export function lastWeek(plan) {
  return Math.max(...(plan?.weeks || []).map(w => w.week), 1);
}

// ---------- dates (all local time, as plain Y-M-D) ----------
export function parseYMD(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 12) : null;
}
export function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(12, 0, 0, 0);
  return x;
}
export function mondayOf(d) {
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(d, -dow);
}
const dayDiff = (a, b) => Math.round((b - a) / 86400000);

// Week 1 begins on the Monday of the week containing the start date.
export function calendar(startYMD) {
  const start = parseYMD(startYMD);
  if (!start) return null;
  const week1 = mondayOf(start);
  return {
    start,
    week1,
    dateOf: (week, weekday) => addDays(week1, (week - 1) * 7 + weekday - 1),
    weekOf: date => Math.floor(dayDiff(week1, date) / 7) + 1,
    beforeStart: date => dayDiff(start, date) < 0,
    daysUntilStart: today => dayDiff(today, start),
  };
}

// ---------- text ----------
export function shortDuration(sec) {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  if (!m) return `${s} s`;
  return s ? `${m} min ${s} s` : `${m} min`;
}
export function wattsLabel(lo, hi) {
  if (lo == null && hi == null) return '';
  if (lo === hi || hi == null) return `${lo} W`;
  if (lo === 0) return `up to ${hi} W`;
  return `${lo} to ${hi} W`;
}
export function hrLabel(st) {
  if (st.hrLow != null && st.hrHigh != null) return st.hrLow === st.hrHigh ? `${st.hrLow} bpm` : `${st.hrLow} to ${st.hrHigh} bpm`;
  if (st.hrHigh != null) return `under ${st.hrHigh} bpm`;
  if (st.hrLow != null) return `over ${st.hrLow} bpm`;
  return '';
}
export function cadenceLabel(st) {
  if (st.cadenceLow != null && st.cadenceHigh != null) return st.cadenceLow === st.cadenceHigh ? `${st.cadenceLow} rpm` : `${st.cadenceLow} to ${st.cadenceHigh} rpm`;
  if (st.cadenceLow != null) return `${st.cadenceLow}+ rpm`;
  return '';
}

// The steps the ride is built around: full-cue work steps, or steady steps.
export function mainSteps(steps) {
  const work = steps.filter(s => s.type === 'work' && s.cue !== 'short' && s.cue !== 'none');
  if (work.length) return work;
  const anyWork = steps.filter(s => s.type === 'work');
  if (anyWork.length) return anyWork;
  return steps.filter(s => s.type === 'steady');
}

const pct = (w, ftp) => Math.round((w / ftp) * 100);

// Plain-text description Cody pastes into Strava.
export function description(day, plan, ftp) {
  const steps = day.steps.map(s => scaledStep(s, plan, ftp));
  const main = mainSteps(steps);
  const label = main[0]?.label || day.name || day.workoutCode || '';
  const lines = [`${day.title} | ${label}`];

  const target = s => {
    if (s.wattsHigh == null) return '';
    const w = s.wattsLow === s.wattsHigh ? `${s.wattsLow} W` : `${s.wattsLow} to ${s.wattsHigh} W`;
    const p = s.wattsLow === s.wattsHigh ? `${pct(s.wattsLow, ftp)}%` : `${pct(s.wattsLow, ftp)} to ${pct(s.wattsHigh, ftp)}%`;
    return ` at ${w} (${p} of FTP ${ftp})`;
  };
  const hr = s => {
    if (s.hrLow != null && s.hrHigh != null) return `HR about ${s.hrLow} to ${s.hrHigh} bpm`;
    if (s.hrHigh != null) return `HR under ${s.hrHigh} bpm`;
    return '';
  };
  const durWord = sec => shortDuration(sec);

  let planned;
  if (main.length) {
    const same = main.every(s => s.seconds === main[0].seconds && s.wattsLow === main[0].wattsLow && s.wattsHigh === main[0].wattsHigh);
    const parts = [];
    if (same) parts.push(`${main.length > 1 ? `${main.length} x ` : ''}${durWord(main[0].seconds)}${target(main[0])}`);
    else parts.push(main.map(s => `${durWord(s.seconds)}${target(s)}`).join(', '));
    const h = hr(main[0]);
    if (h) parts.push(h);
    if (main.length > 1) {
      const i0 = steps.indexOf(main[0]), i1 = steps.indexOf(main[1]);
      const rec = steps.slice(i0 + 1, i1).filter(s => s.type === 'recovery').reduce((a, s) => a + s.seconds, 0);
      if (rec) parts.push(`${durWord(rec)} recovery`);
    }
    planned = `Planned: ${parts.join(', ')}.`;
  } else {
    planned = `Planned: ${durWord(steps.reduce((a, s) => a + s.seconds, 0))}.`;
  }
  lines.push(planned);

  if (main.length) {
    const first = steps.indexOf(main[0]), last = steps.indexOf(main[main.length - 1]);
    const wu = steps.slice(0, first).reduce((a, s) => a + s.seconds, 0);
    const cd = steps.slice(last + 1).reduce((a, s) => a + s.seconds, 0);
    const bits = [];
    if (wu) bits.push(`Warm-up ${durWord(wu)}`);
    if (cd) bits.push(`cool-down ${durWord(cd)}`);
    if (bits.length) lines.push(`${bits.join(', ').replace(/^c/, 'C')}.`);
  }
  lines.push(`Plan version: ${plan.version}`);
  return lines.join('\n');
}

// Whether a ride has anything worth running the timer for (all rides can).
export function totalSeconds(steps) {
  return steps.reduce((a, s) => a + s.seconds, 0);
}
