import type { Game } from './types';

/**
 * Save slots + autosave + file export/import.
 * Game state is plain JSON data (see types.ts), so stringify/parse round-trips
 * without custom revivers. Every load is validated structurally — a corrupt or
 * foreign payload never reaches bootWorld().
 */
export const SAVE_VERSION = 1;
export const SLOT_COUNT = 3;
export const AUTOSAVE_KEY = 'pax-aeterna.save.autosave.v1';
export const SLOT_KEY_PREFIX = 'pax-aeterna.save.slot.';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MiB guard against oversized imports

export interface SaveMeta {
  slot: number; // -1 = autosave, 0..SLOT_COUNT-1 = slot
  savedAt: number;
  cycle: number;
  seed: number;
  player: string;
  /** Sektoren im Besitz des Spielers */
  systems: number;
  /** Gesamtsysteme im Spielstand (64) */
  totalSystems: number;
  colonies: number;
}

export interface SaveEnvelope {
  kind: 'pax-aeterna-save';
  version: number;
  savedAt: number;
  game: Game;
}

/** Menschlesbare Metadaten-Zeile; Name der Fraktion kommt aus der UI. */
export function saveMetaLine(meta: SaveMeta, factionName: string): string {
  const when = new Date(meta.savedAt).toLocaleString('de-DE');
  return `${factionName} · Zyklus ${meta.cycle} · Seed ${meta.seed} · ${meta.totalSystems} Systeme (${meta.systems} eigene) · ${meta.colonies} Kolonien · ${when}`;
}

export function slotKey(slot: number): string {
  return slot < 0 ? AUTOSAVE_KEY : `${SLOT_KEY_PREFIX}${slot}`;
}

export function isValidGame(value: unknown): value is Game {
  if (!value || typeof value !== 'object') return false;
  const g = value as Partial<Game>;
  return (
    typeof g.seed === 'number' &&
    typeof g.cycle === 'number' &&
    typeof g.player === 'string' &&
    Array.isArray(g.systems) &&
    g.systems.length > 0 &&
    g.systems.every((s) => s && typeof s === 'object' && Array.isArray(s.planets)) &&
    Array.isArray(g.fleets) &&
    !!g.empires &&
    typeof g.empires === 'object' &&
    g.empires[g.player] !== undefined &&
    typeof g.nextFleetId === 'number'
  );
}

export function serializeGame(game: Game): string {
  const env: SaveEnvelope = { kind: 'pax-aeterna-save', version: SAVE_VERSION, savedAt: Date.now(), game };
  return JSON.stringify(env);
}

export function deserializeGame(raw: string): Game | null {
  if (!raw || raw.length > MAX_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as SaveEnvelope;
    if (parsed?.kind !== 'pax-aeterna-save' || parsed.version !== SAVE_VERSION) return null;
    return isValidGame(parsed.game) ? parsed.game : null;
  } catch {
    return null;
  }
}

function metaOf(slot: number, game: Game, savedAt: number): SaveMeta {
  return {
    slot,
    savedAt,
    cycle: game.cycle,
    seed: game.seed,
    player: game.player,
    systems: game.systems.filter((s) => s.owner === game.player).length,
    totalSystems: game.systems.length,
    colonies: game.systems.reduce((n, s) => n + s.planets.filter((p) => p.owner === game.player).length, 0),
  };
}

export function writeSave(slot: number, game: Game): SaveMeta | null {
  try {
    const raw = serializeGame(game);
    localStorage.setItem(slotKey(slot), raw);
    return metaOf(slot, game, Date.now());
  } catch {
    return null; // quota / private mode — game stays playable
  }
}

export function readSave(slot: number): { game: Game; meta: SaveMeta } | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(slotKey(slot));
  } catch {
    return null;
  }
  if (!raw) return null;
  const game = deserializeGame(raw);
  if (!game) return null;
  let savedAt = Date.now();
  try {
    savedAt = (JSON.parse(raw) as SaveEnvelope).savedAt ?? savedAt;
  } catch {
    /* validated already */
  }
  return { game, meta: metaOf(slot, game, savedAt) };
}

export function listSaves(): (SaveMeta | null)[] {
  const out: (SaveMeta | null)[] = [];
  for (let i = -1; i < SLOT_COUNT; i++) {
    const found = readSave(i);
    out.push(found ? found.meta : null);
  }
  return out; // index 0 = autosave, 1.. = slots 0..
}

export function deleteSave(slot: number): void {
  try {
    localStorage.removeItem(slotKey(slot));
  } catch {
    /* noop */
  }
}

export function exportFileName(game: Game): string {
  return `pax-aeterna-seed${game.seed}-cycle${game.cycle}.json`;
}

export function downloadSave(game: Game): void {
  const blob = new Blob([serializeGame(game)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(game);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
