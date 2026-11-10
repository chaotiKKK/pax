/** Small procedural audio engine — no external assets, everything synthesized. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private padGain: GainNode | null = null;
  private padNodes: OscillatorNode[] = [];
  enabled = true;

  ensure(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.5 : 0;
      this.master.connect(this.ctx.destination);
      this.startPad();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.15);
    }
    if (on) this.ensure();
  }

  private startPad(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.055;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.8;
    this.padGain.connect(filter);
    filter.connect(this.master);

    const freqs = [55, 82.5, 110.02, 164.8];
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = f > 100 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f > 140 ? 0.09 : 0.2;
      osc.connect(g);
      g.connect(this.padGain);
      osc.start();
      this.padNodes.push(osc);
    }
    // slow filter drift
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.035;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
  }

  blip(freq = 720, dur = 0.07, type: OscillatorType = 'sine', gain = 0.09): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.72, ctx.currentTime + dur);
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  confirm(): void {
    this.blip(520, 0.09, 'triangle', 0.08);
    setTimeout(() => this.blip(780, 0.12, 'triangle', 0.06), 70);
  }

  deny(): void {
    this.blip(180, 0.16, 'sawtooth', 0.05);
  }

  whoosh(): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const ctx = this.ctx;
    const len = 0.9;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(t, 1.7) * (1 - t * 0.2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(320, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(2400, ctx.currentTime + len);
    filter.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start();
  }

  boom(): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const ctx = this.ctx;
    const len = 0.7;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    const g = ctx.createGain();
    g.gain.value = 0.32;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start();
  }

  dispose(): void {
    for (const osc of this.padNodes) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    }
    this.padNodes = [];
    void this.ctx?.close();
    this.ctx = null;
  }
}
