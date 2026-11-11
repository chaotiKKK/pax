import { SHIP_CLASSES, SHIP_ORDER } from '../data';
import type { ShipDef, ShipId } from '../types';

/**
 * Player-designed ships from the Ship Designer. A design is a stat block on
 * top of a base hull: the base supplies the model, dimensions and build time,
 * the sliders spend a cost budget on attack / hull / speed. Designs persist
 * in localStorage and are registered into SHIP_CLASSES / SHIP_ORDER at boot,
 * so every system that derives its lookups from those tables (build menus,
 * simulation, battles, saves) treats them as first-class hull classes.
 */
export interface CustomShipSpec {
  id: string;
  name: string;
  role: string;
  base: ShipId;
  attack: number;
  hull: number;
  speed: number;
}

const KEY = 'pax.customShips.v1';
const MAX_DESIGNS = 24;

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function listCustomShips(): CustomShipSpec[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: CustomShipSpec[] = [];
    for (const item of parsed.slice(0, MAX_DESIGNS)) {
      const s = sanitizeSpec(item);
      if (s) out.push(s);
    }
    return out;
  } catch {
    return [];
  }
}

function sanitizeSpec(raw: unknown): CustomShipSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<CustomShipSpec>;
  if (typeof s.id !== 'string' || !s.id.startsWith('custom_') || s.id.length > 48) return null;
  if (typeof s.name !== 'string' || !s.name.trim()) return null;
  if (typeof s.base !== 'string' || !SHIP_CLASSES[s.base as ShipId] || isCustomId(s.base)) return null;
  const num = (v: unknown, min: number, max: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : NaN;
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
  };
  const attack = num(s.attack, 0, 4000);
  const hull = num(s.hull, 0, 20000);
  const speed = num(s.speed, 0.4, 6);
  if (attack === null || hull === null || speed === null) return null;
  if (attack === 0 && hull === 0) return null;
  return {
    id: s.id,
    name: s.name.trim().slice(0, 40),
    role: (typeof s.role === 'string' && s.role.trim() ? s.role.trim() : 'Design-Rumpf').slice(0, 32),
    base: s.base as ShipId,
    attack: Math.round(attack),
    hull: Math.round(hull),
    speed: Math.round(speed * 100) / 100,
  };
}

export function isCustomId(id: string): boolean {
  return typeof id === 'string' && id.startsWith('custom_');
}

function persist(specs: CustomShipSpec[]): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(specs));
  } catch {
    /* storage full or unavailable — registry still works for this session */
  }
}

/** Alloy cost of a design, relative to its base hull (see shipDesigner UI). */
export function designCost(spec: Pick<CustomShipSpec, 'base' | 'attack' | 'hull' | 'speed'>): number {
  const base = SHIP_CLASSES[spec.base];
  if (!base) return 0;
  const ratio =
    0.45 * (spec.attack / Math.max(1, base.attack)) +
    0.4 * (spec.hull / Math.max(1, base.hull)) +
    0.15 * (spec.speed / Math.max(0.5, base.speed));
  return Math.max(20, Math.round(base.alloy * (0.4 + 0.6 * ratio)));
}

function defFor(spec: CustomShipSpec): ShipDef {
  const base = SHIP_CLASSES[spec.base];
  const alloy = designCost(spec);
  return {
    id: spec.id as ShipId,
    name: spec.name,
    role: spec.role,
    model: base.model,
    alloy,
    buildTime: base.buildTime + (alloy > base.alloy * 1.5 ? 1 : 0),
    attack: spec.attack,
    hull: spec.hull,
    speed: spec.speed,
    length: base.length,
    battleLength: base.battleLength,
    garrison: base.garrison,
    colonizer: false,
    unlock: 'Custom-Design',
    desc: `Spieler-Design auf ${base.name}-Basis.`,
  };
}

/** Register every saved design into the data tables. Call once at boot. */
export function registerCustomShips(): CustomShipSpec[] {
  const specs = listCustomShips();
  for (const spec of specs) install(spec);
  return specs;
}

function install(spec: CustomShipSpec): void {
  const id = spec.id as ShipId;
  SHIP_CLASSES[id] = defFor(spec);
  if (!SHIP_ORDER.includes(id)) SHIP_ORDER.push(id);
}

/** Add (or replace) a design: persists it and registers it immediately. */
export function addCustomShip(spec: CustomShipSpec): CustomShipSpec {
  const full: CustomShipSpec = { ...spec, id: `custom_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}` };
  const specs = listCustomShips();
  specs.push(full);
  persist(specs.slice(-MAX_DESIGNS));
  install(full);
  return full;
}

/** Remove a design from storage and from the live data tables. */
export function deleteCustomShip(id: string): void {
  persist(listCustomShips().filter((s) => s.id !== id));
  const sid = id as ShipId;
  delete (SHIP_CLASSES as Record<string, ShipDef>)[id];
  const idx = SHIP_ORDER.indexOf(sid);
  if (idx >= 0) SHIP_ORDER.splice(idx, 1);
}
