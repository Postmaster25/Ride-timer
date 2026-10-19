# Ride Timer

A phone web app that shows the weekly training plan and runs the cycling intervals as a voice-guided timer. It's plain HTML, CSS and JavaScript with no build step and no backend, hosted on GitHub Pages from the root of `main`.

## Using it

1. Open the site in Safari on the iPhone and add it to the home screen (Share, then Add to Home Screen).
2. In **Settings**, set the plan start date and FTP, then import the plan JSON. You can paste it or pick a `.json` file.
3. The **Week** view opens on the current week. Tap a ride to see its steps and copy its Strava title and description. Tap **Start** to run the timer.

The plan, start date, FTP, voice setting and skip marks are stored only on the device. No training plan is committed to this repository.

## How it works

- **Voice:** cues are recorded clips played through Web Audio. The whole ride's cues are scheduled ahead of time on the audio clock, so they keep playing with the screen locked and the silent switch on. Phase 1 showed that built-in speech synthesis does not. Each cue is built from short phrases ("Rep 2 of 2.", "205 watts", "12 minutes"), so any FTP works. A phrase with no clip falls back to built-in speech.
- **Timing:** everything is computed from `Date.now()`. Timers only decide when to look at the clock.
- **Keep awake:** Screen Wake Lock API, with a hidden looping video as a fallback, plus a near-silent audio loop that keeps iOS treating the page as playing audio.
- **Offline:** `sw.js` caches the app and every clip. Bump `VERSION` in `sw.js` with every change; phones pick up the new version the next time the app opens, and never in the middle of a ride.
- **Test rides:** rides whose `workoutCode` is `T`, `B` or `M` (optionally followed by digits, such as `T30`) get the plain test countdown. `V30` gets the 30/15 "Go" and "Ease" cues.

## Files

- `index.html`, `style.css`, `js/app.js`: the screens.
- `js/plan.js`: plan validation, FTP scaling, calendar math and the Strava description.
- `js/cues.js`: the voice cue rules and the list of every phrase that needs a clip.
- `js/audio.js`: clip playback and screen wake.
- `clips/`: recorded phrases and `manifest.json`, spoken by the Piper "Ryan" voice (licensed CC BY-NC-SA 4.0, personal non-commercial use). Regenerate them with `node tools/make-clips.mjs`; the script's header says how to get the voice. Rerun it whenever you add a phrase to `vocabulary()` in `js/cues.js`.
- `test/run.mjs`: run `node test/run.mjs` to check the plan, description and cue rules against the spec's examples.

## Phase 1 results (Oct 18, 2026)

Tested on an iPhone with iOS 18.7, using earbuds.

- **Recorded clips:** all six checks passed, in Safari and from the home screen, including the locked screen, the silent switch and the pocket test. Screen wake also worked from the home screen.
- **Built-in speech:** failed with the silent switch on, even with the audio session set to playback.
