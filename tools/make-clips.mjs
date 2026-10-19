// Regenerates clips/*.mp3 and clips/manifest.json from the phrases in cues.js.
// Needs Piper (pip install piper-tts), the Ryan voice model and ffmpeg.
// Get the voice from
// https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-en-us-ryan-high.tar.gz
// and run from the repo root: PIPER_MODEL=path/to/en-us-ryan-high.onnx node tools/make-clips.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { allPhrases, clipName } from '../cues.js';

const model = process.env.PIPER_MODEL;
if (!model) throw new Error('Set PIPER_MODEL to the path of en-us-ryan-high.onnx');
const dir = 'clips';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
const manifest = {};
for (const text of allPhrases()) {
  const file = clipName(text);
  const wav = `${dir}/tmp.wav`;
  execFileSync('python3', ['-m', 'piper', '-m', model, '-f', wav], { input: text, stdio: ['pipe', 'ignore', 'inherit'] });
  // Trim leading and trailing silence, then encode small mono MP3.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav,
    '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse',
    '-ac', '1', '-ar', '22050', '-b:a', '48k', `${dir}/${file}`]);
  manifest[text] = file;
}
rmSync(`${dir}/tmp.wav`);
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1) + '\n');
console.log(`${Object.keys(manifest).length} clips`);
