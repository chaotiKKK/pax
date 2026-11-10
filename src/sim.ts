import {
  BRANCH_ORDER,
  BUILDINGS,
  BUILDING_ORDER,
  FACTIONS_BY_ID,
  FACTION_IDS,
  MAX_CYCLES,
  PLANET_TYPES,
  SHIP_CLASSES,
  SHIP_ORDER,
  TECHS_BY_BRANCH,
  WIN_SYSTEMS,
  WIN_TECHS,
  buildingUnlocked,
  shipUnlocked,
} from './data';
import { TECH_BY_ID } from './data';
import { fleetAt, newFleet, planetsOf, systemsOf, tierOf } from './galaxy';
import type {
  BattleRecord,
  Branch,
  BuildingId,
  DiploState,
  FactionId,
  Fleet,
  Game,
  Planet,
  ShipId,
  StarSystem,
} from './types';

export const SHIP_IDS: ShipId[] = SHIP_ORDER;

export interface Mods {
  attack: number;
  hull: number;
  speed: number;
  income: number;
  research: number;
  influence: number;
}

export function empireMods(g: Game, id: FactionId): Mods {
  const emp = g.empires[id];
  const f = FACTIONS_BY_ID[id];
  const m: Mods = {
    attack: f.mods.attack,
    hull: f.mods.hull,
    speed: 1,
    income: f.mods.income,
    research: f.mods.research,
    influence: 1,
  };
  for (const t of emp.techs) {
    const def = TECH_BY_ID[t];
    if (!def) continue;
    m.attack += def.mods.attack ?? 0;
    m.hull += def.mods.hull ?? 0;
    m.speed += def.mods.speed ?? 0;
    m.income += def.mods.income ?? 0;
    m.research += def.mods.research ?? 0;
    m.influence += def.mods.influence ?? 0;
  }
  return m;
}

export function techTier(g: Game, id: FactionId, branch: Branch): number {
  return tierOf(g.empires[id], branch);
}

export function canBuildShip(g: Game, id: FactionId, cls: ShipId): boolean {
  return shipUnlocked(cls, (b) => techTier(g, id, b));
}

export function canBuildBuilding(g: Game, id: FactionId, b: BuildingId): boolean {
  return buildingUnlocked(b, (br) => techTier(g, id, br));
}

function buildingBonus(p: Planet, key: 'energy' | 'alloy' | 'research' | 'cap' | 'defense'): number {
  let sum = 0;
  for (const id of BUILDING_ORDER) {
    const count = p.buildings[id] ?? 0;
    if (!count) continue;
    sum += (BUILDINGS[id].bonus[key] ?? 0) * count;
  }
  return sum;
}

export function colonyCap(p: Planet): number {
  return Math.round(4 + buildingBonus(p, 'cap') + p.size * 2);
}

export function colonyOutput(p: Planet, mods: Mods): { energy: number; alloy: number; research: number } {
  const popFactor = Math.min(2.2, 0.4 + p.pop / 4.5);
  return {
    energy: (p.yields.energy * popFactor * 0.9 + buildingBonus(p, 'energy')) * mods.income,
    alloy: (p.yields.alloy * popFactor * 0.85 + buildingBonus(p, 'alloy')) * mods.income,
    research: (p.yields.research * popFactor * 0.8 + buildingBonus(p, 'research')) * mods.research,
  };
}

export function colonyDefense(p: Planet): number {
  return Math.round(30 + p.pop * 8 + buildingBonus(p, 'defense'));
}

export function shipCount(f: Fleet): number {
  return SHIP_IDS.reduce((s, c) => s + f.ships[c], 0);
}

export function hullOf(f: Fleet): number {
  return SHIP_IDS.reduce((s, c) => s + f.hp[c], 0);
}

export function fleetPower(g: Game, f: Fleet, extraMods?: Mods): number {
  const mods = extraMods ?? empireMods(g, f.owner);
  return SHIP_IDS.reduce((s, c) => s + f.ships[c] * SHIP_CLASSES[c].attack, 0) * mods.attack;
}

export function fleetSpeed(g: Game, f: Fleet): number {
  const mods = empireMods(g, f.owner);
  let s = Infinity;
  for (const c of SHIP_IDS) if (f.ships[c] > 0) s = Math.min(s, SHIP_CLASSES[c].speed * mods.speed);
  return s === Infinity ? 1 : s;
}

export function hopCost(g: Game, f: Fleet): number {
  return Math.max(1, Math.ceil(2 / fleetSpeed(g, f)));
}

export interface Income {
  energy: number;
  alloy: number;
  research: number;
  upkeep: number;
  net: number;
}

export function incomeOf(g: Game, id: FactionId): Income {
  const mods = empireMods(g, id);
  let energy = 0;
  let alloy = 0;
  let research = 0;
  for (const p of planetsOf(g, id)) {
    const o = colonyOutput(p, mods);
    energy += o.energy;
    alloy += o.alloy;
    research += o.research;
  }
  let upkeep = 0;
  for (const f of g.fleets) if (f.owner === id) upkeep += shipCount(f) * 0.12;
  return { energy, alloy, research, upkeep, net: energy - upkeep };
}

export function defenseOfSystem(sys: StarSystem): { hull: number; power: number } {
  let hull = 0;
  for (const p of sys.planets) if (p.owner) hull += colonyDefense(p);
  return { hull, power: hull * 0.42 };
}

export function planetById(g: Game, id: number): Planet | null {
  for (const s of g.systems) for (const p of s.planets) if (p.id === id) return p;
  return null;
}

export function systemOfPlanet(g: Game, p: Planet): StarSystem {
  return g.systems[p.systemId];
}

// ---------------------------------------------------------------------------
// diplomacy keys
// ---------------------------------------------------------------------------
export function relationKey(a: FactionId, b: FactionId): string {
  return [a, b].sort().join('|');
}
export function relOf(g: Game, a: FactionId, b: FactionId): number {
  return g.relations[relationKey(a, b)] ?? 0;
}
export function stateOf(g: Game, a: FactionId, b: FactionId): DiploState {
  if (a === b) return 'alliance';
  return g.states[relationKey(a, b)] ?? 'peace';
}
export function atWar(g: Game, a: FactionId, b: FactionId): boolean {
  return stateOf(g, a, b) === 'war';
}
function setRelation(g: Game, a: FactionId, b: FactionId, value: number): void {
  const key = relationKey(a, b);
  g.relations[key] = Math.max(-100, Math.min(100, value));
}

export function log(g: Game, text: string, kind: 'info' | 'good' | 'bad' | 'war' | 'science' = 'info'): void {
  g.log.unshift({ cycle: g.cycle, text, kind });
  if (g.log.length > 220) g.log.pop();
}

// ---------------------------------------------------------------------------
// orders
// ---------------------------------------------------------------------------
export function pathTo(g: Game, from: number, to: number): number[] | null {
  if (from === to) return [];
  const prev = new Map<number, number>();
  const seen = new Set<number>([from]);
  const queue: number[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of g.systems[cur].links) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      if (n === to) {
        const path: number[] = [to];
        let step = to;
        while (prev.has(step)) {
          step = prev.get(step)!;
          path.push(step);
        }
        path.reverse();
        return path.slice(1);
      }
      queue.push(n);
    }
  }
  return null;
}

export function orderMove(g: Game, fleetId: number, target: number): { ok: boolean; msg: string } {
  const f = g.fleets.find((x) => x.id === fleetId);
  if (!f) return { ok: false, msg: 'Flotte nicht gefunden.' };
  if (f.system === target) return { ok: false, msg: 'Die Flotte steht bereits dort.' };
  const path = pathTo(g, f.system, target);
  if (!path || path.length === 0) return { ok: false, msg: 'Kein Lanes-Kurs verfügbar.' };
  f.path = path;
  f.step = 0;
  f.wait = hopCost(g, f);
  return { ok: true, msg: `${f.name} setzt Kurs auf ${g.systems[target].name}.` };
}

export function mergeShip(g: Game, owner: FactionId, system: number, cls: ShipId): void {
  const list = fleetAt(g, system, owner);
  const f = list.find((x) => x.path.length === 0) ?? list[0] ?? newFleet(g, owner, system);
  f.ships[cls] += 1;
  f.hp[cls] += SHIP_CLASSES[cls].hull * empireMods(g, owner).hull;
}

export function queueBuilding(g: Game, planetId: number, b: BuildingId): { ok: boolean; msg: string } {
  const p = planetById(g, planetId);
  if (!p || !p.owner) return { ok: false, msg: 'Keine Kolonie.' };
  const emp = g.empires[p.owner];
  if (!canBuildBuilding(g, p.owner, b)) return { ok: false, msg: 'Technologie fehlt.' };
  if (p.queue) return { ok: false, msg: 'Die Bauleiste ist belegt.' };
  const def = BUILDINGS[b];
  if (emp.alloy < def.alloy) return { ok: false, msg: 'Zu wenig Legierungen.' };
  emp.alloy -= def.alloy;
  p.queue = { kind: 'building', id: b };
  p.progress = 0;
  return { ok: true, msg: `${def.name} in Auftrag gegeben.` };
}

export function queueShip(g: Game, planetId: number, cls: ShipId): { ok: boolean; msg: string } {
  const p = planetById(g, planetId);
  if (!p || !p.owner) return { ok: false, msg: 'Keine Kolonie.' };
  if (p.buildings.shipyard <= 0) return { ok: false, msg: 'Orbitalwerft fehlt.' };
  if (!canBuildShip(g, p.owner, cls)) return { ok: false, msg: 'Technologie fehlt.' };
  if (p.queue) return { ok: false, msg: 'Die Bauleiste ist belegt.' };
  const emp = g.empires[p.owner];
  const def = SHIP_CLASSES[cls];
  const factionDiscount = FACTIONS_BY_ID[p.owner].mods.shipCost;
  const cost = Math.round(def.alloy * factionDiscount);
  if (emp.alloy < cost) return { ok: false, msg: 'Zu wenig Legierungen.' };
  emp.alloy -= cost;
  p.queue = { kind: 'ship', id: cls };
  p.progress = 0;
  return { ok: true, msg: `${def.name} auf Kiel gelegt.` };
}

export function colonize(g: Game, fleetId: number, planetId: number): { ok: boolean; msg: string } {
  const f = g.fleets.find((x) => x.id === fleetId);
  if (!f) return { ok: false, msg: 'Flotte nicht gefunden.' };
  const p = planetById(g, planetId);
  if (!p) return { ok: false, msg: 'Planet nicht gefunden.' };
  if (p.owner) return { ok: false, msg: 'Der Planet ist bereits besiedelt.' };
  if (p.systemId !== f.system) return { ok: false, msg: 'Die Flotte ist nicht im System.' };
  if (f.ships.ark <= 0) return { ok: false, msg: 'Keine Arche in der Flotte.' };
  if (!PLANET_TYPES[p.type].colonizable) return { ok: false, msg: 'Diese Welt ist nicht kolonisierbar.' };
  const cost = 25;
  const emp = g.empires[f.owner];
  if (emp.influence < cost) return { ok: false, msg: `Es fehlen Einfluss (${cost}).` };
  emp.influence -= cost;
  f.ships.ark -= 1;
  f.hp.ark = Math.max(0, f.hp.ark - SHIP_CLASSES.ark.hull);
  if (f.hp.ark <= 1) {
    f.hp.ark = 0;
    f.ships.ark = 0;
  }
  p.owner = f.owner;
  p.pop = 1;
  for (const b of BUILDING_ORDER) p.buildings[b] = 0;
  p.queue = null;
  p.progress = 0;
  p.siege = 0;
  refreshOwner(g.systems[p.systemId]);
  revealFor(g, f.owner);
  log(g, `${p.name} wird von der ${FACTIONS_BY_ID[f.owner].short} besiedelt.`, 'good');
  return { ok: true, msg: `${p.name} kolonisiert.` };
}

export function refreshOwner(sys: StarSystem): void {
  const owners = new Set(sys.planets.filter((p) => p.owner).map((p) => p.owner as FactionId));
  if (owners.size === 0) sys.owner = null;
  else if (owners.size === 1) sys.owner = [...owners][0];
  else {
    // contested: the faction with the most population holds the sector
    let best: FactionId | null = null;
    let bestPop = -1;
    for (const o of owners) {
      const pop = sys.planets.filter((p) => p.owner === o).reduce((s, p) => s + p.pop, 0);
      if (pop > bestPop) {
        bestPop = pop;
        best = o;
      }
    }
    sys.owner = best;
  }
}

export function revealFor(g: Game, id: FactionId): void {
  for (const s of g.systems) {
    if (s.owner === id) {
      s.explored[id] = true;
      for (const n of s.links) g.systems[n].explored[id] = true;
    }
  }
  for (const f of g.fleets) {
    if (f.owner !== id) continue;
    const s = g.systems[f.system];
    s.explored[id] = true;
    for (const n of s.links) g.systems[n].explored[id] = true;
  }
  // intelligence sharing inside an alliance
  for (const other of FACTION_IDS) {
    if (other === id) continue;
    if (stateOf(g, id, other) !== 'alliance') continue;
    for (const s of g.systems) if (s.owner === other) s.explored[id] = true;
  }
}

// ---------------------------------------------------------------------------
// combat
// ---------------------------------------------------------------------------
function applyDamage(f: Fleet, dmg: number): number {
  const total = hullOf(f);
  if (total <= 0 || dmg <= 0) return 0;
  const before = shipCount(f);
  const ratio = Math.min(1, dmg / total);
  for (const c of SHIP_IDS) {
    f.hp[c] = Math.max(0, f.hp[c] * (1 - ratio));
    if (f.hp[c] > 1e-4) {
      f.ships[c] = Math.ceil(f.hp[c] / SHIP_CLASSES[c].hull);
      f.hp[c] = Math.min(f.hp[c], f.ships[c] * SHIP_CLASSES[c].hull);
    } else {
      f.hp[c] = 0;
      f.ships[c] = 0;
    }
  }
  return before - shipCount(f);
}

function retreat(g: Game, f: Fleet, from: number): StarSystem | null {
  const options = g.systems[from].links
    .map((id) => g.systems[id])
    .filter((s) => s.owner === f.owner || (s.owner === null && s.planets.some((p) => p.owner === f.owner)));
  const target = options[0] ?? (g.systems[f.home].owner === f.owner ? g.systems[f.home] : null);
  if (!target || target.id === from) return null;
  f.system = target.id;
  f.path = [];
  f.step = 0;
  f.wait = 0;
  f.ships.ark = 0;
  f.hp.ark = 0;
  return target;
}

function runBattle(g: Game, sys: StarSystem, a: Fleet, b: Fleet): BattleRecord {
  const ma = empireMods(g, a.owner);
  const mb = empireMods(g, b.owner);
  const aStart = { ...a.ships };
  const bStart = { ...b.ships };
  const aStartHull = hullOf(a);
  const bStartHull = hullOf(b);
  const defense = sys.owner === b.owner ? defenseOfSystem(sys).power : 0;
  const rounds: BattleRecord['rounds'] = [];

  for (let round = 0; round < 8; round++) {
    const aPower = fleetPower(g, a, ma);
    const bPower = fleetPower(g, b, mb) + defense;
    if (aPower <= 0 || bPower <= 0) break;
    const dmgToA = bPower * 2.1 * (0.85 + Math.random() * 0.3);
    const dmgToB = aPower * 2.1 * (0.85 + Math.random() * 0.3);
    applyDamage(a, dmgToA);
    applyDamage(b, dmgToB);
    rounds.push({ a: dmgToB, b: dmgToA, aHull: hullOf(a), bHull: hullOf(b) });
    if (hullOf(a) <= aStartHull * 0.12 || hullOf(b) <= bStartHull * 0.12) break;
  }

  const aAlive = shipCount(a) > 0;
  const bAlive = shipCount(b) > 0;
  let winner: FactionId | null = null;
  if (aAlive && !bAlive) winner = a.owner;
  else if (bAlive && !aAlive) winner = b.owner;
  else if (aAlive && bAlive) {
    const aFrac = hullOf(a) / Math.max(1, aStartHull);
    const bFrac = hullOf(b) / Math.max(1, bStartHull);
    winner = aFrac >= bFrac ? a.owner : b.owner;
  }

  const aEnd = { ...a.ships };
  const bEnd = { ...b.ships };

  // the losing side disengages if it still has hulls
  const loser = winner === a.owner ? b : winner === b.owner ? a : null;
  if (loser && shipCount(loser) > 0) {
    const target = retreat(g, loser, sys.id);
    if (!target) {
      for (const c of SHIP_IDS) {
        loser.ships[c] = 0;
        loser.hp[c] = 0;
      }
    } else {
      log(g, `${loser.name} zieht sich nach ${target.name} zurück.`, 'war');
    }
  }

  const destroyed: Record<string, number> = {};
  destroyed[a.owner] = SHIP_IDS.reduce((s, c) => s + Math.max(0, aStart[c] - aEnd[c]), 0);
  destroyed[b.owner] = SHIP_IDS.reduce((s, c) => s + Math.max(0, bStart[c] - bEnd[c]), 0);

  for (const f of g.fleets) {
    if (shipCount(f) === 0) f.path = [];
  }

  return {
    system: sys.id,
    systemName: sys.name,
    attacker: a.owner,
    defender: b.owner,
    rounds,
    winner,
    destroyed,
    invaded: false,
    aStart,
    bStart,
    aEnd,
    bEnd,
    defense: Math.round(defense),
  };
}

function resolveSystemBattles(g: Game, sys: StarSystem): BattleRecord[] {
  const out: BattleRecord[] = [];
  for (let guard = 0; guard < 5; guard++) {
    const local = g.fleets.filter((f) => f.system === sys.id && shipCount(f) > 0 && f.ships.ark + f.ships.scout < shipCount(f));
    let pair: [Fleet, Fleet] | null = null;
    for (let i = 0; i < local.length && !pair; i++) {
      for (let j = i + 1; j < local.length; j++) {
        if (local[i].owner !== local[j].owner && atWar(g, local[i].owner, local[j].owner)) {
          pair = [local[i], local[j]];
          break;
        }
      }
    }
    if (!pair) break;
    const rec = runBattle(g, sys, pair[0], pair[1]);
    out.push(rec);
    if (rec.winner) {
      const who = rec.winner;
      log(
        g,
        `Schlacht um ${sys.name}: ${FACTIONS_BY_ID[who].short} siegt — ${rec.destroyed[rec.attacker] + rec.destroyed[rec.defender]} Schiffe zerstört.`,
        'war',
      );
    }
  }
  return out;
}

function resolveInvasions(g: Game, sys: StarSystem): void {
  for (const planet of sys.planets) {
    if (!planet.owner) continue;
    const defenders = g.fleets.filter((f) => f.system === sys.id && f.owner === planet.owner && shipCount(f) > 0);
    if (defenders.length > 0) continue;
    for (const f of g.fleets) {
      if (f.owner === planet.owner || f.system !== sys.id || shipCount(f) === 0) continue;
      if (!atWar(g, f.owner, planet.owner)) continue;
      const ground = SHIP_IDS.reduce((s, c) => s + f.ships[c] * SHIP_CLASSES[c].garrison, 0);
      if (ground <= 0) continue;
      planet.siege += ground * 0.5;
      const def = colonyDefense(planet);
      if (planet.siege >= def) {
        const old = planet.owner;
        planet.owner = f.owner;
        planet.pop = Math.max(1, Math.round(planet.pop * 0.6));
        planet.siege = 0;
        planet.queue = null;
        planet.progress = 0;
        planet.buildings.bastion = 0;
        refreshOwner(sys);
        revealFor(g, f.owner);
        log(g, `${planet.name} fällt an die ${FACTIONS_BY_ID[f.owner].short}. ${FACTIONS_BY_ID[old].short} verliert die Kolonie.`, 'war');
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// cycle resolution
// ---------------------------------------------------------------------------
function advanceColonies(g: Game, id: FactionId): void {
  const mods = empireMods(g, id);
  const growth = FACTIONS_BY_ID[id].mods.growth;
  for (const p of planetsOf(g, id)) {
    const cap = colonyCap(p);
    if (p.pop < cap) p.pop = Math.min(cap, p.pop + 0.14 * growth * (1 - p.pop / Math.max(1, cap)));
    if (p.queue) {
      p.progress += 1;
      const time =
        p.queue.kind === 'building' ? BUILDINGS[p.queue.id].buildTime : SHIP_CLASSES[p.queue.id].buildTime;
      if (p.progress >= time) {
        if (p.queue.kind === 'building') {
          p.buildings[p.queue.id] += 1;
          log(g, `${BUILDINGS[p.queue.id].name} fertiggestellt auf ${p.name}.`, 'good');
        } else {
          mergeShip(g, id, p.systemId, p.queue.id);
          log(g, `${SHIP_CLASSES[p.queue.id].name} läuft aus der Werft von ${p.name} aus.`, 'good');
        }
        p.queue = null;
        p.progress = 0;
      }
    }
  }
  // repair fleets in friendly space
  for (const f of g.fleets) {
    if (f.owner !== id || f.path.length > 0) continue;
    if (g.systems[f.system].owner !== id) continue;
    for (const c of SHIP_IDS) {
      const max = f.ships[c] * SHIP_CLASSES[c].hull * mods.hull;
      if (f.hp[c] < max) f.hp[c] = Math.min(max, f.hp[c] + SHIP_CLASSES[c].hull * 0.22);
    }
  }
}

function runResearch(g: Game, id: FactionId, points: number): void {
  const emp = g.empires[id];
  const branches = BRANCH_ORDER.filter((b) => emp.active[b]);
  if (!branches.length) return;
  const each = points / branches.length;
  for (const b of branches) {
    const techId = emp.active[b];
    if (!techId) continue;
    const def = TECH_BY_ID[techId];
    if (!def) continue;
    emp.progress[b] += each;
    if (emp.progress[b] >= def.cost) {
      emp.progress[b] -= def.cost;
      emp.techs.push(techId);
      const next = TECHS_BY_BRANCH[b].find((t) => t.tier === def.tier + 1);
      emp.active[b] = next ? next.id : null;
      log(g, `${FACTIONS_BY_ID[id].short} schließt „${def.name}“ ab.`, 'science');
      if (!next) emp.progress[b] = 0;
    }
  }
}

function moveFleets(g: Game): void {
  for (const f of g.fleets) {
    if (f.path.length === 0) continue;
    if (f.wait > 0) {
      f.wait -= 1;
      continue;
    }
    f.system = f.path[f.step];
    f.step += 1;
    g.systems[f.system].explored[f.owner] = true;
    for (const n of g.systems[f.system].links) g.systems[n].explored[f.owner] = true;
    if (f.step >= f.path.length) {
      f.path = [];
      f.step = 0;
      f.wait = 0;
    } else {
      f.wait = hopCost(g, f);
    }
  }
}

function aiResearch(g: Game, id: FactionId): void {
  const emp = g.empires[id];
  const priority: Branch[] = ['civic', 'flux', 'vector', 'aegis'];
  for (const b of priority) {
    if (emp.active[b]) continue;
    const next = TECHS_BY_BRANCH[b].find((t) => !emp.techs.includes(t.id));
    if (next) emp.active[b] = next.id;
  }
}

function aiBuild(g: Game, id: FactionId): void {
  const emp = g.empires[id];
  const colonies = planetsOf(g, id);
  if (!colonies.length) return;
  const mods = empireMods(g, id);
  const free = colonies.filter((p) => !p.queue);
  if (!free.length) return;
  const target = free[0];

  if (target.buildings.shipyard === 0) {
    if (emp.alloy > BUILDINGS.shipyard.alloy + 40) queueBuilding(g, target.id, 'shipyard');
    return;
  }
  const wantArk = colonies.length < 5 && !g.fleets.some((f) => f.owner === id && f.ships.ark > 0) &&
    !colonies.some((p) => p.queue?.kind === 'ship' && p.queue.id === 'ark');
  if (wantArk && canBuildShip(g, id, 'ark') && emp.alloy > 320) {
    queueShip(g, target.id, 'ark');
    return;
  }
  const roll = Math.random();
  if (emp.alloy > 520 && roll < 0.45) {
    queueBuilding(g, target.id, colonyCap(target) - target.pop < 2 ? 'habitat' : 'lab');
    return;
  }
  if (emp.alloy > 260) {
    const options: ShipId[] = ['corvette', 'corvette', 'cruiser'];
    const cls = options[Math.floor(Math.random() * options.length)];
    if (canBuildShip(g, id, cls)) {
      queueShip(g, target.id, cls);
      return;
    }
  }
  if (emp.alloy > 200) {
    const b: BuildingId = target.buildings.mine < 2 ? 'mine' : target.buildings.reactor < 2 ? 'reactor' : 'lab';
    queueBuilding(g, target.id, b);
  }
  void mods;
}

function aiFleets(g: Game, id: FactionId): void {
  const mine = g.fleets.filter((f) => f.owner === id && shipCount(f) > 0);
  if (!mine.length) return;
  const enemyIds = FACTION_IDS.filter((o) => o !== id && g.empires[o].alive && stateOf(g, id, o) === 'war');
  const mods = empireMods(g, id);

  for (const f of mine) {
    if (f.path.length > 0) continue;
    // 1) colonise when an ark is aboard
    if (f.ships.ark > 0) {
      const sys = g.systems[f.system];
      const target = sys.planets.find((p) => !p.owner && PLANET_TYPES[p.type].colonizable);
      if (target) {
        colonize(g, f.id, target.id);
        continue;
      }
      const candidate = g.systems
        .filter((s) => s.explored[id] && s.planets.some((p) => !p.owner && PLANET_TYPES[p.type].colonizable))
        .sort((a, b) => a.links.length - b.links.length)[0];
      if (candidate && candidate.id !== f.system) {
        orderMove(g, f.id, candidate.id);
        continue;
      }
    }
    // 2) war: strike the weakest reachable enemy system
    if (enemyIds.length) {
      const power = fleetPower(g, f, mods);
      const targets = g.systems.filter((s) => s.owner && enemyIds.includes(s.owner) && s.explored[id]);
      const scored = targets
        .map((s) => ({ s, d: pathTo(g, f.system, s.id)?.length ?? 99, def: defenseOfSystem(s).hull }))
        .filter((t) => t.d < 90)
        .sort((a, b) => a.def - b.def);
      const best = scored[0];
      if (best && (best.def < power * 1.1 || Math.random() > 0.55)) {
        orderMove(g, f.id, best.s.id);
        continue;
      }
    }
    // 3) explore the nearest unknown system
    if (f.ships.scout > 0 || Math.random() < 0.4) {
      const unknown = g.systems
        .filter((s) => !s.explored[id])
        .map((s) => ({ s, d: pathTo(g, f.system, s.id)?.length ?? 99 }))
        .sort((a, b) => a.d - b.d)[0];
      if (unknown && unknown.d < 12) {
        orderMove(g, f.id, unknown.s.id);
        continue;
      }
    }
    // 4) regroup at the capital
    const capitalPlanet = planetById(g, g.empires[id].capital);
    if (capitalPlanet && f.system !== capitalPlanet.systemId && Math.random() < 0.5) {
      orderMove(g, f.id, capitalPlanet.systemId);
    }
  }
}

function aiDiplomacy(g: Game, id: FactionId): void {
  for (const other of FACTION_IDS) {
    if (other === id || !g.empires[other].alive) continue;
    const st = stateOf(g, id, other);
    const rel = relOf(g, id, other);
    if (st === 'war' && g.cycle % 9 === 0) {
      const mySystems = systemsOf(g, id).length;
      const theirSystems = systemsOf(g, other).length;
      if (theirSystems > mySystems * 1.35 && Math.random() < 0.5) {
        g.states[relationKey(id, other)] = 'peace';
        setRelation(g, id, other, Math.max(-20, rel + 10));
        log(g, `${FACTIONS_BY_ID[id].short} bittet die ${FACTIONS_BY_ID[other].short} um Frieden.`, 'info');
      }
    }
    if (st === 'peace' && g.cycle > 18 && g.cycle % 11 === 0) {
      const my = systemsOf(g, id).length + g.fleets.filter((f) => f.owner === id).length;
      const their = systemsOf(g, other).length;
      if (rel < -22 && my > their * 1.25 && Math.random() < 0.6) {
        g.states[relationKey(id, other)] = 'war';
        setRelation(g, id, other, rel - 45);
        log(g, `${FACTIONS_BY_ID[id].short} erklärt der ${FACTIONS_BY_ID[other].short} den Krieg.`, 'war');
      }
    }
  }
}

export function diplo(
  g: Game,
  actor: FactionId,
  other: FactionId,
  action: 'gift' | 'pact' | 'alliance' | 'war' | 'peace',
): { ok: boolean; msg: string } {
  const emp = g.empires[actor];
  const rel = relOf(g, actor, other);
  const st = stateOf(g, actor, other);
  const charm = FACTIONS_BY_ID[actor].mods.diplomacy;
  if (emp.energy < 0) return { ok: false, msg: 'Keine Reserve.' };
  switch (action) {
    case 'gift': {
      if (emp.energy < 40) return { ok: false, msg: 'Es fehlen 40 Energie.' };
      emp.energy -= 40;
      setRelation(g, actor, other, rel + 14 * charm);
      log(g, `Geschenk an die ${FACTIONS_BY_ID[other].short}: Beziehungen verbessert.`, 'good');
      return { ok: true, msg: 'Geschenk überbracht.' };
    }
    case 'pact': {
      if (st !== 'peace') return { ok: false, msg: 'Nur im Frieden möglich.' };
      if (emp.influence < 20) return { ok: false, msg: 'Es fehlen 20 Einfluss.' };
      if (rel < 22) return { ok: false, msg: 'Die Beziehungen sind zu kühl (mind. 22).' };
      emp.influence -= 20;
      g.states[relationKey(actor, other)] = 'pact';
      log(g, `Nichtangriffspakt mit den ${FACTIONS_BY_ID[other].short} geschlossen.`, 'good');
      return { ok: true, msg: 'Pakt geschlossen.' };
    }
    case 'alliance': {
      if (rel < 62) return { ok: false, msg: 'Ein Bündnis braucht mind. 62 Beziehung.' };
      if (emp.influence < 40) return { ok: false, msg: 'Es fehlen 40 Einfluss.' };
      emp.influence -= 40;
      g.states[relationKey(actor, other)] = 'alliance';
      revealFor(g, actor);
      revealFor(g, other);
      log(g, `Bündnis mit den ${FACTIONS_BY_ID[other].short} ratifiziert.`, 'good');
      return { ok: true, msg: 'Bündnis geschlossen.' };
    }
    case 'war': {
      if (st === 'war') return { ok: false, msg: 'Ihr führt bereits Krieg.' };
      g.states[relationKey(actor, other)] = 'war';
      setRelation(g, actor, other, rel - 45);
      log(g, `${FACTIONS_BY_ID[actor].short} erklärt der ${FACTIONS_BY_ID[other].short} den Krieg.`, 'war');
      return { ok: true, msg: 'Kriegserklärung übermittelt.' };
    }
    case 'peace': {
      if (st !== 'war') return { ok: false, msg: 'Ihr befindet euch nicht im Krieg.' };
      if (emp.influence < 15) return { ok: false, msg: 'Es fehlen 15 Einfluss.' };
      const willing = rel > -45 || Math.random() < 0.45;
      emp.influence -= 15;
      if (!willing) {
        log(g, `Die ${FACTIONS_BY_ID[other].short} lehnt Frieden ab.`, 'bad');
        return { ok: false, msg: 'Der Gegner lehnt ab.' };
      }
      g.states[relationKey(actor, other)] = 'peace';
      setRelation(g, actor, other, Math.max(-30, rel + 12));
      log(g, `Frieden mit den ${FACTIONS_BY_ID[other].short}.`, 'good');
      return { ok: true, msg: 'Frieden geschlossen.' };
    }
    default:
      return { ok: false, msg: 'Unbekannte Aktion.' };
  }
}

function checkVictory(g: Game): void {
  if (g.victory) return;
  const player = g.empires[g.player];
  const systems = systemsOf(g, g.player).length;
  const aliveOthers = FACTION_IDS.filter((o) => o !== g.player && g.empires[o].alive);
  const playerPlanets = planetsOf(g, g.player).length;
  const hasArk = g.fleets.some((f) => f.owner === g.player && (f.ships.ark > 0 || f.ships.corvette + f.ships.cruiser + f.ships.dreadnought > 0));
  const buildingArk = g.systems.some((s) =>
    s.planets.some((p) => p.owner === g.player && p.queue?.kind === 'ship' && p.queue.id === 'ark'),
  );

  if (systems >= WIN_SYSTEMS) {
    g.victory = { faction: g.player, kind: 'Hegemonie — 15 Sektoren unter einem Banner' };
  } else if (aliveOthers.length === 0) {
    g.victory = { faction: g.player, kind: 'Alleinherrschaft — kein Rivale mehr' };
  } else if (player.techs.length >= WIN_TECHS) {
    g.victory = { faction: g.player, kind: `Aeterna-Protokoll — ${WIN_TECHS} Forschungen abgeschlossen` };
  } else if (playerPlanets === 0 && !hasArk && !buildingArk) {
    g.victory = { faction: g.player, kind: 'Ausgelöscht — die Flotte ist fort, die Kolonien sind verloren' };
  } else if (g.cycle > MAX_CYCLES) {
    g.victory = { faction: g.player, kind: 'Erschöpfung — der Zyklus endet ohne Entscheidung' };
  }
}

export function endCycle(g: Game): BattleRecord[] {
  if (g.victory) return [];
  g.battles = [];

  for (const id of FACTION_IDS) {
    const emp = g.empires[id];
    if (!emp.alive) continue;
    const inc = incomeOf(g, id);
    emp.energy = Math.max(0, emp.energy + inc.energy - inc.upkeep);
    emp.alloy += inc.alloy;
    // Influence scales with the size of the realm: 22 controlled sectors is the
    // advertised victory, so expansion must not stall for lack of a currency.
    emp.influence = Math.min(180, emp.influence + (2.2 + systemsOf(g, id).length * 0.45) * empireMods(g, id).influence);
    runResearch(g, id, inc.research);
    advanceColonies(g, id);
    if (planetsOf(g, id).length === 0 && !g.fleets.some((f) => f.owner === id)) {
      emp.alive = false;
      emp.eliminated = true;
      log(g, `Die ${FACTIONS_BY_ID[id].short} existiert nicht mehr.`, 'bad');
    }
  }

  for (const id of FACTION_IDS) {
    if (!g.empires[id].alive || id === g.player) continue;
    aiResearch(g, id);
    aiBuild(g, id);
    aiDiplomacy(g, id);
    aiFleets(g, id);
  }

  moveFleets(g);

  for (const sys of g.systems) {
    const battles = resolveSystemBattles(g, sys);
    if (battles.length) {
      g.battles.push(...battles);
      resolveInvasions(g, sys);
    }
  }

  g.fleets = g.fleets.filter((f) => shipCount(f) > 0);
  for (const id of FACTION_IDS) revealFor(g, id);

  // relations drift home and pacts cool down
  for (const key of Object.keys(g.states)) {
    const [a, b] = key.split('|') as [FactionId, FactionId];
    const st = g.states[key];
    const rel = g.relations[key] ?? 0;
    if (st === 'war') g.relations[key] = Math.min(100, rel + 1.2);
    else g.relations[key] = rel + (st === 'alliance' ? 0.8 : st === 'pact' ? 0.4 : 0.15);
    if (g.relations[key] > 100) g.relations[key] = 100;
    void a;
    void b;
  }

  g.cycle += 1;
  checkVictory(g);
  return g.battles;
}

export function playerEmpire(g: Game) {
  return g.empires[g.player];
}

export function powerOf(g: Game, id: FactionId): number {
  const mods = empireMods(g, id);
  return g.fleets.filter((f) => f.owner === id).reduce((s, f) => s + fleetPower(g, f, mods), 0);
}

export function systemStrength(g: Game, sys: StarSystem): number {
  return g.fleets.filter((f) => f.system === sys.id).reduce((s, f) => s + fleetPower(g, f), 0) + defenseOfSystem(sys).hull * 0.4;
}
