import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

export const BASE = import.meta.env.BASE_URL;

export function loadShip(key: string): Promise<THREE.Group> {
  const cached = cache.get(key);
  if (cached) return cached;
  const pending = loader.loadAsync(`${BASE}assets/models/${key}.glb`).then((gltf) => gltf.scene);
  cache.set(key, pending);
  return pending;
}

let glowTexture: THREE.Texture | null = null;
export function getGlowTexture(): THREE.Texture {
  if (glowTexture) return glowTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.72)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.20)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.045)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

export function glowSprite(color: number, scale: number, opacity = 1): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(scale);
  return sprite;
}

export function setupEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.42;
  pmrem.dispose();
}

/** Clone a hull, recolour its accent emissives for the faction, normalise its length. */
export async function instantiateShip(
  key: string,
  factionColor: number,
  targetLength: number,
  options: { groundAlign?: boolean } = {},
): Promise<THREE.Group> {
  const source = await loadShip(key);
  const model = source.clone(true);
  const swapped = new Map<THREE.Material, THREE.Material>();
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const original = mesh.material as THREE.MeshStandardMaterial;
    let next = swapped.get(original);
    if (!next) {
      const clone = original.clone();
      if (/accent/i.test(original.name)) {
        clone.color = new THREE.Color(factionColor);
        clone.emissive = new THREE.Color(factionColor);
        clone.emissiveIntensity = 2.4;
      }
      if (/hull_(mid|light)/i.test(original.name)) {
        clone.color.lerp(new THREE.Color(factionColor), 0.12);
      } else if (/hull_dark/i.test(original.name)) {
        clone.color.lerp(new THREE.Color(factionColor), 0.07);
      }
      if (/trim/i.test(original.name)) {
        clone.color.lerp(new THREE.Color(factionColor), 0.26);
      }
      if (/glow|engine/i.test(original.name)) {
        clone.color.lerp(new THREE.Color(factionColor), 0.45);
        clone.emissive.lerp(new THREE.Color(factionColor), 0.35);
        clone.emissiveIntensity = 3.2;
      }
      clone.envMapIntensity = 1.15;
      swapped.set(original, clone);
      next = clone;
    }
    mesh.material = next;
    mesh.frustumCulled = false;
  });

  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const length = Math.max(size.z, 0.001);
  const scale = targetLength / length;
  model.scale.setScalar(scale);
  model.position.set(
    -center.x * scale,
    (options.groundAlign ? -box.min.y : -center.y) * scale,
    -center.z * scale,
  );

  const wrapper = new THREE.Group();
  wrapper.add(model);
  wrapper.userData.size = new THREE.Vector3(size.x * scale, size.y * scale, size.z * scale);
  return wrapper;
}
