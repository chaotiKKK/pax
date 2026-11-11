import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FACTIONS_BY_ID, FACTION_IDS } from '../data';
import { getGlowTexture, glowSprite } from './assets';
import type { FactionId, Game } from '../types';

export interface PickResult {
  type: 'system' | 'fleet';
  id: number;
}

const NOISE = `
float hash13(vec3 p){
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
                mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}
float fbm(vec3 p){
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
`;

const LANE_VERT = `
attribute vec3 aColor;
attribute float aDist;
attribute float aSeed;
attribute float aAlpha;
varying vec3 vColor;
varying float vDist;
varying float vSeed;
varying float vAlpha;
void main(){
  vColor = aColor; vDist = aDist; vSeed = aSeed; vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LANE_FRAG = `
uniform float uTime;
varying vec3 vColor;
varying float vDist;
varying float vSeed;
varying float vAlpha;
void main(){
  float pulse = fract(vDist * 0.028 - uTime * 0.10 + vSeed);
  float glow = smoothstep(0.82, 1.0, pulse);
  vec3 col = vColor + glow * vec3(1.0, 0.82, 0.5) * 0.9;
  float alpha = vAlpha * (0.30 + glow * 0.85);
  gl_FragColor = vec4(col, alpha);
}
`;

export class GalaxyView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private world = new THREE.Group();
  private starfield: THREE.Points | null = null;
  private laneUniforms = { uTime: { value: 0 } };
  private laneMesh: THREE.LineSegments | null = null;
  private nodes = new Map<
    number,
    { group: THREE.Group; ring: THREE.Mesh | null; label: HTMLDivElement; pos: THREE.Vector3 }
  >();
  private fleetNodes = new Map<number, { group: THREE.Group; pos: THREE.Vector3; target: THREE.Vector3 }>();
  private labelCache = new Map<number, { x: number; y: number; visible: boolean }>();
  private labelTimer = 0;
  private pickables: THREE.Object3D[] = [];
  private labels: HTMLDivElement;
  private reticle: HTMLDivElement;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private time = 0;
  private game: Game | null = null;
  private targetSel: number | null = null;

  // camera orbit
  private theta = 0.85;
  private phi = 0.86;
  private dist = 300;
  private thetaT = 0.85;
  private phiT = 0.86;
  private distT = 300;
  private dragging = false;
  private moved = 0;
  private lastX = 0;
  private lastY = 0;
  private downAt = 0;
  private downX = 0;
  private downY = 0;
  private downPointer = 'mouse';
  private idleSpin = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchStartDist = 0;
  private pinchStartZoom = 300;
  private tapCandidate = false;
  private downHit: PickResult | null = null;

  onPick: ((r: PickResult | null) => void) | null = null;
  onHover: ((r: PickResult | null) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, labelHost: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.5, 3000);
    this.placeCamera();
    this.scene.add(this.world);
    this.scene.add(this.buildNebula());
    this.starfield = this.buildStarfield(7000);
    this.scene.add(this.starfield);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.55, 0.62));
    this.composer.addPass(new OutputPass());

    this.labels = document.createElement('div');
    this.labels.className = 'map-labels';
    labelHost.appendChild(this.labels);

    this.reticle = document.createElement('div');
    this.reticle.className = 'reticle';
    this.reticle.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="44" fill="none" stroke="currentColor" stroke-width="0.7" stroke-dasharray="3 7"/>
      <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" stroke-width="0.4" opacity="0.5"/>
      <path d="M60 6v10M60 104v10M6 60h10M104 60h10" stroke="currentColor" stroke-width="0.8"/>
      <path d="M60 44l4 12 12 4-12 4-4 12-4-12-12-4 12-4z" fill="currentColor" opacity="0.85"/>
    </svg>`;
    labelHost.appendChild(this.reticle);

    canvas.addEventListener('pointerdown', this.handleDown);
    canvas.addEventListener('pointermove', this.handleMove);
    window.addEventListener('pointerup', this.handleUp);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('pointercancel', this.handleCancel);
    canvas.addEventListener('pointerleave', () => this.labels.classList.remove('hovering'));
  }

  private buildNebula(): THREE.Mesh {
    const geo = new THREE.SphereGeometry(1400, 48, 32);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vDir;
        ${NOISE}
        void main(){
          vec3 d = normalize(vDir);
          float n = fbm(d * 2.3 + 3.0);
          float n2 = fbm(d * 5.2 + 21.0);
          float band = pow(abs(sin(d.y * 2.4 + n * 3.2)), 3.0);
          vec3 col = vec3(0.006, 0.009, 0.017);
          col += vec3(0.030, 0.070, 0.135) * pow(n, 2.0) * 1.5;
          col += vec3(0.115, 0.050, 0.022) * pow(n2, 3.0) * band * 1.35;
          col += vec3(0.015, 0.075, 0.080) * pow(fbm(d * 1.2 + 7.0), 2.0) * 0.9;
          col *= 0.9 + 0.25 * sin(uTime * 0.03);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    return new THREE.Mesh(geo, mat);
  }

  /**
   * Graphics-quality switch (Settings): starfield density + render
   * resolution. Rebuilds the points cloud; the rest of the scene is kept.
   */
  setQuality(quality: 'hoch' | 'mittel' | 'niedrig'): void {
    const counts = { hoch: 7000, mittel: 3500, niedrig: 1500 } as const;
    const ratios = { hoch: Math.min(window.devicePixelRatio, 1.75), mittel: Math.min(window.devicePixelRatio, 1.25), niedrig: 1 } as const;
    if (this.starfield) {
      this.scene.remove(this.starfield);
      this.starfield.geometry.dispose();
      (this.starfield.material as THREE.Material).dispose();
    }
    this.starfield = this.buildStarfield(counts[quality]);
    this.scene.add(this.starfield);
    this.renderer.setPixelRatio(ratios[quality]);
  }

  private buildStarfield(count = 7000): THREE.Points {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 500 + Math.random() * 800;
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(p) * Math.cos(t);
      positions[i * 3 + 1] = r * Math.cos(p);
      positions[i * 3 + 2] = r * Math.sin(p) * Math.sin(t);
      const warm = Math.random();
      colors[i * 3] = 0.65 + warm * 0.35;
      colors[i * 3 + 1] = 0.72 + warm * 0.22;
      colors[i * 3 + 2] = 0.85 + Math.random() * 0.15;
      sizes[i] = 0.6 + Math.random() * 1.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.PointsMaterial({
      size: 1.5,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      map: getGlowTexture(),
    });
    return new THREE.Points(geo, mat);
  }

  setGame(game: Game): void {
    this.game = game;
    this.build();
  }

  private clearWorld(): void {
    for (const [, node] of this.nodes) {
      node.label.remove();
      node.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    this.nodes.clear();
    this.labelCache.clear();
    this.fleetNodes.clear();
    this.pickables = [];
    this.world.clear();
    this.laneMesh = null;
  }

  private build(): void {
    if (!this.game) return;
    const game = this.game;
    this.clearWorld();

    for (const sys of game.systems) {
      const group = new THREE.Group();
      group.position.set(sys.pos.x, sys.pos.y, sys.pos.z);

      const explored = sys.explored[game.player];
      const glow = glowSprite(sys.starColor, sys.starRadius * 8, explored ? 1 : 0.25);
      group.add(glow);

      const core = new THREE.Mesh(
        new THREE.SphereGeometry(sys.starRadius * 0.7, 20, 16),
        new THREE.MeshBasicMaterial({ color: sys.starColor }),
      );
      group.add(core);

      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(6.4, 12, 10),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hit.userData = { kind: 'system', id: sys.id };
      group.add(hit);
      this.pickables.push(hit);

      this.world.add(group);

      const label = document.createElement('div');
      label.className = 'map-label' + (explored ? '' : ' is-unknown');
      label.dataset.system = String(sys.id);
      this.labels.appendChild(label);

      this.nodes.set(sys.id, { group, ring: null, label, pos: new THREE.Vector3(sys.pos.x, sys.pos.y, sys.pos.z) });
    }

    this.refresh();
    this.labelCache.clear();
    this.placeCamera();
    this.updateLabels();
  }

  /** Recolour rings, lanes, fleet markers and labels from current game state. */
  refresh(): void {
    if (!this.game) return;
    const game = this.game;

    for (const sys of game.systems) {
      const node = this.nodes.get(sys.id);
      if (!node) continue;
      const explored = sys.explored[game.player];
      const faction = sys.owner ? FACTIONS_BY_ID[sys.owner] : null;

      node.label.className =
        'map-label' + (faction ? ` own-${faction.id}` : '') + (explored ? '' : ' is-unknown');
      node.label.dataset.system = String(sys.id);
      if (!explored) {
        node.label.innerHTML = `<b>· · ·</b>`;
      } else {
        node.label.innerHTML = `<b>${sys.name}</b><span>${faction ? faction.short : 'unbeansprucht'}</span>`;
      }

      if (node.ring) {
        node.group.remove(node.ring);
        node.ring.geometry.dispose();
        node.ring = null;
      }
      if (explored && faction) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(6.4, 7.2, 48),
          new THREE.MeshBasicMaterial({
            color: faction.color,
            transparent: true,
            opacity: 0.55,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        node.group.add(ring);
        node.ring = ring;
      }
    }

    this.buildLanes();
    this.syncFleets();

    if (this.targetSel !== null) this.setSelection(this.targetSel);
  }

  private buildLanes(): void {
    if (!this.game) return;
    const game = this.game;
    if (this.laneMesh) {
      this.world.remove(this.laneMesh);
      this.laneMesh.geometry.dispose();
      this.laneMesh = null;
    }
    const positions: number[] = [];
    const colors: number[] = [];
    const dists: number[] = [];
    const seeds: number[] = [];
    const alphas: number[] = [];

    for (const sys of game.systems) {
      for (const linkId of sys.links) {
        if (linkId < sys.id) continue;
        const other = game.systems[linkId];
        const known = sys.explored[game.player] && other.explored[game.player];
        const ownerA = sys.owner;
        const ownerB = other.owner;
        let color = new THREE.Color(0x4b6f8a);
        if (known) {
          if (ownerA && ownerA === ownerB) color = new THREE.Color(FACTIONS_BY_ID[ownerA].color).multiplyScalar(0.7);
          else if (ownerA || ownerB) color = new THREE.Color(0x7d8a99);
          else color = new THREE.Color(0x3d5a72);
        }
        const len = Math.hypot(sys.pos.x - other.pos.x, sys.pos.y - other.pos.y, sys.pos.z - other.pos.z);
        const alpha = known ? 0.85 : 0.16;
        positions.push(sys.pos.x, sys.pos.y, sys.pos.z, other.pos.x, other.pos.y, other.pos.z);
        for (let k = 0; k < 2; k++) {
          colors.push(color.r, color.g, color.b);
          alphas.push(alpha);
        }
        dists.push(0, len);
        seeds.push(Math.random(), Math.random());
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('aDist', new THREE.Float32BufferAttribute(dists, 1));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
    geo.setAttribute('aAlpha', new THREE.Float32BufferAttribute(alphas, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: this.laneUniforms,
      vertexShader: LANE_VERT,
      fragmentShader: LANE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.laneMesh = new THREE.LineSegments(geo, mat);
    this.world.add(this.laneMesh);
  }

  private syncFleets(): void {
    if (!this.game) return;
    const game = this.game;
    const seen = new Set<number>();
    for (const fleet of game.fleets) {
      seen.add(fleet.id);
      const sys = game.systems[fleet.system];
      const target = new THREE.Vector3(
        sys.pos.x + Math.sin(fleet.id * 2.1) * 3.6,
        sys.pos.y + 5.4 + Math.cos(fleet.id * 1.7) * 1.2,
        sys.pos.z + Math.cos(fleet.id * 2.1) * 3.6,
      );
      let node = this.fleetNodes.get(fleet.id);
      if (!node) {
        const color = FACTIONS_BY_ID[fleet.owner].color;
        const group = new THREE.Group();
        const marker = new THREE.Mesh(
          new THREE.ConeGeometry(1.15, 3.4, 3),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
        );
        marker.rotation.x = -Math.PI / 2;
        group.add(marker);
        const halo = glowSprite(color, 7, 0.45);
        group.add(halo);
        const hit = new THREE.Mesh(
          new THREE.SphereGeometry(3.4, 10, 8),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
        );
        hit.userData = { kind: 'fleet', id: fleet.id };
        group.add(hit);
        this.pickables.push(hit);
        group.position.copy(target);
        this.world.add(group);
        node = { group, pos: target.clone(), target };
        this.fleetNodes.set(fleet.id, node);
      }
      node.target = target;
    }
    for (const [id, node] of this.fleetNodes) {
      if (seen.has(id)) continue;
      this.world.remove(node.group);
      this.fleetNodes.delete(id);
    }
    this.pickables = this.pickables.filter((p) => {
      const data = p.userData as { kind?: string; id?: number };
      if (data.kind === 'fleet') return this.fleetNodes.has(data.id as number);
      return true;
    });
  }

  refreshFleetColors(): void {
    if (!this.game) return;
    for (const fleet of this.game.fleets) {
      const node = this.fleetNodes.get(fleet.id);
      if (!node) continue;
      const color = FACTIONS_BY_ID[fleet.owner].color;
      const marker = node.group.children[0] as THREE.Mesh | undefined;
      if (marker && marker.material instanceof THREE.MeshBasicMaterial) marker.material.color.setHex(color);
      const halo = node.group.children[1] as THREE.Sprite | undefined;
      if (halo && halo.material instanceof THREE.SpriteMaterial) halo.material.color.setHex(color);
    }
  }

  /** Current camera distance target (70 = closest, 520 = farthest). */
  get zoomDistance(): number {
    return this.distT;
  }

  get viewAngles(): { theta: number; phi: number } {
    return { theta: this.thetaT, phi: this.phiT };
  }

  /** Client-space centre of a system, used by touch diagnostics. */
  screenPosition(systemId: number): { x: number; y: number } | null {
    const node = this.nodes.get(systemId);
    if (!node) return null;
    const v = node.pos.clone().project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
  }

  setSelection(systemId: number | null): void {
    this.targetSel = systemId;
    for (const [id, node] of this.nodes) {
      node.label.classList.toggle('is-selected', id === systemId);
    }
  }

  focus(systemId: number): void {
    if (!this.game) return;
    const sys = this.game.systems[systemId];
    this.distT = Math.min(this.distT, 220);
    void sys;
  }

  setTargetMode(on: boolean): void {
    this.reticle.classList.toggle('is-target', on);
  }

  private handleDown = (ev: PointerEvent): void => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try {
      this.renderer.domElement.setPointerCapture(ev.pointerId);
    } catch {
      /* synthetic or already-released pointers */
    }
    if (this.pointers.size === 1) {
      this.dragging = true;
      this.moved = 0;
      this.tapCandidate = true;
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
      this.downX = ev.clientX;
      this.downY = ev.clientY;
      this.downPointer = ev.pointerType;
      this.downAt = performance.now();
      this.idleSpin = 0;
      // Resolve the tap against the frame the player actually sees. The camera
      // may still be easing by the time pointerup arrives, so re-picking later
      // would test a different view and miss the star under the finger.
      this.downHit = this.pickAt(ev.clientX, ev.clientY);
    } else if (this.pointers.size === 2) {
      this.dragging = false;
      this.tapCandidate = false;
      this.downHit = null;
      this.moved = 999;
      const points = [...this.pointers.values()];
      this.pinchStartDist = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      this.pinchStartZoom = this.distT;
    }
  };

  private handleMove = (ev: PointerEvent): void => {
    const tracked = this.pointers.get(ev.pointerId);
    if (tracked) {
      tracked.x = ev.clientX;
      tracked.y = ev.clientY;
    }

    if (this.pointers.size >= 2) {
      const points = [...this.pointers.values()];
      const spread = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (this.pinchStartDist > 10 && spread > 10) {
        this.distT = Math.max(70, Math.min(520, this.pinchStartZoom * (this.pinchStartDist / spread)));
      }
      this.tapCandidate = false;
      this.moved = 999;
    } else if (this.dragging && tracked) {
      const dx = ev.clientX - this.lastX;
      const dy = ev.clientY - this.lastY;
      this.lastX = ev.clientX;
      this.lastY = ev.clientY;
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.moved > 6) this.tapCandidate = false;
      this.thetaT -= dx * 0.005;
      this.phiT = Math.max(0.16, Math.min(1.34, this.phiT - dy * 0.004));
    }

    // Hover picking stays mouse-only; a touch drag must not steal hover state.
    if (ev.pointerType !== 'mouse') return;
    const hit = this.pickAt(ev.clientX, ev.clientY);
    this.labels.classList.toggle('hovering', !!hit);
    if (this.onHover) this.onHover(hit);
  };

  private handleUp = (ev: PointerEvent): void => {
    if (!this.pointers.delete(ev.pointerId)) return;
    try {
      this.renderer.domElement.releasePointerCapture(ev.pointerId);
    } catch {
      /* pointer may already be gone */
    }
    if (this.pointers.size === 0) {
      const quick = performance.now() - this.downAt < (this.downPointer === 'touch' ? 450 : 500);
      const travel = Math.hypot(ev.clientX - this.downX, ev.clientY - this.downY);
      const tap = this.tapCandidate && this.moved < 8 && travel < 10 && quick;
      this.dragging = false;
      this.tapCandidate = false;
      if (tap) {
        const hit = this.downHit;
        this.downHit = null;
        this.labels.classList.toggle('hovering', !!hit);
        this.onPick?.(hit);
      } else {
        this.downHit = null;
      }
    } else if (this.pointers.size === 1) {
      const [point] = [...this.pointers.values()];
      this.dragging = true;
      this.moved = 999;
      this.tapCandidate = false;
      this.downHit = null;
      this.lastX = point.x;
      this.lastY = point.y;
    }
  };

  private handleCancel = (ev: PointerEvent): void => {
    this.pointers.delete(ev.pointerId);
    this.downHit = null;
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.tapCandidate = false;
    } else if (this.pointers.size === 1) {
      const [point] = [...this.pointers.values()];
      this.dragging = true;
      this.moved = 999;
      this.tapCandidate = false;
      this.lastX = point.x;
      this.lastY = point.y;
    }
  };

  private handleWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    this.distT = Math.max(70, Math.min(520, this.distT * (1 + ev.deltaY * 0.0012)));
  };

  private pickAt(clientX: number, clientY: number): PickResult | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    if (!hits.length) return null;
    const data = hits[0].object.userData as { kind: 'system' | 'fleet'; id: number };
    return { type: data.kind, id: data.id };
  }

  resize(): void {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = Math.max(0.4, w / Math.max(1, h));
    this.camera.updateProjectionMatrix();
    this.labelCache.clear();
    this.labelTimer = 1;
    this.placeCamera();
    this.updateLabels();
  }

  private placeCamera(): void {
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      Math.cos(this.theta) * sp * this.dist,
      Math.cos(this.phi) * this.dist,
      Math.sin(this.theta) * sp * this.dist,
    );
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  tick(dt: number): void {
    this.time += dt;
    this.laneUniforms.uTime.value = this.time;

    if (!this.dragging) {
      this.idleSpin += dt;
      if (this.idleSpin > 6) this.thetaT += dt * 0.02;
    }
    this.theta += (this.thetaT - this.theta) * Math.min(1, dt * 7);
    this.phi += (this.phiT - this.phi) * Math.min(1, dt * 7);
    this.dist += (this.distT - this.dist) * Math.min(1, dt * 4);

    const sp = Math.sin(this.phi);
    this.camera.position.set(
      Math.cos(this.theta) * sp * this.dist,
      Math.cos(this.phi) * this.dist,
      Math.sin(this.theta) * sp * this.dist,
    );
    this.camera.lookAt(0, 0, 0);

    for (const [, node] of this.nodes) {
      const s = 1 + Math.sin(this.time * 1.4 + node.pos.x * 0.05) * 0.06;
      node.group.scale.setScalar(s);
    }
    for (const [, node] of this.fleetNodes) {
      node.pos.lerp(node.target, Math.min(1, dt * 2.6));
      node.group.position.copy(node.pos);
      node.group.rotation.y += dt * 0.7;
    }

    this.labelTimer += dt;
    if (this.labelTimer >= 0.05) {
      this.labelTimer = 0;
      this.updateLabels();
    }
    this.composer.render();
  }

  private updateLabels(): void {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    for (const [id, node] of this.nodes) {
      v.set(node.pos.x, node.pos.y + 9.5, node.pos.z);
      v.project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.25 && Math.abs(v.y) < 1.25;
      const cached = this.labelCache.get(id);
      if (!cached || cached.visible !== visible) {
        node.label.style.visibility = visible ? 'visible' : 'hidden';
      }
      if (!visible) {
        this.labelCache.set(id, { x: 0, y: 0, visible: false });
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      if (!cached || !cached.visible || Math.abs(cached.x - x) > 0.35 || Math.abs(cached.y - y) > 0.35) {
        node.label.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
        this.labelCache.set(id, { x, y, visible: true });
      }
      if (this.targetSel === id) {
        this.reticle.style.visibility = 'visible';
        this.reticle.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      }
    }
    if (this.targetSel === null) this.reticle.style.visibility = 'hidden';
  }
}

export function factionIds(): FactionId[] {
  return FACTION_IDS;
}
