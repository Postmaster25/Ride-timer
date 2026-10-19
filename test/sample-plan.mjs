// The example plan from the spec, used by the tests. Not a real training plan.
export const SAMPLE = {
  planName: 'Mueller Sub-30 Plan',
  version: '2026-10-17',
  ftpReference: 235,
  weeks: [
    {
      week: 5,
      days: [
        { weekday: 1, kind: 'strength', summary: 'Volt total body' },
        {
          weekday: 3, kind: 'ride', title: 'W5 SS', name: 'Sweet spot 2 x 10',
          summary: 'Sweet spot, 2 x 10 min at 205 W, 5 min recovery', workoutCode: 'SS',
          steps: [
            { type: 'warmup', label: 'Warm-up', seconds: 360, wattsLow: 130, wattsHigh: 165, hrLow: 112, hrHigh: 135 },
            { type: 'work', label: 'Opener', seconds: 30, wattsLow: 200, wattsHigh: 220, cue: 'short' },
            { type: 'recovery', seconds: 60, wattsLow: 0, wattsHigh: 130, cue: 'short' },
            { type: 'work', label: 'Opener', seconds: 30, wattsLow: 200, wattsHigh: 220, cue: 'short' },
            { type: 'recovery', seconds: 120, wattsLow: 0, wattsHigh: 130, cue: 'short' },
            { type: 'work', label: 'Sweet spot', seconds: 600, wattsLow: 205, wattsHigh: 205, hrLow: 150, hrHigh: 158, cadenceLow: 85, cadenceHigh: 95, rpe: '6', rep: { n: 1, of: 2 } },
            { type: 'recovery', seconds: 300, wattsLow: 0, wattsHigh: 130, hrHigh: 125 },
            { type: 'work', label: 'Sweet spot', seconds: 600, wattsLow: 205, wattsHigh: 205, hrLow: 150, hrHigh: 158, cadenceLow: 85, cadenceHigh: 95, rpe: '6', rep: { n: 2, of: 2 } },
            { type: 'cooldown', seconds: 300, wattsLow: 0, wattsHigh: 130, hrHigh: 115 },
          ],
        },
      ],
    },
  ],
};
