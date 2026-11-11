import type { AudioManifest, FoundationId, MusicTrack, SfxDef } from './manifest';
import { foundationFor } from './manifest';

type Screen = 'title' | 'map' | 'battle' | 'victory' | 'defeat';

interface MusicGroup {
  key: string;
  screen: Screen;
  bpm: number;
  sources: AudioBufferSourceNode[];
  layers: Map<string, GainNode>;
  root: GainNode;
  startedAt: number;
}

interface SfxOptions {
  pan?: number;
  pitch?: number;
  gain?: number;
}

const PREFS_KEY = 'pax-aeterna-audio-v1';
const FADE = 1.6;
const MUSIC_GAIN = 0.62;
const SFX_GAIN = 0.86;
const UI_GAIN = 0.72;
const MAX_SFX = 10;

function db(value: number): number {
  return Math.pow(10, value / 20);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function readPrefs(): { enabled: boolean; music: number; sfx: number } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { enabled: true, music: 0.62, sfx: 0.78 };
    const p = JSON.parse(raw) as Partial<{ enabled: boolean; music: number; sfx: number }>;
    return {
      enabled: p.enabled !== false,
      music: clamp01(Number(p.music ?? 0.62)),
      sfx: clamp01(Number(p.sfx ?? 0.78)),
    };
  } catch {
    return { enabled: true, music: 0.62, sfx: 0.78 };
  }
}

export class AudioEngine {
  enabled: boolean;
  musicVolume: number;
  sfxVolume: number;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private uiBus: GainNode | null = null;
  private musicDuck: GainNode | null = null;
  private manifest: AudioManifest | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  private loadingKey: string | null = null;
  private lastMapTension = -1;
  private mapTension = 0;
  private requested: Screen = 'title';
  private requestedFaction: string | null = null;
  private requestedFoundation: FoundationId = 'civic';
  private group: MusicGroup | null = null;
  private musicToken = 0;
  private motifTimer: number | null = null;
  private duckTimer: number | null = null;
  private lastCue = new Map<string, number>();
  private activeSfx = 0;
  private fallback: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private warned = false;

  constructor() {
    const prefs = readPrefs();
    this.enabled = prefs.enabled;
    this.musicVolume = prefs.music;
    this.sfxVolume = prefs.sfx;
    this.bindUi();
  }

  // ------------------------------------------------------------------ graph

  ensure(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.buildGraph();
      void this.init();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private buildGraph(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 1 : 0;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 16;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = Math.pow(this.musicVolume, 1.35) * MUSIC_GAIN;
    this.musicDuck = ctx.createGain();
    this.musicDuck.gain.value = 1;
    this.musicBus.connect(this.musicDuck);
    this.musicDuck.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = Math.pow(this.sfxVolume, 1.35) * SFX_GAIN;
    this.sfxBus.connect(this.master);

    this.uiBus = ctx.createGain();
    this.uiBus.gain.value = Math.pow(this.sfxVolume, 1.35) * UI_GAIN;
    this.uiBus.connect(this.master);
  }

  private async init(): Promise<void> {
    try {
      const url = new URL('audio/manifest.json', document.baseURI).href;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`audio manifest HTTP ${res.status}`);
      this.manifest = (await res.json()) as AudioManifest;
      void this.preloadCore();
      await this.applyRequested();
    } catch (error) {
      if (!this.warned) {
        this.warned = true;
        console.warn('Pax Aeterna: Audioassets konnten nicht geladen werden.', error);
      }
      this.startFallback();
    }
  }

  private async preloadCore(): Promise<void> {
    const cues = ['ui_click', 'ui_confirm', 'ui_deny', 'sys_select', 'cycle_stamp'];
    await Promise.all(cues.map((cue) => this.loadCue(cue, 0)));
  }

  private startFallback(): void {
    if (!this.ctx || !this.musicBus || this.fallback) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.025;
    gain.connect(this.musicBus);
    const oscs: OscillatorNode[] = [];
    for (const f of [55, 82.5, 110]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(gain);
      o.start();
      oscs.push(o);
    }
    this.fallback = { osc: oscs, gain };
  }

  // --------------------------------------------------------------- settings

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.savePrefs();
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(on ? 1 : 0, now + 0.08);
    }
    if (on) this.ensure();
  }

  setMusicVolume(value: number): void {
    this.musicVolume = clamp01(value);
    this.savePrefs();
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(
        Math.pow(this.musicVolume, 1.35) * MUSIC_GAIN,
        this.ctx.currentTime,
        0.08,
      );
    }
  }

  setSfxVolume(value: number): void {
    this.sfxVolume = clamp01(value);
    this.savePrefs();
    if (this.sfxBus && this.uiBus && this.ctx) {
      const gain = Math.pow(this.sfxVolume, 1.35);
      this.sfxBus.gain.setTargetAtTime(gain * SFX_GAIN, this.ctx.currentTime, 0.08);
      this.uiBus.gain.setTargetAtTime(gain * UI_GAIN, this.ctx.currentTime, 0.08);
    }
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ enabled: this.enabled, music: this.musicVolume, sfx: this.sfxVolume }),
      );
    } catch {
      /* storage can be unavailable in private windows */
    }
  }

  // ------------------------------------------------------------------ music

  enterTitle(): void {
    this.requested = 'title';
    this.requestedFaction = null;
    // Autoplay-Policy: ohne AudioContext (vor erster Nutzerinteraktion)
    // wird nur vorgemerkt; ensure() im pointerdown-Handler startet dann.
    if (this.ctx && this.manifest) void this.applyRequested();
  }

  enterCampaign(faction: string): void {
    this.requested = 'map';
    this.requestedFaction = faction;
    this.requestedFoundation = foundationFor(faction);
    if (this.ctx && this.manifest) {
      void this.applyRequested();
      this.queueMotif(faction, 700);
    }
  }

  enterBattle(): void {
    this.requested = 'battle';
    if (this.ctx && this.manifest) {
      void this.applyRequested();
      this.play('battle_alarm');
    }
  }

  returnToMap(): void {
    if (!this.requestedFaction) return;
    this.requested = 'map';
    this.requestedFoundation = foundationFor(this.requestedFaction);
    if (this.ctx && this.manifest) void this.applyRequested();
  }

  victory(): void {
    this.requested = 'victory';
    if (this.ctx && this.manifest) void this.applyRequested();
  }

  defeat(): void {
    this.requested = 'defeat';
    if (this.ctx && this.manifest) void this.applyRequested();
  }

  previewFaction(faction: string): void {
    if (!this.enabled) return;
    this.ensure();
    this.queueMotif(faction, 80);
  }

  setMapTension(level: number): void {
    const next = clamp01(level);
    this.mapTension = next;
    if (Math.abs(next - this.lastMapTension) < 0.05) return;
    const group = this.group;
    if (!group || group.screen !== 'map') return;
    this.lastMapTension = next;
    const tension = group.layers.get('tension');
    const perc = group.layers.get('perc');
    if (tension) this.setLayer(tension, next * 0.72, 1.4);
    if (perc) this.setLayer(perc, 0.46 + next * 0.32, 1.4);
  }

  setBattleIntensity(level: number): void {
    const group = this.group;
    if (!group || group.screen !== 'battle') return;
    const assault = group.layers.get('assault');
    if (assault) this.setLayer(assault, clamp01(level) * 0.92, 0.9);
  }

  private queueMotif(faction: string, delay: number): void {
    if (this.motifTimer !== null) window.clearTimeout(this.motifTimer);
    this.motifTimer = window.setTimeout(() => {
      this.motifTimer = null;
      void this.playMotif(faction);
    }, delay);
  }

  private async playMotif(faction: string): Promise<void> {
    if (!this.ctx || !this.musicBus || !this.manifest || !this.enabled) return;
    const motif = this.manifest.motifs[faction];
    if (!motif) return;
    const buffer = await this.buffer(motif.file);
    if (!buffer || !this.ctx || !this.musicBus) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = db(motif.gainDb) * 0.9;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(this.musicBus);
    const now = this.ctx.currentTime + 0.03;
    source.start(now);
    source.stop(now + buffer.duration);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    // The motif is a one-shot calling card; it deliberately stays out of the
    // duck path so the faction identity remains audible over a fading title.
  }

  private async applyRequested(): Promise<void> {
    if (!this.ctx || !this.manifest) return;
    const screen = this.requested;
    let key: string;
    if (screen === 'map') key = this.requestedFoundation;
    else key = screen;
    if (this.group?.key === key && this.group.screen === screen) return;
    if (this.loadingKey === key) return;
    if (screen === 'map') key = this.requestedFoundation;
    const track = this.manifest.music[key];
    if (!track) return;
    this.loadingKey = key;
    try {
      await this.startGroup(key, screen, track);
    } finally {
      if (this.loadingKey === key) this.loadingKey = null;
    }
  }

  private async startGroup(key: string, screen: Screen, track: MusicTrack): Promise<void> {
    if (!this.ctx || !this.musicBus) return;
    const token = ++this.musicToken;
    const entries = track.stems
      ? Object.entries(track.stems)
      : track.file
        ? [['main', track.file] as [string, string]]
        : [];
    if (!entries.length) return;
    const loaded = await Promise.all(entries.map(async ([name, file]) => [name, await this.buffer(file)] as const));
    if (token !== this.musicToken || !this.ctx || !this.musicBus) return;
    const decoded = loaded.filter((entry): entry is readonly [string, AudioBuffer] => !!entry[1]);
    if (!decoded.length) return;

    const old = this.group;
    const now = this.ctx.currentTime + 0.04;
    const root = this.ctx.createGain();
    root.gain.setValueAtTime(0, now);
    root.gain.linearRampToValueAtTime(db(track.gainDb), now + FADE);
    root.connect(this.musicBus);

    const sources: AudioBufferSourceNode[] = [];
    const layers = new Map<string, GainNode>();
    for (const [name, buffer] of decoded) {
      const source = this.ctx.createBufferSource();
      const layer = this.ctx.createGain();
      source.buffer = buffer;
      source.loop = track.loop;
      source.connect(layer);
      layer.connect(root);
      // Das mitgelieferte MP3 (ambience) läuft auf Titel UND Karte mit
      // festem Pegel 0.35. Ein MusikGroup-Objekt ersetzt das vorige
      // (startGroup faded das alte aus) — Titel- und Ingame-Layer
      // spielen nie gleichzeitig voll.
      const defaults =
        name === 'ambience'
          ? 0.35
          : screen === 'map'
            ? name === 'base'
              ? 0.92
              : name === 'tension'
                ? 0.0
                : 0.5
            : screen === 'battle'
              ? name === 'base'
                ? 0.92
                : 0.0
              : 1.0;
      layer.gain.setValueAtTime(defaults, now);
      source.start(now);
      sources.push(source);
      layers.set(name, layer);
    }

    this.group = { key, screen, bpm: track.bpm, sources, layers, root, startedAt: now };
    if (screen === 'map') {
      this.lastMapTension = this.mapTension;
      const tension = layers.get('tension');
      const perc = layers.get('perc');
      if (tension) tension.gain.setValueAtTime(Math.max(0.0001, this.mapTension * 0.72), now);
      if (perc) perc.gain.setValueAtTime(0.46 + this.mapTension * 0.32, now);
    }
    if (old) this.fadeOutGroup(old, FADE + 0.1);
  }

  private fadeOutGroup(group: MusicGroup, duration: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    group.root.gain.cancelScheduledValues(now);
    group.root.gain.setValueAtTime(Math.max(0.0001, group.root.gain.value), now);
    group.root.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    for (const source of group.sources) {
      try {
        source.stop(now + duration + 0.05);
      } catch {
        /* already stopped */
      }
    }
  }

  private setLayer(layer: GainNode, value: number, seconds: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    layer.gain.cancelScheduledValues(now);
    layer.gain.setValueAtTime(Math.max(0.0001, layer.gain.value), now);
    layer.gain.linearRampToValueAtTime(Math.max(0.0001, value), now + seconds);
  }

  private duck(amount: number, holdMs: number): void {
    if (!this.ctx || !this.musicDuck) return;
    const now = this.ctx.currentTime;
    this.musicDuck.gain.cancelScheduledValues(now);
    this.musicDuck.gain.setValueAtTime(this.musicDuck.gain.value, now);
    this.musicDuck.gain.linearRampToValueAtTime(amount, now + 0.06);
    if (this.duckTimer !== null) window.clearTimeout(this.duckTimer);
    this.duckTimer = window.setTimeout(() => {
      this.duckTimer = null;
      if (!this.ctx || !this.musicDuck) return;
      this.musicDuck.gain.cancelScheduledValues(this.ctx.currentTime);
      this.musicDuck.gain.setValueAtTime(this.musicDuck.gain.value, this.ctx.currentTime);
      this.musicDuck.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 0.35);
    }, holdMs);
  }

  // -------------------------------------------------------------------- sfx

  play(cue: string, opts: SfxOptions = {}): void {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx || !this.manifest) return;
    const def = this.manifest.sfx[cue];
    if (!def) return;
    const nowMs = performance.now();
    if (nowMs - (this.lastCue.get(cue) ?? 0) < def.cooldownMs) return;
    if (this.activeSfx >= MAX_SFX) return;
    this.lastCue.set(cue, nowMs);
    const file = def.files[Math.floor(Math.random() * def.files.length)];
    if (!file) return;
    void this.playFile(cue, file, def, opts);
  }

  private async loadCue(cue: string, variant: number): Promise<AudioBuffer | null> {
    if (!this.manifest) return null;
    const def = this.manifest.sfx[cue];
    if (!def) return null;
    return this.buffer(def.files[variant % def.files.length]);
  }

  private async playFile(cue: string, file: string, def: SfxDef, opts: SfxOptions): Promise<void> {
    const buffer = await this.buffer(file);
    if (!buffer || !this.ctx || !this.enabled) return;
    const bus = def.bus === 'ui' ? this.uiBus : this.sfxBus;
    if (!bus) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.playbackRate.value = opts.pitch ?? 0.94 + Math.random() * 0.12;
    gain.gain.value = db(def.gainDb) * (opts.gain ?? 1);
    let tail: AudioNode = gain;
    source.connect(gain);
    if (opts.pan !== undefined && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      gain.connect(panner);
      tail = panner;
    }
    tail.connect(bus);
    this.activeSfx++;
    source.onended = () => {
      this.activeSfx = Math.max(0, this.activeSfx - 1);
      source.disconnect();
      gain.disconnect();
      if (tail !== gain) tail.disconnect();
    };
    const now = this.ctx.currentTime + 0.005;
    source.start(now);
    this.lastCue.set(cue, performance.now());
  }

  private async buffer(file: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const hit = this.buffers.get(file);
    if (hit) return hit;
    const pending = this.pending.get(file);
    if (pending) return pending;
    const promise = (async () => {
      try {
        const url = new URL(`audio/${file}`, document.baseURI).href;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        const decoded = await this.ctx!.decodeAudioData(bytes);
        this.buffers.set(file, decoded);
        return decoded;
      } catch (error) {
        if (!this.warned) {
          this.warned = true;
          console.warn(`Pax Aeterna: Audiobuffer ${file} fehlt.`, error);
        }
        return null;
      } finally {
        this.pending.delete(file);
      }
    })();
    this.pending.set(file, promise);
    return promise;
  }

  // --------------------------------------------------------------- game cues

  uiClick(): void {
    this.play('ui_click', { gain: 0.72 });
  }

  cycleSweep(): void {
    this.play('cycle_sweep');
    this.duck(0.45, 500);
  }

  cycleStamp(): void {
    this.play('cycle_stamp');
    this.duck(0.38, 500);
  }

  commandCue(kind: string, ok: boolean): void {
    if (!ok) {
      this.play('ui_deny');
      return;
    }
    if (kind === 'building') this.play('build_queue');
    else if (kind === 'ship') this.play('ship_queue');
    else if (kind === 'research') this.play('research_start');
    else if (kind === 'colonize') this.play('colonize');
    else if (kind === 'move') this.play('move_order');
    else if (kind === 'diplo') this.play('ui_confirm');
    else this.play('ui_confirm');
  }

  diploCue(action: string, ok: boolean): void {
    if (!ok) {
      this.play('diplo_reject');
      return;
    }
    if (action === 'gift') this.play('diplo_gift');
    else if (action === 'pact') this.play('diplo_pact');
    else if (action === 'alliance') this.play('diplo_alliance');
    else if (action === 'war') this.play('diplo_war');
    else if (action === 'peace') this.play('diplo_peace');
    else this.play('ui_confirm');
  }

  battleWeapon(kind: 'pulse' | 'kinetic' | 'missile', pan: number): void {
    this.play(`weapon_${kind}`, { pan });
  }

  battleImpact(kind: 'shield' | 'hull', pan: number): void {
    this.play(`impact_${kind}`, { pan });
  }

  battleExplosion(size: 'small' | 'large', pan: number): void {
    this.play(`explosion_${size}`, { pan });
    if (size === 'large') this.duck(0.38, 650);
  }

  battleResult(won: boolean): void {
    if (won) this.play('ui_confirm');
    else this.play('battle_retreat');
  }

  private bindUi(): void {
    document.addEventListener(
      'pointerdown',
      (ev) => {
        const target = (ev.target as HTMLElement).closest(
          'button, [data-act], [data-l], input[type="color"]',
        ) as HTMLElement | null;
        if (!target) return;
        const identityCue = this.identityCue(target);
        if (identityCue) {
          this.play(identityCue, { pan: this.panForEvent(ev, target) });
          return;
        }
        this.uiClick();
        if (target.dataset.act === 'faction' && target.dataset.faction) {
          this.previewFaction(target.dataset.faction);
        }
      },
      { capture: true },
    );
  }

  /** Identity controls get their own cues instead of the generic UI click. */
  private identityCue(target: HTMLElement): string | null {
    const kind = target.dataset.ie;
    if (kind === 'swatch' || kind === 'color') return 'swatch';
    if (kind === 'crest') return 'crest';
    if (target.dataset.act === 'start') return 'apply';
    if (target.dataset.act === 'close-overlay' && target.closest('[data-overlay="identity"]')) {
      return 'apply';
    }
    return null;
  }

  private panForEvent(ev: PointerEvent, target: HTMLElement): number {
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    return Math.max(-0.7, Math.min(0.7, x * 0.7));
  }

  dispose(): void {
    if (this.motifTimer !== null) window.clearTimeout(this.motifTimer);
    if (this.duckTimer !== null) window.clearTimeout(this.duckTimer);
    this.musicToken++;
    if (this.group) {
      for (const source of this.group.sources) {
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
      }
      this.group = null;
    }
    for (const osc of this.fallback?.osc ?? []) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    }
    this.fallback = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}
