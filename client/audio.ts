// Procedural audio: every sound is synthesized with WebAudio at runtime; announcer lines use
// the browser's built-in speech synthesis; music is an algorithmic, original sequencer.

type SoundKind =
  | "rifle"
  | "mg"
  | "cannon"
  | "rocket"
  | "artillery"
  | "beam"
  | "arc"
  | "flak"
  | "snipe"
  | "bite"
  | "explode"
  | "bigexplode"
  | "nuke"
  | "bolt"
  | "teleport"
  | "click"
  | "place"
  | "ready"
  | "ack"
  | "error"
  | "sell"
  | "build"
  | "alarm"
  | "promote"
  | "crush"
  | "sonic"
  | "harpoon"
  | "salvage"
  | "blackout";

export class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  noise!: AudioBuffer;
  last = new Map<string, number>();
  voices = 0;
  settings = { sfx: 0.7, music: 0.35, voice: true, musicOn: true };
  private musicTimer: number | null = null;
  private step = 0;
  private nextTime = 0;
  private song = 0;
  private lastEva = new Map<string, number>();

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem("it.audio") || "null");
      if (s) Object.assign(this.settings, s);
    } catch {}
  }

  saveSettings() {
    try {
      localStorage.setItem("it.audio", JSON.stringify(this.settings));
    } catch {}
    if (this.ctx) {
      this.sfx.gain.value = this.settings.sfx;
      this.music.gain.value = this.settings.musicOn ? this.settings.music : 0;
    }
  }

  /** must be called from a user gesture */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = this.settings.sfx;
    this.sfx.connect(this.master);
    this.music = this.ctx.createGain();
    this.music.gain.value = this.settings.musicOn ? this.settings.music : 0;
    this.music.connect(this.master);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  private env(g: GainNode, t: number, a: number, peak: number, dec: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  private noiseSrc(t: number, dur: number) {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.start(t, Math.random() * 1.5, dur + 0.05);
    return s;
  }

  /** play a positional sound. pan -1..1, vol 0..1 */
  play(kind: SoundKind, vol = 1, pan = 0) {
    const ctx = this.ctx;
    if (!ctx || vol <= 0.01) return;
    const now = ctx.currentTime;
    const minGap: Partial<Record<SoundKind, number>> = { mg: 0.05, rifle: 0.04, flak: 0.06, explode: 0.03, arc: 0.05 };
    const lt = this.last.get(kind) ?? 0;
    if (now - lt < (minGap[kind] ?? 0.02)) return;
    this.last.set(kind, now);
    if (this.voices > 28) return;
    this.voices++;
    const out = ctx.createGain();
    out.gain.value = vol;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(p).connect(this.sfx);
    const done = (dur: number) =>
      setTimeout(() => {
        this.voices--;
        out.disconnect();
      }, dur * 1000 + 100);
    const t = now;
    const osc = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number, a = 0.004) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = ctx.createGain();
      this.env(g, t, a, peak, dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + a + 0.05);
    };
    const nz = (type: BiquadFilterType, f0: number, f1: number, dur: number, peak: number, q = 1, a = 0.003) => {
      const s = this.noiseSrc(t, dur + a);
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      f.Q.value = q;
      const g = ctx.createGain();
      this.env(g, t, a, peak, dur);
      s.connect(f).connect(g).connect(out);
    };
    switch (kind) {
      case "rifle":
        nz("bandpass", 2400, 900, 0.09, 0.5, 1.2);
        osc("square", 220, 90, 0.04, 0.08);
        done(0.15);
        break;
      case "mg":
        nz("bandpass", 1800, 800, 0.05, 0.4, 1.4);
        done(0.1);
        break;
      case "snipe":
        nz("highpass", 3000, 1500, 0.05, 0.6, 0.7);
        nz("lowpass", 1200, 200, 0.5, 0.15, 0.5);
        done(0.6);
        break;
      case "cannon":
        osc("sine", 110, 38, 0.32, 0.9, 0.002);
        nz("lowpass", 1400, 200, 0.35, 0.7, 0.8);
        done(0.45);
        break;
      case "rocket":
        nz("bandpass", 500, 2200, 0.35, 0.45, 2);
        osc("sawtooth", 180, 60, 0.15, 0.06);
        done(0.45);
        break;
      case "artillery":
        nz("bandpass", 300, 1600, 0.8, 0.5, 2.5, 0.05);
        osc("sawtooth", 90, 40, 0.5, 0.1, 0.02);
        done(0.9);
        break;
      case "beam":
        osc("sawtooth", 1500, 280, 0.35, 0.25);
        osc("sine", 3000, 900, 0.3, 0.15);
        nz("highpass", 4000, 2000, 0.25, 0.12);
        done(0.45);
        break;
      case "arc": {
        const s = this.noiseSrc(t, 0.35);
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 2600;
        f.Q.value = 0.8;
        const g = ctx.createGain();
        const lfo = ctx.createOscillator();
        lfo.type = "square";
        lfo.frequency.value = 55;
        const lg = ctx.createGain();
        lg.gain.value = 0.35;
        lfo.connect(lg).connect(g.gain);
        this.env(g, t, 0.005, 0.5, 0.3);
        s.connect(f).connect(g).connect(out);
        lfo.start(t);
        lfo.stop(t + 0.4);
        osc("square", 90, 60, 0.3, 0.12);
        done(0.45);
        break;
      }
      case "flak":
        nz("lowpass", 1500, 300, 0.14, 0.55, 0.7);
        osc("sine", 160, 70, 0.1, 0.3);
        done(0.2);
        break;
      case "bite":
        nz("bandpass", 900, 400, 0.12, 0.4, 3);
        osc("sawtooth", 300, 180, 0.12, 0.12);
        done(0.2);
        break;
      case "explode":
        nz("lowpass", 1800, 120, 0.7, 0.9, 0.7, 0.004);
        osc("sine", 90, 30, 0.5, 0.7);
        done(0.8);
        break;
      case "bigexplode":
      case "crush":
        if (kind === "crush") {
          nz("lowpass", 600, 200, 0.12, 0.4, 1);
          done(0.2);
          break;
        }
        nz("lowpass", 1500, 60, 1.6, 1, 0.6, 0.01);
        osc("sine", 70, 22, 1.2, 0.9, 0.01);
        done(1.8);
        break;
      case "nuke":
        nz("lowpass", 2500, 40, 4.5, 1, 0.5, 0.02);
        osc("sine", 55, 18, 4, 1, 0.05);
        done(4.8);
        break;
      case "bolt":
        nz("highpass", 6000, 800, 0.15, 0.9, 0.6);
        nz("lowpass", 900, 50, 1.5, 0.8, 0.6, 0.05);
        done(1.7);
        break;
      case "teleport":
        osc("sine", 200, 2400, 0.5, 0.3, 0.02);
        osc("triangle", 300, 3600, 0.45, 0.15, 0.02);
        done(0.6);
        break;
      case "click":
        osc("square", 1400, 1100, 0.03, 0.12);
        done(0.08);
        break;
      case "place":
        osc("sine", 180, 70, 0.2, 0.5);
        nz("lowpass", 900, 200, 0.2, 0.3);
        done(0.3);
        break;
      case "build":
        osc("square", 520, 520, 0.05, 0.08);
        done(0.1);
        break;
      case "ready":
        osc("triangle", 660, 660, 0.12, 0.25);
        setTimeout(() => this.play("click", 0.6), 120);
        done(0.2);
        break;
      case "ack": {
        const f = 600 + Math.random() * 300;
        osc("square", f, f * 1.3, 0.07, 0.07);
        nz("bandpass", 2500, 2500, 0.08, 0.06, 3);
        done(0.12);
        break;
      }
      case "error":
        osc("square", 220, 160, 0.18, 0.15);
        done(0.25);
        break;
      case "sell":
        osc("triangle", 900, 1400, 0.15, 0.25);
        done(0.2);
        break;
      case "alarm":
        osc("square", 880, 660, 0.25, 0.12);
        setTimeout(() => this.play("click", 0.5), 260);
        done(0.3);
        break;
      case "promote":
        osc("triangle", 880, 1320, 0.25, 0.25);
        done(0.3);
        break;
      case "sonic": {
        // a warbling low pulse with a tremolo throb
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(140, t);
        o.frequency.exponentialRampToValueAtTime(60, t + 0.35);
        const g = ctx.createGain();
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 28;
        const lg = ctx.createGain();
        lg.gain.value = 0.4;
        lfo.connect(lg).connect(g.gain);
        this.env(g, t, 0.01, 0.7, 0.35);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.45);
        lfo.start(t);
        lfo.stop(t + 0.45);
        nz("bandpass", 700, 250, 0.3, 0.2, 2);
        done(0.5);
        break;
      }
      case "harpoon":
        osc("triangle", 420, 210, 0.22, 0.3);
        nz("bandpass", 1600, 600, 0.18, 0.3, 1.5);
        done(0.3);
        break;
      case "salvage":
        osc("triangle", 1320, 1320, 0.07, 0.18);
        setTimeout(() => this.play("sell", 0.35), 70);
        done(0.12);
        break;
      case "blackout":
        osc("sawtooth", 900, 40, 1.4, 0.35, 0.01);
        nz("lowpass", 3000, 80, 1.2, 0.5, 0.7);
        done(1.6);
        break;
    }
  }

  /** announcer line (browser speech synthesis) */
  eva(msg: string) {
    const now = performance.now();
    const lt = this.lastEva.get(msg) ?? -1e9;
    if (now - lt < 2500) return;
    this.lastEva.set(msg, now);
    if (!this.settings.voice || !("speechSynthesis" in window)) return;
    const ss = window.speechSynthesis;
    if (ss.pending || (ss.speaking && msg.length < 12)) ss.cancel();
    const u = new SpeechSynthesisUtterance(msg);
    u.rate = 1.08;
    u.pitch = 0.75;
    u.volume = Math.min(1, this.settings.sfx + 0.2);
    const vs = ss.getVoices();
    const v = vs.find((v) => /en[-_]GB/i.test(v.lang) && /female|serena|kate|martha|google uk/i.test(v.name)) ?? vs.find((v) => /^en/i.test(v.lang));
    if (v) u.voice = v;
    ss.speak(u);
  }

  // ───────────────────────────── music ─────────────────────────────

  startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.song = Math.floor(Math.random() * 1000);
    this.musicTimer = window.setInterval(() => this.schedule(), 50);
  }
  stopMusic() {
    if (this.musicTimer !== null) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  private schedule() {
    const ctx = this.ctx!;
    const bpm = 132;
    const sixteenth = 60 / bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.2) {
      this.musicStep(this.step, this.nextTime);
      this.nextTime += sixteenth;
      this.step++;
    }
  }

  private musicStep(step: number, t: number) {
    const ctx = this.ctx!;
    const bar = Math.floor(step / 16) % 16;
    const s = step % 16;
    const section = Math.floor(step / 128) % 4; // changes every 8 bars
    // minor-key progression (scale degrees in E minor), varied by song seed
    const roots = [40, 40, 36, 38, 40, 43, 36, 38];
    const root = roots[(bar + (this.song % 3)) % 8];
    const mtof = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
    const hit = (f0: number, f1: number, dur: number, vol: number, type: OscillatorType = "sine") => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.music);
      o.start(t);
      o.stop(t + dur + 0.02);
    };
    const noise = (freq: number, dur: number, vol: number, type: BiquadFilterType = "highpass") => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.music);
      src.start(t, Math.random(), dur + 0.02);
    };
    // drums
    if (s % 4 === 0) hit(150, 42, 0.28, 0.9);
    if (section > 0 && (s === 4 || s === 12)) {
      noise(1800, 0.16, 0.35, "bandpass");
      hit(220, 140, 0.08, 0.25, "triangle");
    }
    if (s % 2 === 1) noise(7000, 0.04, section === 0 ? 0.08 : 0.14);
    if (section === 3 && s === 14) hit(150, 42, 0.2, 0.6);
    // driving bass: 16th-note ostinato with octave jumps
    const bassPat = [0, 0, 12, 0, 0, 0, 10, 0, 0, 0, 12, 0, 7, 0, 10, 12];
    if (bassPat[s] !== undefined && (s % 2 === 0 || section > 1)) {
      const n = root - 12 + bassPat[s];
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = mtof(n);
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(900 + section * 300, t);
      f.frequency.exponentialRampToValueAtTime(200, t + 0.12);
      f.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(f).connect(g).connect(this.music);
      o.start(t);
      o.stop(t + 0.16);
    }
    // stabbing chords on off-beats in later sections
    if (section >= 2 && (s === 3 || s === 11)) {
      for (const iv of [0, 3, 7]) {
        const o = ctx.createOscillator();
        o.type = "square";
        o.frequency.value = mtof(root + 12 + iv);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.035, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g).connect(this.music);
        o.start(t);
        o.stop(t + 0.2);
      }
    }
    // lead motif
    if (section === 1 || section === 3) {
      const motif = [7, -1, 10, -1, 12, -1, 10, 7, -1, -1, 5, -1, 3, -1, 5, -1];
      const iv = motif[(s + (this.song % 4)) % 16];
      if (iv >= 0 && bar % 2 === 0) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = mtof(root + 24 + iv);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.connect(g).connect(this.music);
        o.start(t);
        o.stop(t + 0.27);
      }
    }
  }
}

export const FX_SOUND: Record<string, SoundKind> = {
  rifle: "rifle",
  mg: "mg",
  cannon: "cannon",
  rocket: "rocket",
  artillery: "artillery",
  beam: "beam",
  arc: "arc",
  flak: "flak",
  snipe: "snipe",
  bite: "bite",
  sonic: "sonic",
  harpoon: "harpoon",
  bomb: "click",
  charge: "click",
};
