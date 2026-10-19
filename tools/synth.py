"""Reads [[text, wav_path], ...] as JSON on stdin and writes each phrase with Piper.

Loads the voice once, so the whole vocabulary takes a few minutes.
Usage: python3 tools/synth.py path/to/en-us-ryan-high.onnx < jobs.json
"""
import json
import sys
import wave

from piper import PiperVoice, SynthesisConfig

voice = PiperVoice.load(sys.argv[1])
# length_scale > 1 speaks more slowly, to be clear when the rider is exhausted.
config = SynthesisConfig(length_scale=1.25)
jobs = json.load(sys.stdin)
for i, (text, path) in enumerate(jobs):
    with wave.open(path, "wb") as wf:
        # Fragments ("205 watts", "to") read better without a trailing stop;
        # one-word sentences ("Go.", "Five.") need theirs to sound natural.
        spoken = text if " " not in text.strip() and text.endswith(".") else text.rstrip(".:,")
        voice.synthesize_wav(spoken, wf, syn_config=config)
    if i % 100 == 0:
        print(f"{i}/{len(jobs)}", file=sys.stderr, flush=True)
