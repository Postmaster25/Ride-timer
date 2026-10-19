// Records every phrase in js/cues.js vocabulary() to clips/*.mp3 and writes
// clips/manifest.json. Needs Piper (pip install piper-tts), ffmpeg and the
// "Ryan" voice from
// https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-en-us-ryan-high.tar.gz
// Run from the repo root: PIPER_MODEL=path/to/en-us-ryan-high.onnx node tools/make-clips.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vocabulary, clipName } from '../js/cues.js';

const model = process.env.PIPER_MODEL;
if (!model) throw new Error('Set PIPER_MODEL to the path of en-us-ryan-high.onnx');
const tmp = mkdtempSync(join(tmpdir(), 'clips-'));
const phrases = vocabulary();
// Countdown digits are spoken as words in full sentences ("Five."), which
// keeps them in the same voice and tone as the longer cues.
const WORDS = { '5.': 'Five.', '4.': 'Four.', '3.': 'Three.', '2.': 'Two.', '1.': 'One.' };
const jobs = phrases.map(text => [text, join(tmp, clipName(text).replace('.mp3', '.wav'))]);
const spoken = jobs.map(([text, wav]) => [WORDS[text] || text, wav]);
execFileSync('python3', ['tools/synth.py', model], { input: JSON.stringify(spoken), stdio: ['pipe', 'inherit', 'inherit'] });

const dir = 'clips';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
const manifest = {};
for (const [text, wav] of jobs) {
  const file = clipName(text);
  // Trim leading and trailing silence, then encode small mono MP3.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav,
    '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse',
    '-ac', '1', '-ar', '22050', '-b:a', '40k', `${dir}/${file}`]);
  manifest[text] = file;
}
rmSync(tmp, { recursive: true, force: true });
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1) + '\n');
console.log(`${phrases.length} clips`);
