"""Reads [[text, wav_path], ...] as JSON on stdin and writes each phrase with Piper.

Loads the voice once, so the whole vocabulary takes a few minutes.
Usage: python3 tools/synth.py path/to/en-us-ryan-high.onnx < jobs.json
"""
import json
import sys
import wave

from piper import PiperVoice

voice = PiperVoice.load(sys.argv[1])
jobs = json.load(sys.stdin)
for i, (text, path) in enumerate(jobs):
    with wave.open(path, "wb") as wf:
        voice.synthesize_wav(text.rstrip(".:,") if text not in ("Go.", "Ease.") else text, wf)
    if i % 100 == 0:
        print(f"{i}/{len(jobs)}", file=sys.stderr, flush=True)
