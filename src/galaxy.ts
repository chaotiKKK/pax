import {
  BRANCH_ORDER,
  FACTIONS_BY_ID,
  FACTION_IDS,
  PLANET_TYPES,
  SHIP_CLASSES,
  SHIP_ORDER,
  WIN_COLONIES,
  WIN_ENERGY,
  WIN_SYSTEMS,
  WIN_TECHS,
  WIN_TRADE_TIER,
  emptyBuildings,
} from './data';
import { makeName, mulberry32 } from './rng';
import { profileMods, sanitizeProfile } from './profile';
import { armyTemplateById } from './ships/armies';
import type {
  Branch,
  Empire,
  EmpireProfile,
  FactionId,
  Fleet,
  Game,
  Planet,
  PlanetTypeId,
  ShipId,
  StarSystem,
} from './types';

const SYSTEM_COUNT = 64;

const STAR_CLASSES: { cls: string; color: number; r: number; weight: number }[] = [
  { cls: 'O', color: 0x9fc4ff, r: 2.6, weight: 0.06 },
  { cls: 'B', color: 0xbcd6ff, r: 2.3, weight: 0.1 },
  { cls: 'A', color: 0xffffff, r: 2.0, weight: 0.16 },
  { cls: 'F', color: 0xfff2cf, r: 1.9, weight: 0.2 },
  { cls: 'G', color: 0xffe3a3, r: 1.8, weight: 0.22 },
  { cls: 'K', color: 0xffb877, r: 1.6, weight: 0.16 },
  { cls: 'M', color: 0xff8a6a, r: 1.4, weight: 0.1 },
];

const PLANET_WEIGHTS: { id: PlanetTypeId; w: number }[] = [
  { id: 'terran', w: 10 },
  { id: 'ocean', w: 9 },
  { id: 'arid', w: 9 },
  { id: 'tundra', w: 8 },
  { id: 'jungle', w: 8 },
  { id: 'savanna', w: 9 },
  { id: 'superearth', w: 5 },
  { id: 'arctic', w: 7 },
  { id: 'desert', w: 9 },
  { id: 'relic', w: 3 },
  { id: 'hive', w: 3 },
  { id: 'volcanic', w: 10 },
  { id: 'gas', w: 14 },
  { id: 'barren', w: 16 },
  { id: 'toxic', w: 7 },
  { id: 'crystal', w: 3 },
  { id: 'lava', w: 6 },
  { id: 'icegiant', w: 8 },
];

function pickType(rnd: () => number): PlanetTypeId {
  const total = PLANET_WEIGHTS.reduce((s, p) => s + p.w, 0);
  let r = rnd() * total;
  for (const p of PLANET_WEIGHTS) {
    r -= p.w;
    if (r <= 0) return p.id;
  }
  return 'barren';
}

function pickStar(rnd: () => number) {
  const total = STAR_CLASSES.reduce((s, p) => s + p.weight, 0);
  let r = rnd() * total;
  for (const p of STAR_CLASSES) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return STAR_CLASSES[4];
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function emptyShips(): Record<ShipId, number> {
  return Object.fromEntries(SHIP_ORDER.map((id) => [id, 0])) as Record<ShipId, number>;
}

export function emptyHp(): Record<ShipId, number> {
  return Object.fromEntries(SHIP_ORDER.map((id) => [id, 0])) as Record<ShipId, number>;
}

function emptyExplored(): Record<FactionId, boolean> {
  return Object.fromEntries(FACTION_IDS.map((id) => [id, false])) as Record<FactionId, boolean>;
}

function makeEmpire(id: FactionId, isPlayer: boolean, capital: number): Empire {
  return {
    id,
    isPlayer,
    alive: true,
    energy: 140,
    alloy: 160,
    influence: 20,
    techs: [],
    active: Object.fromEntries(BRANCH_ORDER.map((b) => [b, b === 'flux' ? 'flux1' : null])) as Record<Branch, string | null>,
    progress: Object.fromEntries(BRANCH_ORDER.map((b) => [b, 0])) as Record<Branch, number>,
    capital,
    eliminated: false,
  };
}

function fleetName(id: FactionId, n: number): string {
  const names = ['Speer', 'Schild', 'Auge', 'Klinge', 'Flamme', 'Anker', 'Pfeil', 'Krone', 'Schatten', 'Morgen', 'Woge', 'Zorn'];
  return `${FACTIONS_BY_ID[id].short} ${names[n % names.length]}-${String(100 + n * 7)}`;
}

export function createGame(
  seed: number,
  player: FactionId,
  profile?: EmpireProfile | null,
  opponentProfiles?: Partial<Record<FactionId, EmpireProfile>> | null,
): Game {
  const rnd = mulberry32(seed);
  const used = new Set<string>();
  const systems: StarSystem[] = [];

  // --- positions: three logarithmic arms plus scatter -----------------------
  for (let i = 0; i < SYSTEM_COUNT; i++) {
    const arm = i % 3;
    const t = Math.pow(rnd(), 0.78);
    const radius = 34 + t * 150;
    const baseAngle = (arm * Math.PI * 2) / 3;
    const angle = baseAngle + t * Math.PI * 2.15 + (rnd() - 0.5) * 0.42;
    const jitter = 8 + t * 14;
    systems.push({
      id: i,
      name: makeName(rnd, used),
      pos: {
        x: Math.cos(angle) * radius + (rnd() - 0.5) * jitter,
        y: (rnd() - 0.5) * 20 * (1 - t * 0.4),
        z: Math.sin(angle) * radius + (rnd() - 0.5) * jitter,
      },
      starClass: '',
      starColor: 0,
      starRadius: 1,
      planets: [],
      links: [],
      owner: null,
      explored: emptyExplored(),
      site: 'none',
      laneGlow: 0,
    });
  }

  // --- lanes: k-nearest plus a minimum spanning pass for connectivity ------
  const candidates: { a: number; b: number; d: number }[] = [];
  for (let a = 0; a < systems.length; a++) {
    for (let b = a + 1; b < systems.length; b++) {
      candidates.push({ a, b, d: dist(systems[a].pos, systems[b].pos) });
    }
  }
  candidates.sort((x, y) => x.d - y.d);
  const degree = new Array(systems.length).fill(0);
  const maxDist = 48;
  for (const c of candidates) {
    if (degree[c.a] >= 4 || degree[c.b] >= 4) continue;
    if (c.d > maxDist) continue;
    if (degree[c.a] >= 2 && degree[c.b] >= 2 && rnd() > 0.4) continue;
    systems[c.a].links.push(c.b);
    systems[c.b].links.push(c.a);
    degree[c.a]++;
    degree[c.b]++;
  }
  // connect islands
  const seen = new Set<number>([0]);
  const stack = [0];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of systems[cur].links)
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
  }
  for (let i = 0; i < systems.length; i++) {
    if (seen.has(i)) continue;
    let best = -1;
    let bestD = Infinity;
    for (const s of systems) {
      if (!seen.has(s.id)) continue;
      const d = dist(systems[i].pos, s.pos);
      if (d < bestD) {
        bestD = d;
        best = s.id;
      }
    }
    if (best >= 0) {
      systems[i].links.push(best);
      systems[best].links.push(i);
      seen.add(i);
    }
  }

  // --- stars and worlds ----------------------------------------------------
  let planetId = 0;
  const planetNames = new Set<string>();
  for (const sys of systems) {
    const star = pickStar(rnd);
    sys.starClass = star.cls;
    sys.starColor = star.color;
    sys.starRadius = star.r;
    sys.site = rnd() > 0.84 ? (rnd() > 0.5 ? 'ruin' : 'beacon') : 'none';

    const count = 1 + Math.floor(rnd() * 5.2);
    for (let p = 0; p < count; p++) {
      const type = pickType(rnd);
      const def = PLANET_TYPES[type];
      const size = 0.7 + rnd() * 0.9;
      const orbit = 9 + p * (7.5 + rnd() * 3.4);
      const pname = makeName(rnd, planetNames);
      const planet: Planet = {
        id: planetId++,
        systemId: sys.id,
        name: pname,
        type,
        size,
        orbit,
        angle: rnd() * Math.PI * 2,
        seed: rnd() * 1000,
        habitability: def.habitability,
        yields: {
          energy: Math.round(def.yields.energy * (0.8 + size * 0.35) * 10) / 10,
          alloy: Math.round(def.yields.alloy * (0.8 + size * 0.35) * 10) / 10,
          research: Math.round(def.yields.research * (0.8 + size * 0.35) * 10) / 10,
        },
        owner: null,
        pop: 0,
        buildings: emptyBuildings(),
        queue: null,
        progress: 0,
        siege: 0,
      };
      sys.planets.push(planet);
    }
    sys.planets.sort((a, b) => a.orbit - b.orbit);
  }

  // --- home systems: farthest-point sampling across all powers -------------
  const homes: number[] = [];
  const first = systems.reduce(
    (best, s) => (dist(s.pos, { x: 0, y: 0, z: 0 }) < dist(best.pos, { x: 0, y: 0, z: 0 }) ? s : best),
    systems[0],
  );
  homes.push(first.id);
  while (homes.length < FACTION_IDS.length) {
    let best = -1;
    let bestScore = -1;
    for (const s of systems) {
      if (homes.includes(s.id)) continue;
      let minD = Infinity;
      for (const h of homes) minD = Math.min(minD, dist(s.pos, systems[h].pos));
      if (minD > bestScore) {
        bestScore = minD;
        best = s.id;
      }
    }
    homes.push(best);
  }

  const empires = {} as Record<FactionId, Empire>;
  const fleets: Fleet[] = [];
  const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI'];
  let fid = 1;

  FACTION_IDS.forEach((factionId, index) => {
    const sys = systems[homes[index]];
    // guarantee a good homeworld
    let home = sys.planets[0];
    for (const p of sys.planets) if (p.habitability > home.habitability) home = p;
    home.type = 'terran';
    home.habitability = 1;
    home.size = Math.max(home.size, 1.15);
    home.yields = { energy: 4, alloy: 4, research: 4 };
    home.pop = 7;
    home.owner = factionId;
    home.buildings = emptyBuildings();
    home.buildings.shipyard = 1;
    home.buildings.reactor = 1;
    home.buildings.mine = 1;
    home.buildings.lab = 1;
    home.buildings.habitat = 1;
    home.progress = 0;
    home.name = `${sys.name} ${numerals[index]}`;

    sys.owner = factionId;
    empires[factionId] = makeEmpire(factionId, factionId === player, home.id);

    // Starting flotilla: a founding profile chooses its flagship. Capital
    // hulls are deliberately paired with escorts so a cruiser start is not
    // twice as valuable as a frigate start. The normal game only supplies this
    // for the player; self-play can also give every opponent its own profile so
    // race/doctrine matchups stay comparable.
    const ships = emptyShips();
    const hp = emptyHp();
    const rawProfile = factionId === player ? profile : opponentProfiles?.[factionId];
    const startProfile = rawProfile ? sanitizeProfile(rawProfile) : null;
    if (startProfile) {
      const army = armyTemplateById(startProfile.armyId);
      if (army) {
        // Army Editor template: the player's chosen starting composition.
        // Scout and Ark are always added below, as for every profile.
        for (const c of SHIP_ORDER) {
          const n = army.ships[c] ?? 0;
          if (n > 0) ships[c] = (ships[c] ?? 0) + n;
        }
      } else if (startProfile.shipClass === 'cruiser') {
        ships.cruiser = 1;
        ships.corvette = 2;
      } else {
        // A frigate pair plus one corvette was materially weaker than a
        // destroyer pair (86 vs 156 attack, 670 vs 1040 hull), which made the
        // two frigate profiles systematically underperform. Three frigates
        // plus the escort bring the opening fleet within the same budget.
        ships[startProfile.shipClass] = startProfile.shipClass === 'frigate' ? 3 : 2;
        // The cheaper hulls get a small escort so their opening fleet stays
        // within the same combat budget as a destroyer pair or a cruiser group.
        if (startProfile.shipClass !== 'destroyer') ships.corvette = 1;
      }
      empires[factionId].profile = startProfile;
      empires[factionId].profileMods = profileMods(startProfile);
    } else {
      ships.corvette = 2;
    }
    ships.scout = 1;
    ships.ark = 1;
    for (const c of SHIP_ORDER) {
      if (ships[c] > 0) hp[c] = ships[c] * SHIP_CLASSES[c].hull;
    }
    fleets.push({
      id: fid,
      owner: factionId,
      name: fleetName(factionId, index),
      system: sys.id,
      ships,
      hp,
      path: [],
      step: 0,
      wait: 0,
      home: sys.id,
    });
    fid++;

    // reveal home cluster
    sys.explored[factionId] = true;
    for (const n of sys.links) {
      systems[n].explored[factionId] = true;
      for (const nn of systems[n].links) systems[nn].explored[factionId] = true;
    }
  });

  const relations: Record<string, number> = {};
  const states: Record<string, import('./types').DiploState> = {};
  for (let i = 0; i < FACTION_IDS.length; i++) {
    for (let j = i + 1; j < FACTION_IDS.length; j++) {
      const key = [FACTION_IDS[i], FACTION_IDS[j]].sort().join('|');
      relations[key] = -6;
      states[key] = 'peace';
    }
  }

  return {
    seed,
    cycle: 1,
    player,
    systems,
    fleets,
    empires,
    relations,
    states,
    log: [
      { cycle: 1, kind: 'info', text: `Zyklus 1 — die ${FACTIONS_BY_ID[player].name} tritt in die Leere.` },
      { cycle: 1, kind: 'info', text: `Ziel: ${WIN_SYSTEMS} Sektoren, ${WIN_TECHS} Forschungen, ${WIN_COLONIES} Kolonien mit ${WIN_ENERGY} Energie und Wirtschaftsstufe ${WIN_TRADE_TIER} oder die Rivalen brechen.` },
    ],
    victory: null,
    battles: [],
    nextFleetId: fid,
    influenceGained: 0,
  };
}

export function systemsOf(game: Game, faction: FactionId): StarSystem[] {
  return game.systems.filter((s) => s.owner === faction);
}

export function planetsOf(game: Game, faction: FactionId): Planet[] {
  const out: Planet[] = [];
  for (const s of game.systems) for (const p of s.planets) if (p.owner === faction) out.push(p);
  return out;
}

export function fleetAt(game: Game, systemId: number, owner?: FactionId): Fleet[] {
  return game.fleets.filter((f) => f.system === systemId && (!owner || f.owner === owner));
}

export function tierOf(empire: Empire, branch: Branch): number {
  return empire.techs.filter((t) => t.startsWith(branch)).length;
}

export function newFleet(game: Game, owner: FactionId, system: number): Fleet {
  const n = game.fleets.filter((f) => f.owner === owner).length;
  const f: Fleet = {
    id: game.nextFleetId++,
    owner,
    name: fleetName(owner, n + 3),
    system,
    ships: emptyShips(),
    hp: emptyHp(),
    path: [],
    step: 0,
    wait: 0,
    home: system,
  };
  game.fleets.push(f);
  return f;
}
