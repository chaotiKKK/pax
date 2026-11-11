/**
 * IDs are deliberately plain strings: the content tables in data.ts define the
 * roster (16 powers, 13 hulls, 96 technologies, 17 world types), and every
 * system derives its lookups from those tables instead of exhaustive unions.
 * That keeps adding content a data change rather than a type refactor.
 */
export type FactionId = string;
export type ShipId = string;
export type BuildingId = string;
export type Branch = string;
export type PlanetTypeId = string;

export type ResourceId = 'energy' | 'alloy' | 'research' | 'influence';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PlanetPalette {
  deep: string;
  shallow: string;
  land: string;
  ice: string;
  atmo: string;
}

export interface PlanetTypeDef {
  id: PlanetTypeId;
  name: string;
  short: string;
  habitability: number;
  colonizable: boolean;
  palette: PlanetPalette;
  clouds: number;
  yields: { energy: number; alloy: number; research: number };
  blurb: string;
}

export interface FactionDef {
  id: FactionId;
  name: string;
  short: string;
  motto: string;
  color: number;
  css: string;
  cssSoft: string;
  doctrine: string;
  lore: string;
  traits: { label: string; value: string }[];
  mods: {
    attack: number;
    hull: number;
    income: number;
    research: number;
    growth: number;
    shipCost: number;
    diplomacy: number;
  };
}

export interface ShipDef {
  id: ShipId;
  name: string;
  role: string;
  model: string;
  alloy: number;
  buildTime: number;
  attack: number;
  hull: number;
  speed: number;
  length: number;
  /** Authored battle-line length in world units, independent of lore length. */
  battleLength: number;
  garrison: number;
  colonizer: boolean;
  unlock: string;
  desc: string;
}

export interface BuildingBonus {
  energy?: number;
  alloy?: number;
  research?: number;
  cap?: number;
  defense?: number;
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  desc: string;
  alloy: number;
  buildTime: number;
  effect: string;
  unlock: string;
  glyph: string;
  bonus: BuildingBonus;
}

export interface TechDef {
  id: string;
  branch: Branch;
  tier: number;
  name: string;
  cost: number;
  desc: string;
  mods: Partial<Record<'attack' | 'hull' | 'speed' | 'income' | 'research' | 'influence', number>>;
}

export interface Planet {
  id: number;
  systemId: number;
  name: string;
  type: PlanetTypeId;
  size: number;
  orbit: number;
  angle: number;
  seed: number;
  habitability: number;
  yields: { energy: number; alloy: number; research: number };
  owner: FactionId | null;
  pop: number;
  buildings: Record<BuildingId, number>;
  queue: { kind: 'building'; id: BuildingId } | { kind: 'ship'; id: ShipId } | null;
  progress: number;
  siege: number;
}

export interface StarSystem {
  id: number;
  name: string;
  pos: Vec3;
  starClass: string;
  starColor: number;
  starRadius: number;
  planets: Planet[];
  links: number[];
  owner: FactionId | null;
  explored: Record<FactionId, boolean>;
  site: 'none' | 'ruin' | 'beacon' | 'nexus';
  laneGlow: number;
}

export interface Fleet {
  id: number;
  owner: FactionId;
  name: string;
  system: number;
  ships: Record<ShipId, number>;
  hp: Record<ShipId, number>;
  path: number[];
  step: number;
  wait: number;
  home: number;
}

export interface EmpireProfile {
  shipClass: ShipId;
  /** Optional Army Editor template used as the starting flotilla. */
  armyId?: string;
  traits: string[];
  government: string;
  worldview: string;
  religion: string;
}

export interface EmpireProfileMods {
  attack: number;
  hull: number;
  income: number;
  research: number;
  influence: number;
}

export interface Empire {
  id: FactionId;
  isPlayer: boolean;
  alive: boolean;
  energy: number;
  alloy: number;
  influence: number;
  techs: string[];
  active: Record<Branch, string | null>;
  progress: Record<Branch, number>;
  capital: number;
  eliminated: boolean;
  /** Founding choices of the player empire; absent on AI empires. */
  profile?: EmpireProfile;
  /** Baked-in multipliers of the founding choices, so LAN snapshots agree. */
  profileMods?: EmpireProfileMods;
}

export interface LogEntry {
  cycle: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'war' | 'science';
}

export type DiploState = 'peace' | 'war' | 'pact' | 'alliance';

export interface BattleSide {
  owner: FactionId;
  ships: Record<ShipId, number>;
  hull: number;
  startHull: number;
  power: number;
}

export interface BattleRecord {
  system: number;
  attacker: FactionId;
  defender: FactionId;
  rounds: { a: number; b: number; aHull: number; bHull: number }[];
  winner: FactionId | null;
  destroyed: Record<string, number>;
  invaded: boolean;
  systemName: string;
  aStart: Record<ShipId, number>;
  bStart: Record<ShipId, number>;
  aEnd: Record<ShipId, number>;
  bEnd: Record<ShipId, number>;
  defense: number;
}

export interface Game {
  seed: number;
  cycle: number;
  player: FactionId;
  systems: StarSystem[];
  fleets: Fleet[];
  empires: Record<FactionId, Empire>;
  relations: Record<string, number>;
  states: Record<string, DiploState>;
  log: LogEntry[];
  victory: { faction: FactionId; kind: string } | null;
  battles: BattleRecord[];
  nextFleetId: number;
  influenceGained: number;
}

// ---------------------------------------------------------------------------
// LAN multiplayer
// ---------------------------------------------------------------------------
export type Command =
  | { kind: 'building'; planetId: number; building: BuildingId }
  | { kind: 'ship'; planetId: number; ship: ShipId }
  | { kind: 'move'; fleetId: number; target: number }
  | { kind: 'colonize'; fleetId: number; planetId: number }
  | { kind: 'research'; branch: Branch; techId: string }
  | { kind: 'diplo'; other: FactionId; action: 'gift' | 'pact' | 'alliance' | 'war' | 'peace' };

export interface LobbyPlayer {
  id: string;
  name: string;
  faction: FactionId | null;
  ready: boolean;
  host: boolean;
}
