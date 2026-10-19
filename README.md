# Ride Timer

Voice-guided interval timer for the indoor trainer. This is **Phase 1**: a single static page that tests spoken cues, keep-awake and timing on an iPhone before the full app is built.

## Using the prototype

1. Open the page in Safari on the iPhone (or save it to the home screen and open it from there).
2. Pick a workout, a voice and the two keep-awake options, then tap **Start**.
3. Mark each item in the checklist Pass or Fail, then tap **Copy results** and paste them back.

- **Workouts:** the 4-minute test (40 s warm-up, 2 × 1 min hard with 40 s recovery, 40 s cool-down), the exact step lengths from the spec (75 s), and a 30-minute run for checking timing drift.
- **Voices:** *Built-in speech* uses the browser's speech synthesis. *Recorded clips* plays pre-made MP3 clips through Web Audio, scheduled ahead on the audio clock so they can play even if the page's timers are frozen.
- **Silent background audio** loops a near-silent track to keep iOS treating the page as playing audio.
- **Keep screen awake** uses the Screen Wake Lock API, with a hidden looping video as a fallback.
- All timing is computed from `Date.now()`; timers only decide when to look at the clock.

The cue log shows how late each cue was. "sent, not heard" means the voice never started; "missed" means the page was asleep when the cue fell due.

## Files

- `index.html`, `app.js`: the page.
- `cues.js`: the test workouts and the cue rules.
- `clips/`: recorded cue clips and `manifest.json`. Regenerate with `node tools/make-clips.mjs` (needs `espeak-ng` and `ffmpeg`).
- `media/`: the keep-alive audio loop and the wake-lock fallback video.

## Hosting

GitHub Pages, deployed from the root of the `main` branch. There is no build step.

## Phase 1 results (Oct 18, 2026)

Tested on an iPhone with iOS 18.7 in Safari, not opened from the home screen, with earbuds.

- **Recorded clips:** all six checks passed, including the locked screen, the silent switch and the pocket test.
- **Built-in speech:** failed with the silent switch on, even with the audio session set to playback. In one run it also missed 6 cues.

- **Home screen:** opened from a home screen icon, recorded clips ran with no missed cues, and the screen wake worked.

Phase 2 will use recorded clips, so every phrase it speaks needs a clip. Numbers (watts, durations, reps) get clips of their own, and the app joins them together.
