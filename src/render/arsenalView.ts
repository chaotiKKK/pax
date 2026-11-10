import * as THREE from 'three';
import { instantiateShip, setupEnvironment, getGlowTexture } from './assets';

/** Rotating studio viewer used by the Arsenal screen. */
export class ArsenalView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private model: THREE.Group | null = null;
  private loading = false;
  private azimuth = 0.7;
  private elevation = 0.22;
  private distance = 36;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private time = 0;
  private token = 0;
  private key = '';

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 600);
    setupEnvironment(this.renderer, this.scene);
    this.scene.environmentIntensity = 0.7;

    const key = new THREE.DirectionalLight(0xffe9cf, 3.0);
    key.position.set(-18, 24, 20);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x74a8ff, 3.4);
    rim.position.set(22, -10, -24);
    this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0x8ea6c4, 1.1));

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: 0x2a4b6e,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.scale.setScalar(90);
    glow.position.set(0, 0, -30);
    this.scene.add(glow);

    canvas.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    this.resize();
  }

  async setShip(key: string, color: number): Promise<void> {
    if (key === this.key && this.model) return;
    this.key = key;
    this.loading = true;
    const token = ++this.token;
    const model = await instantiateShip(key, color, 24);
    if (token !== this.token) return;
    if (this.model) this.scene.remove(this.model);
    this.model = model;
    this.scene.add(model);
    this.loading = false;
  }

  private down = (ev: PointerEvent): void => {
    this.dragging = true;
    this.lastX = ev.clientX;
    this.lastY = ev.clientY;
  };
  private move = (ev: PointerEvent): void => {
    if (!this.dragging) return;
    this.azimuth -= (ev.clientX - this.lastX) * 0.008;
    this.elevation = Math.max(-0.5, Math.min(0.85, this.elevation + (ev.clientY - this.lastY) * 0.006));
    this.lastX = ev.clientX;
    this.lastY = ev.clientY;
  };
  private up = (): void => {
    this.dragging = false;
  };
  private wheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    this.distance = Math.max(22, Math.min(110, this.distance * (1 + ev.deltaY * 0.0012)));
  };

  resize(): void {
    const wrap = this.canvas.parentElement;
    const w = wrap?.clientWidth ?? 600;
    const h = wrap?.clientHeight ?? 360;
    if (w < 4 || h < 4) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  tick(dt: number): void {
    this.time += dt;
    if (!this.dragging && this.model) this.azimuth += dt * 0.16;
    const ce = Math.cos(this.elevation);
    this.camera.position.set(
      Math.sin(this.azimuth) * ce * this.distance,
      Math.sin(this.elevation) * this.distance + 4,
      Math.cos(this.azimuth) * ce * this.distance,
    );
    this.camera.lookAt(0, 0, 0);
    if (this.model) {
      this.model.position.y = Math.sin(this.time * 0.6) * 0.7;
    }
    this.renderer.render(this.scene, this.camera);
  }

  get isLoading(): boolean {
    return this.loading;
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.down);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('wheel', this.wheel);
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.renderer.dispose();
  }
}
