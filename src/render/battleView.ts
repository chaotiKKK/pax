import * as THREE from 'three';
import { FACTIONS_BY_ID, SHIP_CLASSES, SHIP_ORDER } from '../data';
import { getGlowTexture, glowSprite, instantiateShip, setupEnvironment } from './assets';
import type { BattleRecord, ShipId } from '../types';

const CLASS_ORDER: ShipId[] = SHIP_ORDER;

interface ShipVisualProfile {
  model: string;
  length: number;
  accessory: string;
  signature: string;
}

/**
 * Per-class signature glow — the hue that marks each of the thirteen hulls in
 * the cinematic (engine pods, spires, rings). Tinted toward the faction colour
 * at build time so line-ups stay readable, but the hue gap between classes
 * survives so a glance sorts the line-up without reading labels.
 */
const CLASS_ACCENT: Record<string, number> = {
  scout: 0x9fe8ff,
  corvette: 0x7dffb0,
  raider: 0xffb03a,
  frigate: 0x6fd3ff,
  destroyer: 0xff7a5c,
  cruiser: 0xffd27a,
  carrier: 0xc49aff,
  battleship: 0xff9de2,
  dreadnought: 0xff5c5c,
  titan: 0xffe45c,
  bulwark: 0x8affd8,
  lance: 0xa8ff5c,
  ark: 0x5ce8ff,
};

/** Which procedural signature accessory a class gets (falls back to the hull). */
function accessoryFor(id: ShipId, model: string): string {
  if (id in CLASS_ACCENT) return id;
  if (model in CLASS_ACCENT) return model;
  return 'cruiser';
}

/** Short label shown above each hull in the cinematic. */
function classLabel(id: ShipId): string {
  const name = SHIP_CLASSES[id]?.name ?? id;
  return name.split(' „')[0];
}

// Profiles are built dynamically from the live SHIP_CLASSES / SHIP_ORDER
// tables on every call — never snapshotted at import time — so ship classes
// registered later (player Custom designs via registerCustomShips()) are
// rendered in the cinematic too. The signature embeds the class id and the
// accessory key so that custom designs sharing a base GLB hull still get a
// unique visual identity in the cinematic and in `visualSignatures`.
function visualProfileFor(id: ShipId): ShipVisualProfile {
  const def = SHIP_CLASSES[id];
  const length = def?.battleLength ?? 8;
  const model = def?.model ?? 'cruiser';
  const accessory = accessoryFor(id, model);
  return { model, length, accessory, signature: [id, model, length, accessory].join('|') };
}

/**
 * Role-true procedural marker per class, built from THREE primitives only
 * (no new assets or dependencies). Every piece sits on the hull's centreline
 * (length = Z, beam = X, height = Y) so it reads from the battle camera
 * regardless of which way the underlying GLB faces.
 */
function buildClassAccessory(key: string, size: THREE.Vector3, accent: THREE.Color, faction: THREE.Color): THREE.Group {
  const glow = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 2.4,
    roughness: 0.35,
    metalness: 0.1,
  });
  const hull = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x3a4350).lerp(faction, 0.35),
    roughness: 0.5,
    metalness: 0.55,
  });
  const group = new THREE.Group();
  group.userData.classAccessory = true;
  const add = (mesh: THREE.Mesh, x: number, y: number, z: number): void => {
    mesh.position.set(x, y, z);
    group.add(mesh);
  };
  const w = Math.max(1.2, size.x);
  const h = Math.max(0.8, size.y);
  const l = Math.max(2, size.z);
  const top = h * 0.5;
  switch (key) {
    case 'scout': {
      // Sensor mast with a lit tip — the smallest hull gets the tallest eye.
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * h, 0.05 * h, h * 1.1, 6), hull);
      add(mast, 0, top + h * 0.55, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(h * 0.22, 10, 8), glow), 0, top + h * 1.15, 0);
      break;
    }
    case 'corvette': {
      // Twin engine pods at the stern.
      for (const s of [-1, 1]) {
        add(new THREE.Mesh(new THREE.SphereGeometry(h * 0.3, 10, 8), glow), s * w * 0.3, 0, -l * 0.42);
      }
      break;
    }
    case 'raider': {
      // Prow spike: a cone jutting past the bow.
      const spike = new THREE.Mesh(new THREE.ConeGeometry(h * 0.28, l * 0.4, 8), glow);
      spike.rotation.x = -Math.PI / 2;
      add(spike, 0, top * 0.4, l * 0.62);
      break;
    }
    case 'frigate': {
      // Shield arc: a half-ring standing across the midship.
      const arc = new THREE.Mesh(new THREE.TorusGeometry(w * 0.55, h * 0.09, 8, 24, Math.PI), glow);
      arc.rotation.y = Math.PI / 2;
      add(arc, 0, 0, 0);
      break;
    }
    case 'destroyer': {
      // Lance: a long barrel along the spine.
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.13, h * 0.13, l * 0.85, 8), hull);
      barrel.rotation.x = Math.PI / 2;
      add(barrel, 0, top + h * 0.12, 0);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(h * 0.16, l * 0.18, 8), glow);
      tip.rotation.x = Math.PI / 2;
      add(tip, 0, top + h * 0.12, l * 0.51);
      break;
    }
    case 'cruiser': {
      // Three turret blocks on the spine.
      for (const z of [-0.26, 0, 0.26]) {
        add(new THREE.Mesh(new THREE.BoxGeometry(w * 0.22, h * 0.38, l * 0.12), hull), 0, top + h * 0.16, z * l);
      }
      break;
    }
    case 'carrier': {
      // Flight deck slab plus wingtip pods.
      add(new THREE.Mesh(new THREE.BoxGeometry(w * 0.85, h * 0.2, l * 0.8), hull), 0, top + h * 0.12, 0);
      for (const s of [-1, 1]) {
        add(new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, h * 0.2, l * 0.3), glow), s * w * 0.52, top * 0.5, -l * 0.2);
      }
      break;
    }
    case 'battleship': {
      // Spinal gun: a heavy barrel with a muzzle bell.
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.2, h * 0.24, l * 0.7, 10), hull);
      barrel.rotation.x = Math.PI / 2;
      add(barrel, 0, top + h * 0.2, l * 0.05);
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(h * 0.3, h * 0.2, l * 0.12, 10), glow);
      muzzle.rotation.x = Math.PI / 2;
      add(muzzle, 0, top + h * 0.2, l * 0.44);
      break;
    }
    case 'dreadnought': {
      // Cathedral spire with a halo ring.
      const spire = new THREE.Mesh(new THREE.ConeGeometry(w * 0.16, h * 1.3, 6), hull);
      add(spire, 0, top + h * 0.65, -l * 0.1);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(w * 0.24, h * 0.06, 8, 24), glow);
      halo.rotation.x = Math.PI / 2;
      add(halo, 0, top + h * 0.9, -l * 0.1);
      break;
    }
    case 'titan': {
      // The halo: one great ring standing around the hull.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(w * 0.52, h * 0.08, 10, 40), glow);
      add(ring, 0, h * 0.1, 0);
      break;
    }
    case 'bulwark': {
      // Shield dome: a flattened cap over the hull.
      const dome = new THREE.Mesh(new THREE.SphereGeometry(w * 0.48, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), hull);
      dome.scale.y = 0.55;
      add(dome, 0, top * 0.7, 0);
      break;
    }
    case 'lance': {
      // Drop-pod row down the starboard flank.
      for (let i = 0; i < 4; i++) {
        add(new THREE.Mesh(new THREE.SphereGeometry(h * 0.2, 8, 6), glow), w * 0.42, top * 0.3, (-0.3 + i * 0.2) * l);
      }
      break;
    }
    case 'ark': {
      // Three habitat rings around the hull.
      for (const z of [-0.28, 0, 0.28]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(w * 0.44, h * 0.11, 8, 26), glow);
        add(ring, 0, 0, z * l);
      }
      break;
    }
    default: {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(w * 0.5, h * 0.1, 8, 26), glow);
      add(ring, 0, 0, 0);
    }
  }
  return group;
}

export interface BattleAudio {
  battleWeapon(kind: 'pulse' | 'kinetic' | 'missile', pan: number): void;
  battleImpact(kind: 'shield' | 'hull', pan: number): void;
  battleExplosion(size: 'small' | 'large', pan: number): void;
  battleResult(won: boolean): void;
  setBattleIntensity(level: number): void;
}

interface ShipVis {
  group: THREE.Group;
  base: THREE.Vector3;
  phase: number;
  side: 'a' | 'b';
  alive: boolean;
}

export class BattleView {
  active = false;

  get visualSignatures(): Record<ShipId, string> {
    return { ...this.signatures };
  }

  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private ships: ShipVis[] = [];
  private tracers: { line: THREE.Line; life: number; max: number }[] = [];
  private booms: { sprite: THREE.Sprite; life: number; max: number }[] = [];
  private battle: BattleRecord | null = null;
  private elapsed = 0;
  private lastTickAt = 0;
  private roundIndex = 0;
  private resolved = false;
  private resolveFn: (() => void) | null = null;
  private loading = true;
  private shake = 0;
  private cameraBase = new THREE.Vector3(0, 150, 330);
  private viewWidth = 150;
  private aHull = 1;
  private bHull = 1;
  private aHullStart = 1;
  private bHullStart = 1;
  private barA!: HTMLDivElement;
  private barB!: HTMLDivElement;
  private logEl!: HTMLDivElement;
  private resultEl!: HTMLDivElement;
  private registry!: HTMLDivElement;
  private signatures: Record<ShipId, string> = {};

  constructor(host: HTMLElement, private audio: BattleAudio | null = null) {
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
    this.registry = document.createElement('div');
    this.registry.className = 'battle-visual-registry';
    this.registry.hidden = true;
    this.root.appendChild(this.registry);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 3000);
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(0, 0, 0);

    setupEnvironment(this.renderer, this.scene);
    this.scene.environmentIntensity = 0.55;
    this.scene.add(new THREE.AmbientLight(0xa9bfd6, 0.68));
    const key = new THREE.DirectionalLight(0xffe6c4, 3.1);
    key.position.set(-120, 170, 160);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x76a8ff, 2.6);
    rim.position.set(140, -40, -180);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffd2a0, 1.15);
    fill.position.set(100, -80, 200);
    this.scene.add(fill);

    // A faint tactical plane makes the common keel line readable: every hull
    // is grounded on it, so scale and formation stay comparable.
    const grid = new THREE.GridHelper(450, 18, 0x3a5f86, 0x18283a);
    const gridMat = grid.material as THREE.LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = 0.14;
    gridMat.depthWrite = false;
    grid.position.y = -0.4;
    this.scene.add(grid);

    const stars = this.buildBackdrop();
    this.scene.add(stars);
    this.resize();
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
    this.audio?.setBattleIntensity(0.12);
    this.elapsed = 0;
    this.lastTickAt = 0;
    this.roundIndex = 0;
    this.resolved = false;
    this.loading = true;
    this.shake = 0;
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(0, 0, 0);
    this.root.hidden = false;
    this.resultEl.hidden = true;
    this.resultEl.innerHTML = '';
    this.logEl.innerHTML = '';
    this.registry.replaceChildren();
    this.signatures = {};
    delete this.root.dataset.shipClasses;
    delete this.root.dataset.shipGroups;
    delete this.root.dataset.shipSignatures;

    for (const ship of this.ships) {
      this.scene.remove(ship.group);
      // Only the procedural class-signature pieces are ours to free; the GLB
      // clones share cached source assets and are left as they were.
      ship.group.traverse((obj) => {
        if (!obj.userData.classAccessory) return;
        obj.traverse((inner) => {
          const mesh = inner as THREE.Mesh;
          if (mesh.isMesh) mesh.geometry?.dispose();
          const sprite = inner as THREE.Sprite;
          const material = sprite.material as THREE.Material | undefined;
          if (material) material.dispose();
        });
      });
    }
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
    (this.root.querySelector('.is-a .side-meta') as HTMLElement).textContent = `${this.shipTotal(battle.aStart)} Schiffe im Verband · ${this.classListLabel(battle.aStart)}`;
    (this.root.querySelector('.is-b .side-meta') as HTMLElement).textContent = `${this.shipTotal(battle.bStart)} Schiffe im Verband · ${this.classListLabel(battle.bStart)}`;

    return new Promise((resolve) => {
      this.resolveFn = resolve;
      void this.buildFleets(battle, a.css, b.css);
    });
  }

  /** Cached name-plate textures, one per class (shared across battles). */
  private static labelTextures = new Map<string, THREE.CanvasTexture>();

  private classLabelSprite(id: ShipId, factionCss: string): THREE.Sprite {
    const label = classLabel(id);
    let texture = BattleView.labelTextures.get(label);
    if (!texture) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 96;
      const ctx = canvas.getContext('2d')!;
      const font = '600 44px system-ui, sans-serif';
      ctx.font = font;
      const textW = Math.min(480, ctx.measureText(label).width);
      const x = (512 - textW) / 2;
      ctx.fillStyle = 'rgba(5, 8, 14, 0.72)';
      ctx.beginPath();
      ctx.roundRect(x - 18, 14, textW + 36, 68, 14);
      ctx.fill();
      ctx.fillStyle = factionCss;
      ctx.fillRect(x - 18, 14, 5, 68);
      ctx.fillStyle = '#f0e8d4';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 256, 50);
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      BattleView.labelTextures.set(label, texture);
    }
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    sprite.userData.classAccessory = true;
    return sprite;
  }

  private hullOf(counts: Record<ShipId, number>): number {
    return CLASS_ORDER.reduce((s, c) => s + ((counts as Record<string, number>)[c] ?? 0) * (SHIP_CLASSES[c]?.hull ?? 0), 0);
  }
  private shipTotal(counts: Record<ShipId, number>): number {
    return CLASS_ORDER.reduce((s, c) => s + ((counts as Record<string, number>)[c] ?? 0), 0);
  }

  /** Human-readable list of every ship class present on one side. */
  private classListLabel(counts: Record<ShipId, number>): string {
    const names = CLASS_ORDER
      .filter((c) => ((counts as Record<string, number>)[c] ?? 0) > 0)
      .map((c) => SHIP_CLASSES[c]?.name ?? c);
    return names.length ? names.join(', ') : 'keine Schiffe';
  }

  private async buildFleets(battle: BattleRecord, colorA: string, colorB: string): Promise<void> {
    const toHex = (css: string) => new THREE.Color(css).getHex();
    const plan: { side: 'a' | 'b'; cls: ShipId; color: number; counts: Record<ShipId, number> }[] = [];
    for (const side of ['a', 'b'] as const) {
      const counts = side === 'a' ? battle.aStart : battle.bStart;
      const present = CLASS_ORDER.filter((c) => ((counts as Record<string, number>)[c] ?? 0) > 0);
      for (const cls of present) plan.push({ side, cls, color: toHex(side === 'a' ? colorA : colorB), counts });
    }

    const built = await Promise.all(
      plan.map(async (p) => ({
        ...p,
        group: await instantiateShip(
          visualProfileFor(p.cls).model,
          p.color,
          visualProfileFor(p.cls).length,
          { groundAlign: true },
        ),
      })),
    );
    if (!this.active || this.battle !== battle) return;

    const positions = new Map<THREE.Group, THREE.Vector3>();
    let widest = 0;
    for (const side of ['a', 'b'] as const) {
      const items = built.filter((item) => item.side === side);
      const yaw = 0.4;
      const widths = items.map((item) => {
        const size = item.group.userData.size as THREE.Vector3 | undefined;
        return size
          ? Math.max(2.2, Math.abs(size.x * Math.cos(yaw)) + Math.abs(size.z * Math.sin(yaw)))
          : visualProfileFor(item.cls).length * 0.55;
      });
      const gap = 3.4;
      const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, items.length - 1);
      let cursor = -total / 2;
      const lineZ = side === 'a' ? -46 : 46;
      items.forEach((item, index) => {
        positions.set(item.group, new THREE.Vector3(cursor + widths[index] / 2, 0, lineZ));
        cursor += widths[index] + gap;
      });
      widest = Math.max(widest, total);
    }
    this.viewWidth = Math.max(150, widest * 1.18);
    this.resize();

    const rendered: { cls: ShipId; side: 'a' | 'b'; signature: string }[] = [];
    for (const item of built) {
      const base = positions.get(item.group);
      if (!base) continue;
      const profile = visualProfileFor(item.cls);
      // Per-class signature: role-true primitive marker + name plate, so the
      // thirteen hulls (and custom designs on shared GLBs) read as distinct
      // silhouettes in the line-up, not just as faction-tinted variants.
      const size = (item.group.userData.size as THREE.Vector3 | undefined) ?? new THREE.Vector3(4, 2, profile.length);
      const faction = new THREE.Color(item.side === 'a' ? colorA : colorB);
      const accent = new THREE.Color(CLASS_ACCENT[profile.accessory] ?? 0xffd27a).lerp(faction, 0.35);
      item.group.add(buildClassAccessory(profile.accessory, size, accent, faction));
      const label = this.classLabelSprite(item.cls, item.side === 'a' ? colorA : colorB);
      label.position.set(0, size.y * 0.5 + 4.2, 0);
      label.scale.set(12, 2.25, 1);
      item.group.add(label);
      item.group.position.copy(base);
      // Both lines face each other along Z, turned slightly toward the camera
      // so the hull profiles and superstructures stay readable.
      item.group.rotation.y = item.side === 'a' ? Math.PI + 0.4 : -0.4;
      this.scene.add(item.group);
      this.ships.push({
        group: item.group,
        base,
        phase: Math.random() * Math.PI * 2,
        side: item.side,
        alive: true,
      });
      rendered.push({ cls: item.cls, side: item.side, signature: profile.signature });
    }
    this.signatures = Object.fromEntries(
      rendered.map(({ cls, signature }) => [cls, signature]),
    ) as Record<ShipId, string>;
    this.registry.replaceChildren(
      ...rendered.map(({ cls, side, signature }) => {
        const marker = document.createElement('span');
        marker.dataset.shipClass = cls;
        marker.dataset.side = side;
        marker.dataset.shipSignature = signature;
        return marker;
      }),
    );
    this.root.dataset.shipClasses = [...new Set(rendered.map(({ cls }) => cls))].join(' ');
    this.root.dataset.shipGroups = String(this.ships.length);
    this.root.dataset.shipSignatures = [...new Set(rendered.map(({ signature }) => signature))].join(',');
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
    // The render loop caps dt to keep movement stable. A software-rendered
    // battle must not run in slow motion, so the cinematic clock also follows
    // wall time and catches up after a slow frame or a hidden window.
    const now = performance.now();
    const wallDt = this.lastTickAt ? (now - this.lastTickAt) / 1000 : dt;
    this.lastTickAt = now;
    this.elapsed += Math.max(dt, Math.min(1, wallDt));
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
        this.audio?.battleImpact(this.roundIndex % 2 === 0 ? 'shield' : 'hull', this.roundIndex % 2 === 0 ? -0.3 : 0.3);
        this.audio?.setBattleIntensity(Math.min(1, 0.2 + (this.roundIndex / Math.max(1, battle.rounds.length)) * 0.7));
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
          if (i % 2 === 0) this.audio?.battleWeapon(i % 3 === 0 ? 'kinetic' : 'pulse', -0.38);
          const back = defenders[Math.floor(Math.random() * defenders.length)];
          const backAttacker = attackers[Math.floor(Math.random() * attackers.length)];
          this.spawnTracer(
            back.group.position.clone().add(new THREE.Vector3(-4, 0, 0)),
            backAttacker.group.position.clone(),
            0x8fd6ff,
          );
          if (i % 2 === 1) this.audio?.battleWeapon('missile', 0.38);
        }
        if (this.roundIndex === battle.rounds.length - 1) {
          this.audio?.battleExplosion('large', 0);
          const loserSide = battle.winner === battle.attacker ? 'b' : 'a';
          for (const s of this.ships) {
            if (s.side === loserSide && Math.random() < 0.7) {
              this.audio?.battleExplosion('small', s.side === 'a' ? -0.42 : 0.42);
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
      ship.group.position.x = ship.base.x + Math.sin(t * 0.4 + ship.phase) * 0.8;
      ship.group.position.y = ship.base.y + Math.sin(t * 0.8 + ship.phase) * 0.28;
      ship.group.position.z = ship.base.z + Math.sin(t * 0.35 + ship.phase) * 0.6 + dir * Math.min(7, t * 0.6);
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
      this.cameraBase.x + Math.sin(t * 0.1) * 9 + (Math.random() - 0.5) * this.shake * 2,
      this.cameraBase.y + Math.sin(t * 0.2) * 4 + (Math.random() - 0.5) * this.shake * 2,
      this.cameraBase.z + Math.cos(t * 0.09) * 8,
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
    this.audio?.setBattleIntensity(1);
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
    const viewHeight = this.viewWidth / Math.max(0.1, w / Math.max(1, h));
    this.camera.left = -this.viewWidth / 2;
    this.camera.right = this.viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
  }
}
