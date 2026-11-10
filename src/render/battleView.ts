import * as THREE from 'three';
import { FACTIONS_BY_ID, SHIP_CLASSES } from '../data';
import { getGlowTexture, glowSprite, instantiateShip } from './assets';
import type { BattleRecord, ShipId } from '../types';

const CLASS_ORDER: ShipId[] = ['dreadnought', 'cruiser', 'corvette', 'scout', 'ark'];
const VISUAL_LENGTH: Record<ShipId, number> = {
  dreadnought: 24,
  cruiser: 15,
  corvette: 9,
  scout: 6,
  ark: 13,
};

interface ShipVis {
  group: THREE.Group;
  base: THREE.Vector3;
  phase: number;
  side: 'a' | 'b';
  alive: boolean;
}

export class BattleView {
  active = false;
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private ships: ShipVis[] = [];
  private tracers: { line: THREE.Line; life: number; max: number }[] = [];
  private booms: { sprite: THREE.Sprite; life: number; max: number }[] = [];
  private battle: BattleRecord | null = null;
  private elapsed = 0;
  private roundIndex = 0;
  private resolved = false;
  private resolveFn: (() => void) | null = null;
  private loading = true;
  private shake = 0;
  private aHull = 1;
  private bHull = 1;
  private aHullStart = 1;
  private bHullStart = 1;
  private barA!: HTMLDivElement;
  private barB!: HTMLDivElement;
  private logEl!: HTMLDivElement;
  private resultEl!: HTMLDivElement;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'battle-overlay';
    this.root.innerHTML = `
      <div class="battle-frame">
        <header class="battle-head">
          <div class="eyebrow">Engagement · Automatische Gefechtsauflösung</div>
          <h2 class="battle-title">Schlacht</h2>
          <div class="battle-vs"></div>
        </header>
        <div class="battle-stage"></div>
        <div class="battle-hud">
          <div class="battle-side is-a">
            <div class="side-top"><span class="side-name"></span><span class="side-count"></span></div>
            <div class="hull-track"><div class="hull-fill"></div></div>
            <div class="side-meta"></div>
          </div>
          <div class="battle-side is-b">
            <div class="side-top"><span class="side-name"></span><span class="side-count"></span></div>
            <div class="hull-track"><div class="hull-fill"></div></div>
            <div class="side-meta"></div>
          </div>
        </div>
        <div class="battle-log"></div>
        <div class="battle-result" hidden></div>
      </div>`;
    host.appendChild(this.root);
    this.root.hidden = true;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'battle-canvas';
    (this.root.querySelector('.battle-frame') as HTMLElement).appendChild(this.canvas);
    this.barA = this.root.querySelector('.is-a .hull-fill') as HTMLDivElement;
    this.barB = this.root.querySelector('.is-b .hull-fill') as HTMLDivElement;
    this.logEl = this.root.querySelector('.battle-log') as HTMLDivElement;
    this.resultEl = this.root.querySelector('.battle-result') as HTMLDivElement;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 900);
    this.camera.position.set(0, 22, 104);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0x8fa6c0, 0.9));
    const key = new THREE.DirectionalLight(0xffe6c4, 2.4);
    key.position.set(-40, 50, 30);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x76a8ff, 2.0);
    rim.position.set(40, -20, -50);
    this.scene.add(rim);

    const stars = this.buildBackdrop();
    this.scene.add(stars);
  }

  private buildBackdrop(): THREE.Points {
    const count = 1600;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 300 + Math.random() * 300;
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(p) * Math.cos(t);
      pos[i * 3 + 1] = r * Math.cos(p);
      pos[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 2.2,
        color: 0xbfd4ee,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        map: getGlowTexture(),
      }),
    );
  }

  play(battle: BattleRecord): Promise<void> {
    this.active = true;
    this.battle = battle;
    this.elapsed = 0;
    this.roundIndex = 0;
    this.resolved = false;
    this.loading = true;
    this.shake = 0;
    this.root.hidden = false;
    this.resultEl.hidden = true;
    this.resultEl.innerHTML = '';
    this.logEl.innerHTML = '';

    for (const ship of this.ships) this.scene.remove(ship.group);
    this.ships = [];
    for (const t of this.tracers) this.scene.remove(t.line);
    this.tracers = [];
    for (const b of this.booms) this.scene.remove(b.sprite);
    this.booms = [];

    const a = FACTIONS_BY_ID[battle.attacker];
    const b = FACTIONS_BY_ID[battle.defender];
    (this.root.querySelector('.battle-title') as HTMLElement).textContent = `Schlacht um ${battle.systemName}`;
    (this.root.querySelector('.battle-vs') as HTMLElement).innerHTML =
      `<span class="flank" style="color:${a.css}">${a.name}</span><i>gegen</i><span class="flank" style="color:${b.css}">${b.name}</span>`;
    (this.root.querySelector('.is-a .side-name') as HTMLElement).textContent = a.short;
    (this.root.querySelector('.is-b .side-name') as HTMLElement).textContent = b.short;
    (this.root.querySelector('.is-b .side-name') as HTMLElement).style.color = b.css;
    (this.root.querySelector('.is-a .side-name') as HTMLElement).style.color = a.css;

    this.aHullStart = battle.rounds.length
      ? battle.rounds[0].aHull + battle.rounds[0].b
      : Math.max(1, this.hullOf(battle.aStart));
    this.bHullStart = battle.rounds.length
      ? battle.rounds[0].bHull + battle.rounds[0].a
      : Math.max(1, this.hullOf(battle.bStart));
    this.aHull = this.aHullStart;
    this.bHull = this.bHullStart;
    this.barA.style.width = '100%';
    this.barB.style.width = '100%';
    (this.root.querySelector('.is-a .side-meta') as HTMLElement).textContent = `${this.shipTotal(battle.aStart)} Schiffe im Verband`;
    (this.root.querySelector('.is-b .side-meta') as HTMLElement).textContent = `${this.shipTotal(battle.bStart)} Schiffe im Verband`;

    return new Promise((resolve) => {
      this.resolveFn = resolve;
      void this.buildFleets(battle, a.css, b.css);
    });
  }

  private hullOf(counts: Record<ShipId, number>): number {
    return CLASS_ORDER.reduce((s, c) => s + counts[c] * SHIP_CLASSES[c].hull, 0);
  }
  private shipTotal(counts: Record<ShipId, number>): number {
    return CLASS_ORDER.reduce((s, c) => s + counts[c], 0);
  }

  private async buildFleets(battle: BattleRecord, colorA: string, colorB: string): Promise<void> {
    const toHex = (css: string) => new THREE.Color(css).getHex();
    const plan: { side: 'a' | 'b'; cls: ShipId; color: number; counts: Record<ShipId, number> }[] = [];
    for (const side of ['a', 'b'] as const) {
      const counts = side === 'a' ? battle.aStart : battle.bStart;
      const present = CLASS_ORDER.filter((c) => counts[c] > 0).slice(0, 4);
      for (const cls of present) plan.push({ side, cls, color: toHex(side === 'a' ? colorA : colorB), counts });
    }

    const built = await Promise.all(
      plan.map(async (p) => ({
        ...p,
        group: await instantiateShip(SHIP_CLASSES[p.cls].model, p.color, VISUAL_LENGTH[p.cls]),
      })),
    );
    if (!this.active || this.battle !== battle) return;

    const perSide = { a: 0, b: 0 };
    const totals = { a: plan.filter((p) => p.side === 'a').length, b: plan.filter((p) => p.side === 'b').length };
    for (const item of built) {
      const idx = perSide[item.side]++;
      const spread = (idx - (totals[item.side] - 1) / 2) * 11;
      const base = new THREE.Vector3(
        item.side === 'a' ? -30 : 30,
        spread * 0.06,
        spread,
      );
      item.group.position.copy(base);
      item.group.rotation.y = item.side === 'a' ? -Math.PI / 2 : Math.PI / 2;
      this.scene.add(item.group);
      this.ships.push({
        group: item.group,
        base,
        phase: Math.random() * Math.PI * 2,
        side: item.side,
        alive: true,
      });
    }
    this.loading = false;
  }

  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0.26, max: 0.26 });
    const flash = glowSprite(color, 4.5, 0.9);
    flash.position.copy(from);
    this.scene.add(flash);
    this.booms.push({ sprite: flash, life: 0.16, max: 0.16 });
    this.shake = Math.min(0.8, this.shake + 0.16);
  }

  private explode(pos: THREE.Vector3, color: number): void {
    const sprite = glowSprite(color, 6, 1);
    sprite.position.copy(pos);
    this.scene.add(sprite);
    this.booms.push({ sprite, life: 0.85, max: 0.85 });
    this.shake = Math.min(1.4, this.shake + 0.5);
  }

  private updateHud(): void {
    const battle = this.battle;
    if (!battle) return;
    const aPct = Math.max(0, this.aHull / this.aHullStart);
    const bPct = Math.max(0, this.bHull / this.bHullStart);
    this.barA.style.width = `${(aPct * 100).toFixed(1)}%`;
    this.barB.style.width = `${(bPct * 100).toFixed(1)}%`;
    this.barA.classList.toggle('is-critical', aPct < 0.3);
    this.barB.classList.toggle('is-critical', bPct < 0.3);
    (this.root.querySelector('.is-a .side-count') as HTMLElement).textContent = `${Math.round(aPct * 100)} % Hülle`;
    (this.root.querySelector('.is-b .side-count') as HTMLElement).textContent = `${Math.round(bPct * 100)} % Hülle`;
  }

  private pushLog(text: string): void {
    const line = document.createElement('div');
    line.className = 'battle-log-line';
    line.textContent = text;
    this.logEl.prepend(line);
    while (this.logEl.children.length > 5) this.logEl.lastElementChild?.remove();
  }

  tick(dt: number): void {
    if (!this.active) return;
    this.elapsed += dt;
    this.shake = Math.max(0, this.shake - dt * 1.6);

    const battle = this.battle;
    if (!battle) return;

    if (!this.loading && !this.resolved) {
      while (this.roundIndex < battle.rounds.length && this.elapsed > 1.1 + this.roundIndex * 0.85) {
        const round = battle.rounds[this.roundIndex];
        this.aHull = round.aHull;
        this.bHull = round.bHull;
        this.updateHud();
        this.pushLog(
          `Salve ${this.roundIndex + 1} — Hüllenintegrität ${Math.round((round.aHull / this.aHullStart) * 100)} % / ${Math.round(
            (round.bHull / this.bHullStart) * 100,
          )} %`,
        );
        const alive = this.ships.filter((s) => s.alive);
        for (let i = 0; i < 7; i++) {
          const attackers = alive.filter((s) => s.side === 'a');
          const defenders = alive.filter((s) => s.side === 'b');
          if (!attackers.length || !defenders.length) break;
          const fromShip = attackers[Math.floor(Math.random() * attackers.length)];
          const toShip = defenders[Math.floor(Math.random() * defenders.length)];
          const from = fromShip.group.position.clone().add(new THREE.Vector3(4, 0, 0));
          const to = toShip.group.position.clone();
          this.spawnTracer(from, to, 0xffc27a);
          const back = defenders[Math.floor(Math.random() * defenders.length)];
          const backAttacker = attackers[Math.floor(Math.random() * attackers.length)];
          this.spawnTracer(
            back.group.position.clone().add(new THREE.Vector3(-4, 0, 0)),
            backAttacker.group.position.clone(),
            0x8fd6ff,
          );
        }
        if (this.roundIndex === battle.rounds.length - 1) {
          const loserSide = battle.winner === battle.attacker ? 'b' : 'a';
          for (const s of this.ships) {
            if (s.side === loserSide && Math.random() < 0.7) {
              this.explode(s.group.position.clone(), 0xff9c50);
              s.alive = false;
              s.group.visible = false;
            }
          }
        }
        this.roundIndex++;
      }

      if (this.roundIndex >= battle.rounds.length && !this.resolved && this.elapsed > 1.1 + battle.rounds.length * 0.85 + 1.2) {
        this.finish();
      }
    }

    const t = this.elapsed;
    for (const ship of this.ships) {
      if (!ship.alive) continue;
      const dir = ship.side === 'a' ? 1 : -1;
      ship.group.position.x = ship.base.x + Math.sin(t * 0.4 + ship.phase) * 1.6 + dir * Math.min(6, t * 0.5);
      ship.group.position.y = ship.base.y + Math.sin(t * 0.8 + ship.phase) * 0.6;
      ship.group.rotation.z = Math.sin(t * 0.5 + ship.phase) * 0.04;
    }

    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.life -= dt;
      (tr.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, tr.life / tr.max);
      if (tr.life <= 0) {
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        (tr.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i];
      b.life -= dt;
      const k = 1 - b.life / b.max;
      b.sprite.scale.setScalar(4 + k * 26);
      (b.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - k);
      if (b.life <= 0) {
        this.scene.remove(b.sprite);
        this.booms.splice(i, 1);
      }
    }

    this.camera.position.set(
      Math.sin(t * 0.12) * 16 + (Math.random() - 0.5) * this.shake * 2,
      22 + Math.sin(t * 0.2) * 3 + (Math.random() - 0.5) * this.shake * 2,
      104 + Math.cos(t * 0.1) * 8,
    );
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  private finish(): void {
    const battle = this.battle;
    if (!battle) return;
    this.resolved = true;
    for (const s of this.ships) if (!s.alive) s.group.visible = false;
    const a = FACTIONS_BY_ID[battle.attacker];
    const b = FACTIONS_BY_ID[battle.defender];
    const winnerId = battle.winner;
    const winner = winnerId ? FACTIONS_BY_ID[winnerId] : null;
    this.resultEl.hidden = false;
    this.resultEl.innerHTML = `
      <div class="result-head" style="--accent:${winner ? winner.css : '#9aa3ae'}">
        <span class="eyebrow">Gefechtsauswertung</span>
        <h3>${winner ? `${winner.name} hält das Feld` : 'Beide Verbände lösen sich auf'}</h3>
      </div>
      <div class="result-grid">
        <div><span>Verluste ${a.short}</span><b>${battle.destroyed[battle.attacker] ?? 0}</b></div>
        <div><span>Verluste ${b.short}</span><b>${battle.destroyed[battle.defender] ?? 0}</b></div>
        <div><span>Systemverteidigung</span><b>${battle.defense}</b></div>
        <div><span>Salven</span><b>${battle.rounds.length}</b></div>
      </div>
      <button class="btn btn-primary" data-act="battle-continue">Weiter zur Sternenkarte</button>`;
    const btn = this.resultEl.querySelector('button');
    btn?.addEventListener('click', () => this.close());
    this.pushLog(winner ? `${winner.short} siegt im Orbit von ${battle.systemName}.` : 'Kein Sieger.');
  }

  private close(): void {
    this.root.hidden = true;
    this.active = false;
    this.battle = null;
    const fn = this.resolveFn;
    this.resolveFn = null;
    fn?.();
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }
}
