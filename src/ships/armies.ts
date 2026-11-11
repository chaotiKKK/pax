import { SHIP_CLASSES, SHIP_ORDER } from '../data';
import type { ShipId } from '../types';

/**
 * Army templates from the Army Editor: named starting compositions
 * (ship class → count) persisted in localStorage. When a campaign is started
 * with a template selected, createGame uses it as the player's starting
 * flotilla instead of the profile hull. The full ship counts land in the
 * serialized game state, so LAN clients and saves stay consistent without
 * knowing the template.
 */
export interface ArmyTemplate {
  id: string;
  name: string;
  ships: Partial<Record<ShipId, number>>;
}

const KEY = 'pax.armyTemplates.v1';
const MAX_TEMPLATES = 16;
const MAX_PER_CLASS = 99;

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function sanitizeShips(raw: unknown): Partial<Record<ShipId, number>> {
  const out: Partial<Record<ShipId, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of SHIP_ORDER) {
    const n = (raw as Record<string, unknown>)[id];
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      out[id] = Math.min(MAX_PER_CLASS, Math.floor(n));
    }
  }
  return out;
}

export function listArmyTemplates(): ArmyTemplate[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: ArmyTemplate[] = [];
    for (const item of parsed.slice(0, MAX_TEMPLATES)) {
      if (!item || typeof item !== 'object') continue;
      const t = item as Partial<ArmyTemplate>;
      if (typeof t.id !== 'string' || !t.id || t.id.length > 48) continue;
      if (typeof t.name !== 'string' || !t.name.trim()) continue;
      const ships = sanitizeShips(t.ships);
      if (Object.keys(ships).length === 0) continue;
      out.push({ id: t.id, name: t.name.trim().slice(0, 40), ships });
    }
    return out;
  } catch {
    return [];
  }
}

export function armyTemplateById(id: string | undefined): ArmyTemplate | null {
  if (!id) return null;
  return listArmyTemplates().find((t) => t.id === id) ?? null;
}

function persist(templates: ArmyTemplate[]): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(templates));
  } catch {
    /* session-only fallback */
  }
}

/** Create or replace a template. Returns the stored template. */
export function saveArmyTemplate(template: ArmyTemplate): ArmyTemplate {
  const ships = sanitizeShips(template.ships);
  const saved: ArmyTemplate = {
    id: template.id || `army_${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`,
    name: template.name.trim().slice(0, 40),
    ships,
  };
  const list = listArmyTemplates().filter((t) => t.id !== saved.id);
  list.push(saved);
  persist(list.slice(-MAX_TEMPLATES));
  return saved;
}

export function deleteArmyTemplate(id: string): void {
  persist(listArmyTemplates().filter((t) => t.id !== id));
}

export function armyShipCount(template: ArmyTemplate): number {
  return Object.values(template.ships).reduce<number>((sum, n) => sum + (n ?? 0), 0);
}

export function armyCost(template: ArmyTemplate): number {
  let total = 0;
  for (const id of SHIP_ORDER) {
    const n = template.ships[id] ?? 0;
    if (n > 0 && SHIP_CLASSES[id]) total += n * SHIP_CLASSES[id].alloy;
  }
  return total;
}

export function armySummary(template: ArmyTemplate): string {
  const parts = SHIP_ORDER.filter((id) => (template.ships[id] ?? 0) > 0).map(
    (id) => `${template.ships[id]}× ${SHIP_CLASSES[id].role}`,
  );
  return parts.length ? parts.join(' · ') : 'leer';
}
