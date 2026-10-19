// Regenerates clips/*.mp3 and clips/manifest.json from the phrases in cues.js.
// Needs espeak-ng and ffmpeg. Run from the repo root: node tools/make-clips.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { allPhrases, clipName } from '../cues.js';

const dir = 'clips';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
const manifest = {};
for (const text of allPhrases()) {
  const file = clipName(text);
  const wav = `${dir}/tmp.wav`;
  execFileSync('espeak-ng', ['-v', 'en-us', '-s', '165', '-w', wav, text.replace(/\.$/, '')]);
  // Trim the leading silence espeak adds, then encode small mono MP3.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav,
    '-af', 'silenceremove=start_periods=1:start_threshold=-50dB',
    '-ac', '1', '-ar', '22050', '-b:a', '48k', `${dir}/${file}`]);
  manifest[text] = file;
}
rmSync(`${dir}/tmp.wav`);
writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1) + '\n');
console.log(`${Object.keys(manifest).length} clips`);
