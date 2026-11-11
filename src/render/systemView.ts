import * as THREE from 'three';
import { FACTIONS_BY_ID, PLANET_TYPES } from '../data';
import { getGlowTexture, glowSprite } from './assets';
import type { Planet, StarSystem } from '../types';

const PLANET_VERT = `
varying vec3 vN;
varying vec3 vWorld;
void main(){
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

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
  for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.02 + 7.3; a *= 0.5; }
  return s;
}
`;

const PLANET_FRAG = `
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uLand;
uniform vec3 uIce;
uniform vec3 uAtmo;
uniform float uSeed;
uniform float uLandBias;
uniform float uCity;
uniform float uTime;
varying vec3 vN;
varying vec3 vWorld;
${NOISE}
void main(){
  vec3 dir = normalize(vWorld);
  float base = fbm(dir * 2.1 + uSeed);
  float detail = fbm(dir * 6.4 + uSeed * 1.7 + 3.0);
  float land = smoothstep(uLandBias, uLandBias + 0.07, base + detail * 0.10);
  vec3 ocean = mix(uDeep, uShallow, smoothstep(0.22, uLandBias, base));
  vec3 col = mix(ocean, uLand * (0.72 + detail * 0.55), land);
  float lat = abs(dir.y);
  float ice = smoothstep(0.75, 0.94, lat + base * 0.07);
  col = mix(col, uIce, ice);
  vec3 N = normalize(vN);
  vec3 L = normalize(-vWorld);
  float diff = max(dot(N, L), 0.0);
  col *= 0.07 + 1.35 * diff;
  float city = smoothstep(0.60, 0.92, detail) * land * smoothstep(0.22, 0.0, diff) * uCity;
  col += vec3(1.0, 0.70, 0.36) * city * 1.1;
  vec3 V = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += uAtmo * rim * 0.6;
  gl_FragColor = vec4(col, 1.0);
}
`;

const CLOUD_FRAG = `
uniform vec3 uIce;
uniform float uSeed;
uniform float uCloud;
uniform float uTime;
varying vec3 vN;
varying vec3 vWorld;
${NOISE}
void main(){
  vec3 dir = normalize(vWorld);
  float c = smoothstep(0.48, 0.74, fbm(dir * 3.5 + uSeed + vec3(uTime * 0.012, 0.0, 0.0)));
  vec3 N = normalize(vN);
  vec3 L = normalize(-vWorld);
  float diff = max(dot(N, L), 0.0);
  float rim = pow(1.0 - max(dot(N, normalize(cameraPosition - vWorld)), 0.0), 2.0);
  vec3 col = mix(vec3(0.55), vec3(1.0), diff) + rim * 0.4;
  gl_FragColor = vec4(col, c * uCloud * 0.62);
}
`;

const ATMO_FRAG = `
uniform vec3 uAtmo;
varying vec3 vN;
varying vec3 vWorld;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float f = pow(1.0 - max(dot(N, V), 0.0), 3.2);
  float lit = clamp(dot(N, normalize(-vWorld)) * 0.8 + 0.35, 0.0, 1.0);
  gl_FragColor = vec4(uAtmo * lit, f * 0.55);
}
`;

interface PlanetNode {
  planet: Planet;
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  cloud: THREE.Mesh;
  orbitRing: THREE.Line;
  radius: number;
  orbit: number;
  angle: number;
  speed: number;
}

export class SystemScope {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private root = new THREE.Group();
  private planets: PlanetNode[] = [];
  private starGroup = new THREE.Group();
  private selectRing: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private time = 0;
  private theta = 0.7;
  private selected: number | null = null;
  private hovered: number | null = null;
  private disposables: THREE.Material[] = [];
  // Camera focus: eases between the whole-system overview and a close-up of
  // the selected planet. `distGoal` is what the wheel writes; `dist` follows.
  private camTarget = new THREE.Vector3();
  private camGoal = new THREE.Vector3();
  private dist = 112;
  private distGoal = 112;
  private downX = 0;
  private downY = 0;
  private moved = 0;
  private dragging = false;

  onPick: ((planetId: number | null) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 600);
    this.camera.position.set(0, 62, 108);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(this.root);
    this.scene.add(new THREE.AmbientLight(0x6a83a0, 0.7));

    this.selectRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.08, 48),
      new THREE.MeshBasicMaterial({
        color: 0xf0a63f,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.selectRing.visible = false;
    this.scene.add(this.selectRing);

    canvas.addEventListener('pointermove', this.handleMove);
    canvas.addEventListener('pointerleave', () => {
      this.hovered = null;
      this.dragging = false;
      canvas.style.cursor = 'default';
    });
    canvas.addEventListener('pointerdown', (ev) => {
      this.dragging = true;
      this.moved = 0;
      this.downX = ev.clientX;
      this.downY = ev.clientY;
    });
    canvas.addEventListener('pointerup', () => {
      this.dragging = false;
    });
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('click', this.handleClick);
    this.resize();
  }

  setSystem(sys: StarSystem | null, explored: boolean): void {
    // Every system starts from the neutral overview.
    this.camTarget.set(0, 0, 0);
    this.dist = this.distGoal = 112;
    for (const node of this.planets) {
      this.root.remove(node.pivot);
      node.mesh.geometry.dispose();
      node.cloud.geometry.dispose();
      node.orbitRing.geometry.dispose();
    }
    this.planets = [];
    for (const m of this.disposables) m.dispose();
    this.disposables = [];
    this.root.clear();
    this.root.add(this.starGroup);
    this.starGroup.clear();
    this.selectRing.visible = false;
    if (!sys) return;

    const glow = glowSprite(sys.starColor, 46, 1);
    this.starGroup.add(glow);
    const star = new THREE.Mesh(
      new THREE.SphereGeometry(sys.starRadius * 2.0, 24, 18),
      new THREE.MeshBasicMaterial({ color: sys.starColor }),
    );
    this.starGroup.add(star);
    const light = new THREE.PointLight(sys.starColor, 3.2, 0, 0);
    this.starGroup.add(light);

    const disc = new THREE.Mesh(
      new THREE.RingGeometry(4, 52, 64),
      new THREE.MeshBasicMaterial({
        color: 0x1b3a52,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    this.root.add(disc);

    if (!explored) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;

    sys.planets.forEach((p, index) => {
      const def = PLANET_TYPES[p.type];
      const radius = 1.4 + p.size * 1.7;
      const orbit = 9 + index * 8.4 + p.size * 2.2;
      const shade = {
        deep: new THREE.Color(def.palette.deep),
        shallow: new THREE.Color(def.palette.shallow),
        land: new THREE.Color(def.palette.land),
        ice: new THREE.Color(def.palette.ice),
        atmo: new THREE.Color(def.palette.atmo),
      };
      const surfaceMat = new THREE.ShaderMaterial({
        uniforms: {
          uDeep: { value: shade.deep },
          uShallow: { value: shade.shallow },
          uLand: { value: shade.land },
          uIce: { value: shade.ice },
          uAtmo: { value: shade.atmo },
          uSeed: { value: p.seed },
          uLandBias: { value: 0.52 - def.habitability * 0.12 },
          uCity: { value: p.owner ? 1 : 0 },
          uTime: { value: 0 },
        },
        vertexShader: PLANET_VERT,
        fragmentShader: PLANET_FRAG,
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), surfaceMat);
      mesh.userData = { planetId: p.id };
      this.disposables.push(surfaceMat);

      const cloudMat = new THREE.ShaderMaterial({
        uniforms: {
          uSeed: { value: p.seed },
          uCloud: { value: def.clouds },
          uTime: { value: 0 },
          uIce: { value: shade.ice },
        },
        vertexShader: PLANET_VERT,
        fragmentShader: CLOUD_FRAG,
        transparent: true,
        depthWrite: false,
      });
      const cloud = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.022, 40, 26), cloudMat);
      this.disposables.push(cloudMat);

      const atmoMat = new THREE.ShaderMaterial({
        uniforms: { uAtmo: { value: shade.atmo } },
        vertexShader: PLANET_VERT,
        fragmentShader: ATMO_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
      });
      const atmo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.09, 40, 26), atmoMat);
      this.disposables.push(atmoMat);

      const pivot = new THREE.Group();
      pivot.rotation.y = p.angle;
      pivot.rotation.x = (index % 2 === 0 ? 1 : -1) * 0.035 * index;
      const holder = new THREE.Group();
      holder.position.x = orbit;
      holder.add(mesh, cloud, atmo);
      pivot.add(holder);

      const ringColor = p.owner ? FACTIONS_BY_ID[p.owner].color : 0x3d5a72;
      const ringGeo = new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 97 }, (_, i) => {
          const a = (i / 96) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(a) * orbit, 0, Math.sin(a) * orbit);
        }),
      );
      const orbitRing = new THREE.Line(
        ringGeo,
        new THREE.LineBasicMaterial({
          color: ringColor,
          transparent: true,
          opacity: p.owner ? 0.5 : 0.22,
        }),
      );
      pivot.add(orbitRing);
      this.disposables.push(orbitRing.material as THREE.Material);

      this.root.add(pivot);
      this.planets.push({
        planet: p,
        pivot,
        mesh,
        cloud,
        orbitRing,
        radius,
        orbit,
        angle: p.angle,
        speed: 0.16 / Math.sqrt(orbit) + 0.02,
      });
    });

    this.setSelected(this.selected);
  }

  setSelected(planetId: number | null): void {
    this.selected = planetId;
    const node = this.planets.find((n) => n.planet.id === planetId);
    this.selectRing.visible = !!node;
    if (node) {
      this.selectRing.scale.setScalar(node.radius * 2.0);
      // Nahansicht: close enough that the planet fills the frame.
      this.distGoal = THREE.MathUtils.clamp(node.radius * 4.5, 9, 18);
    } else {
      // No planet selected = whole-system overview again.
      this.distGoal = 112;
    }
  }

  private updatePointer(ev: PointerEvent | MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private lastClientX = 0;
  private lastClientY = 0;

  private handleMove = (ev: PointerEvent): void => {
    if (this.dragging) {
      this.moved += Math.abs(ev.clientX - this.lastClientX) + Math.abs(ev.clientY - this.lastClientY);
      this.theta += (ev.clientX - this.lastClientX) * 0.006;
    }
    this.lastClientX = ev.clientX;
    this.lastClientY = ev.clientY;
    this.updatePointer(ev);
    const hit = this.pick();
    this.hovered = hit;
    this.canvas.style.cursor = hit !== null ? 'pointer' : 'default';
  };

  private handleWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    this.distGoal = THREE.MathUtils.clamp(this.distGoal * (1 + ev.deltaY * 0.0012), 7, 170);
  };

  private handleClick = (ev: MouseEvent): void => {
    // A "click" that was really a drag (rotating) must not change selection.
    if (Math.hypot(ev.clientX - this.downX, ev.clientY - this.downY) > 6) return;
    this.updatePointer(ev);
    if (this.onPick) this.onPick(this.pick());
  };

  private pick(): number | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = this.planets.map((n) => n.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const data = hits[0].object.userData as { planetId: number };
    return data.planetId;
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    const w = parent?.clientWidth ?? this.canvas.clientWidth;
    const h = parent?.clientHeight ?? this.canvas.clientHeight;
    if (w < 4 || h < 4) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tick(dt: number): void {
    this.time += dt;
    if (!this.dragging) this.theta += dt * 0.055;

    // Ease the focus onto the selected planet (it orbits, so track it live).
    const selectedNode = this.selected !== null ? this.planets.find((n) => n.planet.id === this.selected) : undefined;
    if (selectedNode) selectedNode.mesh.getWorldPosition(this.camGoal);
    else this.camGoal.set(0, 0, 0);
    const damp = 1 - Math.exp(-dt * 4);
    this.camTarget.lerp(this.camGoal, damp);
    this.dist += (this.distGoal - this.dist) * (1 - Math.exp(-dt * 3.5));
    this.camera.position.set(
      this.camTarget.x + Math.cos(this.theta) * this.dist * 0.55,
      this.camTarget.y + this.dist * 0.52,
      this.camTarget.z + Math.sin(this.theta) * this.dist * 0.85,
    );
    this.camera.lookAt(this.camTarget);

    const pv = new THREE.Vector3();
    for (const node of this.planets) {
      node.pivot.rotation.y += node.speed * dt;
      node.mesh.rotation.y += dt * 0.06;
      node.cloud.rotation.y += dt * 0.085;
      const mat = node.mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = this.time;
      (node.cloud.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
      node.mesh.getWorldPosition(pv);
      if (this.hovered === node.planet.id) node.mesh.scale.setScalar(1.035);
      else node.mesh.scale.setScalar(1);
    }

    if (this.selected !== null) {
      const node = this.planets.find((n) => n.planet.id === this.selected);
      if (node) {
        node.mesh.getWorldPosition(pv);
        this.selectRing.position.copy(pv);
        this.selectRing.quaternion.copy(this.camera.quaternion);
      }
    }

    if (this.hovered !== null) {
      const node = this.planets.find((n) => n.planet.id === this.hovered);
      if (node) {
        this.canvas.title = node.planet.name;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}

export function starTexture(): THREE.Texture {
  return getGlowTexture();
}
