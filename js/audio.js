// Voice and keep-awake. Phase 1 showed recorded clips on the Web Audio clock
// work on the iPhone with the screen locked and the silent switch on; built-in
// speech does not, so it is only a fallback for phrases with no clip.

export class Voice {
  ctx = null;
  buffers = new Map();
  manifest = null;
  sources = [];
  offset = null; // audio clock minus wall clock (s) when last scheduled
  loading = null;

  // Call from a tap: iOS only starts audio inside a user gesture.
  unlock() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* ignore */ }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx && AC) {
      this.ctx = new AC();
      // A near-silent tone keeps the audio graph running between cues.
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain).connect(this.ctx.destination);
      osc.start();
    }
    if (this.ctx) this.ctx.resume().catch(() => {});
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  }

  async loadManifest() {
    if (!this.manifest) this.manifest = await (await fetch('clips/manifest.json')).json();
    return this.manifest;
  }

  // Decodes the clips a list of cues needs.
  async prepare(cueLists) {
    await this.loadManifest();
    const needed = new Set();
    for (const segs of cueLists) for (const s of segs) if (this.manifest[s] && !this.buffers.has(s)) needed.add(s);
    if (!this.ctx) return;
    await Promise.all([...needed].map(async text => {
      const data = await (await fetch(`clips/${this.manifest[text]}`)).arrayBuffer();
      this.buffers.set(text, await new Promise((ok, fail) => this.ctx.decodeAudioData(data, ok, fail)));
    }));
  }

  hasClips(segments) {
    return !!this.ctx && segments.every(s => this.buffers.has(s));
  }

  // items: [{ at: wall-clock ms, segments, countdown }], in time order.
  // Newer cues cut older ones off, except that a countdown is never cut.
  // Returns the items that had no clips (the caller speaks them when due).
  schedule(items) {
    const missing = [];
    if (!this.ctx) return items;
    this.offset = this.ctx.currentTime - Date.now() / 1000;
    let prev = null;
    for (const item of items) {
      if (!this.hasClips(item.segments)) { missing.push(item); continue; }
      let t = Math.max(this.ctx.currentTime, item.at / 1000 + this.offset);
      if (prev && prev.end > t) {
        if (prev.countdown) t = prev.end;
        else prev.nodes.forEach(n => n.stop(t));
      }
      const nodes = [];
      let cursor = t;
      for (const seg of item.segments) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.buffers.get(seg);
        src.connect(this.ctx.destination);
        src.start(cursor);
        nodes.push(src);
        this.sources.push(src);
        cursor += src.buffer.duration;
      }
      prev = { end: cursor, countdown: item.countdown, nodes };
    }
    return missing;
  }

  // Seconds the audio clock has fallen behind the wall clock since scheduling
  // (iOS suspends it in some cases); the caller reschedules when this grows.
  drift() {
    if (!this.ctx || this.offset == null) return 0;
    return (Date.now() / 1000 + this.offset) - this.ctx.currentTime;
  }

  cancel() {
    for (const s of this.sources) { try { s.stop(); } catch { /* not started */ } }
    this.sources = [];
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  // Fallback for a phrase with no recorded clip.
  speak(segments) {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(segments.join(' '));
    u.lang = 'en-US';
    speechSynthesis.speak(u);
  }

  sayNow(segments) {
    if (this.hasClips(segments)) this.schedule([{ at: Date.now(), segments, countdown: false }]);
    else this.speak(segments);
  }
}

// Screen wake: Wake Lock API, or a hidden looping video where it is missing.
export class Wake {
  sentinel = null;
  wanted = false;
  constructor(video) { this.video = video; }
  async on() {
    this.wanted = true;
    if ('wakeLock' in navigator) {
      try {
        this.sentinel = await navigator.wakeLock.request('screen');
        this.sentinel.addEventListener('release', () => { this.sentinel = null; });
        return;
      } catch { /* fall through to the video */ }
    }
    this.video.play().catch(() => {});
  }
  // Wake locks drop when the page is hidden; take it again on return.
  refresh() {
    if (this.wanted && !this.sentinel && 'wakeLock' in navigator && document.visibilityState === 'visible') this.on();
  }
  off() {
    this.wanted = false;
    if (this.sentinel) this.sentinel.release().catch(() => {});
    this.sentinel = null;
    this.video.pause();
  }
}
