import { FACTIONS_BY_ID, FACTION_IDS, MAX_CYCLES, SHIP_ORDER } from '../../src/data';
import { createGame, planetsOf, systemsOf } from '../../src/galaxy';
import { mulberry32 } from '../../src/rng';
import { endCycle, incomeOf, powerOf } from '../../src/sim';
import type { EmpireProfile, FactionId, Game } from '../../src/types';

/**
 * Self-play matrix for the real simulation. It deliberately uses the same
 * createGame/endCycle path as the game, only enabling the existing empire AI
 * for the player slot as well. The page is a test surface, not a second game
 * mode or a second persistence path.
 */
export interface SelfPlayScenario {
  id: string;
  label: string;
  profile: EmpireProfile;
}

export const SELFPLAY_SCENARIOS: SelfPlayScenario[] = [
  {
    id: 'void-research',
    label: 'Leerenforschung',
    profile: {
      shipClass: 'frigate',
      traits: ['voidborn', 'adaptable'],
      government: 'technocracy',
      worldview: 'enlightened',
      religion: 'void',
    },
  },
  {
    id: 'iron-war',
    label: 'Eiserne Kriegsfront',
    profile: {
      shipClass: 'destroyer',
      traits: ['martial', 'relentless'],
      government: 'autocracy',
      worldview: 'militarist',
      religion: 'flame',
    },
  },
  {
    id: 'golden-trade',
    label: 'Goldene Handelspolitik',
    profile: {
      shipClass: 'destroyer',
      traits: ['mercantile', 'diplomats'],
      government: 'republic',
      worldview: 'mercantile',
      religion: 'solar',
    },
  },
  {
    id: 'deep-defense',
    label: 'Tiefenverteidigung',
    profile: {
      shipClass: 'destroyer',
      traits: ['voidborn', 'diplomats'],
      government: 'republic',
      worldview: 'pragmatic',
      religion: 'secular',
    },
  },
  {
    id: 'civic-republic',
    label: 'Bürgerrepublik',
    profile: {
      shipClass: 'frigate',
      traits: ['adaptable', 'diplomats'],
      government: 'republic',
      worldview: 'pragmatic',
      religion: 'balance',
    },
  },
  {
    id: 'ash-expansion',
    label: 'Ascheexpansion',
    profile: {
      shipClass: 'destroyer',
      traits: ['martial', 'mercantile'],
      government: 'clan',
      worldview: 'expansionist',
      religion: 'flame',
    },
  },
];

export interface SelfPlayConfig {
  mode?: string;
  seeds?: number[];
  factions?: FactionId[];
  profileIds?: string[];
  maxCycles?: number;
  opponents?: boolean;
}

export type MatchOutcome = 'win' | 'loss' | 'draw';

export interface MatchResult {
  id: string;
  mode: string;
  seed: number;
  faction: FactionId;
  factionName: string;
  profileId: string;
  profileLabel: string;
  outcome: MatchOutcome;
  victoryKind: string | null;
  winnerFaction: FactionId | null;
  playerEliminated: boolean;
  cycles: number;
  victoryCycle: number | null;
  techs: number;
  systems: number;
  planets: number;
  fleets: number;
  power: number;
  aliveRivals: number;
  battleCount: number;
  income: number;
  netIncome: number;
  incomeShare: number;
  maxSystems: number;
  finalStandings: { faction: FactionId; name: string; systems: number; planets: number; techs: number; alive: boolean }[];
  anomalies: string[];
  error: string | null;
}

export interface SummaryBucket {
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  errors: number;
  anomalies: number;
  winRate: number;
  drawRate: number;
  averageCycles: number;
  averageVictoryCycle: number | null;
  averageTechs: number;
  averageSystems: number;
  averagePlanets: number;
  averageBattles: number;
  averageAliveRivals: number;
}

export interface SelfPlayReport {
  mode: string;
  generatedAt: string;
  config: Required<Pick<SelfPlayConfig, 'seeds' | 'profileIds' | 'maxCycles' | 'opponents'>> & {
    factions: FactionId[];
  };
  summary: SummaryBucket;
  byProfile: Record<string, SummaryBucket>;
  byFaction: Record<string, SummaryBucket>;
  flags: string[];
  matches: MatchResult[];
}

const nativeRandom = Math.random;

function withSeededRandom<T>(seed: number, run: () => T): T {
  Math.random = mulberry32(seed);
  try {
    return run();
  } finally {
    Math.random = nativeRandom;
  }
}

function validateGame(game: Game): string[] {
  const issues: string[] = [];
  const finite = (value: number): boolean => Number.isFinite(value);
  for (const id of FACTION_IDS) {
    const empire = game.empires[id];
    if (!empire) {
      issues.push(`empire ${id} missing`);
      continue;
    }
    if (!finite(empire.energy) || !finite(empire.alloy) || !finite(empire.influence)) {
      issues.push(`empire ${id} has non-finite resources`);
    }
    if (empire.energy < 0 || empire.alloy < 0 || empire.influence < 0) {
      issues.push(`empire ${id} has negative resources`);
    }
    if (empire.profileMods) {
      for (const key of ['attack', 'hull', 'income', 'research', 'influence'] as const) {
        if (!finite(empire.profileMods[key])) issues.push(`empire ${id} has non-finite ${key} modifier`);
      }
    }
  }

  for (const fleet of game.fleets) {
    if (!game.systems[fleet.system]) {
      issues.push(`fleet ${fleet.id} is in missing system ${fleet.system}`);
      continue;
    }
    for (const cls of SHIP_ORDER) {
      const count = fleet.ships[cls] ?? 0;
      const hp = fleet.hp[cls] ?? 0;
      if (!finite(count) || count < 0 || !Number.isInteger(count)) {
        issues.push(`fleet ${fleet.id} has invalid ${cls} count ${count}`);
      }
      if (!finite(hp) || hp < 0) {
        issues.push(`fleet ${fleet.id} has invalid ${cls} hp ${hp}`);
      }
    }
  }
  return issues.slice(0, 8);
}

function outcomeOf(victory: Game['victory'], player: FactionId, playerAlive: boolean): MatchOutcome {
  if (!victory) return 'draw';
  if (victory.kind.includes('Ausgelöscht')) return 'loss';
  if (victory.kind.includes('Erschöpfung')) return playerAlive ? 'draw' : 'loss';
  return victory.faction === player ? 'win' : 'loss';
}

function decisiveWinner(victory: Game['victory']): FactionId | null {
  if (!victory) return null;
  if (victory.kind.includes('Erschöpfung') || victory.kind.includes('Ausgelöscht')) return null;
  return victory.faction;
}

function emptyBucket(): SummaryBucket {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    errors: 0,
    anomalies: 0,
    winRate: 0,
    drawRate: 0,
    averageCycles: 0,
    averageVictoryCycle: null,
    averageTechs: 0,
    averageSystems: 0,
    averagePlanets: 0,
    averageBattles: 0,
    averageAliveRivals: 0,
  };
}

function addToBucket(bucket: SummaryBucket, result: MatchResult): void {
  bucket.matches += 1;
  if (result.outcome === 'win') bucket.wins += 1;
  else if (result.outcome === 'loss') bucket.losses += 1;
  else bucket.draws += 1;
  if (result.error) bucket.errors += 1;
  bucket.anomalies += result.anomalies.length;
}

function finishBucket(bucket: SummaryBucket, results: MatchResult[]): void {
  bucket.winRate = bucket.matches ? bucket.wins / bucket.matches : 0;
  bucket.drawRate = bucket.matches ? bucket.draws / bucket.matches : 0;
  bucket.averageCycles = bucket.matches
    ? results.reduce((sum, result) => sum + result.cycles, 0) / bucket.matches
    : 0;
  const wins = results.filter((result) => result.victoryCycle !== null && result.winnerFaction !== null);
  bucket.averageVictoryCycle = wins.length
    ? wins.reduce((sum, result) => sum + (result.victoryCycle ?? 0), 0) / wins.length
    : null;
  const average = (value: (result: MatchResult) => number): number =>
    results.length ? results.reduce((sum, result) => sum + value(result), 0) / results.length : 0;
  bucket.averageTechs = average((result) => result.techs);
  bucket.averageSystems = average((result) => result.systems);
  bucket.averagePlanets = average((result) => result.planets);
  bucket.averageBattles = average((result) => result.battleCount);
  bucket.averageAliveRivals = average((result) => result.aliveRivals);
}

function aggregate(results: MatchResult[], keyOf: (result: MatchResult) => string): Record<string, SummaryBucket> {
  const groups = new Map<string, MatchResult[]>();
  for (const result of results) {
    const key = keyOf(result);
    const group = groups.get(key) ?? [];
    group.push(result);
    groups.set(key, group);
  }
  const out: Record<string, SummaryBucket> = {};
  for (const [key, group] of groups) {
    const bucket = emptyBucket();
    for (const result of group) addToBucket(bucket, result);
    finishBucket(bucket, group);
    out[key] = bucket;
  }
  return out;
}

function runMatch(
  mode: string,
  scenario: SelfPlayScenario,
  scenarioIndex: number,
  faction: FactionId,
  seed: number,
  maxCycles: number,
  opponents: boolean,
): MatchResult {
  const opponentProfiles: Partial<Record<FactionId, EmpireProfile>> = {};
  if (opponents) {
    const factionIndex = FACTION_IDS.indexOf(faction);
    for (const [index, id] of FACTION_IDS.entries()) {
      if (id === faction) continue;
      // Every AI power gets a different known profile. Rotating by seed and
      // faction prevents one fixed opponent archetype from dominating all runs.
      const pick = SELFPLAY_SCENARIOS[(scenarioIndex + index + factionIndex + seed) % SELFPLAY_SCENARIOS.length];
      if (pick) opponentProfiles[id] = pick.profile;
    }
  }

  return withSeededRandom(seed, () => {
    const anomalies = new Set<string>();
    let battleCount = 0;
    let game: Game;
    try {
      game = createGame(seed, faction, scenario.profile, opponents ? opponentProfiles : null);
      while (!game.victory && game.cycle <= maxCycles) {
        battleCount += endCycle(game, { aiPlayer: true, allVictories: true }).length;
        if (game.cycle % 7 === 0 || game.victory) {
          for (const issue of validateGame(game)) anomalies.add(issue);
        }
      }
    } catch (error) {
      return {
        id: `${mode}-${scenario.id}-${faction}-${seed}`,
        mode,
        seed,
        faction,
        factionName: FACTIONS_BY_ID[faction]?.name ?? faction,
        profileId: scenario.id,
        profileLabel: scenario.label,
        outcome: 'draw',
        victoryKind: null,
        winnerFaction: null,
        playerEliminated: false,
        cycles: 0,
        victoryCycle: null,
        techs: 0,
        systems: 0,
        planets: 0,
        fleets: 0,
        power: 0,
        aliveRivals: 0,
        battleCount: 0,
        income: 0,
        netIncome: 0,
        incomeShare: 0,
        maxSystems: 0,
        finalStandings: [],
        anomalies: [...anomalies],
        error: error instanceof Error ? error.message : String(error),
      };
    }

    for (const issue of validateGame(game)) anomalies.add(issue);
    if (!game.victory && game.cycle <= maxCycles) anomalies.add('cycle loop exited without a victory or the cycle cap');
    if (game.victory && !FACTION_IDS.includes(game.victory.faction)) anomalies.add('victory belongs to an unknown faction');

    const player = game.empires[faction];
    const economy = incomeOf(game, faction);
    const totalEnergy = FACTION_IDS.reduce(
      (sum, id) => sum + (game.empires[id].alive ? incomeOf(game, id).energy : 0),
      0,
    );
    const maxSystems = Math.max(...FACTION_IDS.map((id) => systemsOf(game, id).length));
    const finalStandings = FACTION_IDS.map((id) => {
      const empire = game.empires[id];
      return {
        faction: id,
        name: FACTIONS_BY_ID[id]?.name ?? id,
        systems: systemsOf(game, id).length,
        planets: planetsOf(game, id).length,
        techs: empire.techs.length,
        alive: empire.alive,
      };
    })
      .sort((a, b) => b.systems - a.systems || b.techs - a.techs || b.planets - a.planets)
      .slice(0, 8);

    return {
      id: `${mode}-${scenario.id}-${faction}-${seed}`,
      mode,
      seed,
      faction,
      factionName: FACTIONS_BY_ID[faction]?.name ?? faction,
      profileId: scenario.id,
      profileLabel: scenario.label,
      outcome: outcomeOf(game.victory, faction, player.alive),
      victoryKind: game.victory?.kind ?? null,
      winnerFaction: decisiveWinner(game.victory),
      playerEliminated: !player.alive,
      cycles: game.cycle - 1,
      victoryCycle: game.victory ? game.cycle - 1 : null,
      techs: player.techs.length,
      systems: systemsOf(game, faction).length,
      planets: planetsOf(game, faction).length,
      fleets: game.fleets.filter((fleet) => fleet.owner === faction).length,
      power: powerOf(game, faction),
      aliveRivals: FACTION_IDS.filter((id) => id !== faction && game.empires[id].alive).length,
      battleCount,
      income: economy.energy,
      netIncome: economy.net,
      incomeShare: totalEnergy > 0 ? economy.energy / totalEnergy : 0,
      maxSystems,
      finalStandings,
      anomalies: [...anomalies],
      error: null,
    };
  });
}

function flagsFor(report: SelfPlayReport): string[] {
  const flags: string[] = [];
  const profileBuckets = Object.entries(report.byProfile);
  const profileRates = profileBuckets.map(([, bucket]) => bucket.winRate);
  if (profileBuckets.length > 1 && Math.max(...profileRates) - Math.min(...profileRates) > 0.4) {
    const best = profileBuckets.reduce((a, b) => (a[1].winRate >= b[1].winRate ? a : b));
    const worst = profileBuckets.reduce((a, b) => (a[1].winRate <= b[1].winRate ? a : b));
    flags.push(
      `Profil-Spreizung ${(best[1].winRate * 100).toFixed(0)} % (${best[0]}) vs. ` +
        `${(worst[1].winRate * 100).toFixed(0)} % (${worst[0]})`,
    );
  }
  if (report.summary.drawRate > 0.35) {
    flags.push(`Zu viele erschöpfte Partien: ${(report.summary.drawRate * 100).toFixed(0)} % Draws`);
  }
  const unclassified = report.matches.filter((match) => !match.victoryKind).length;
  if (unclassified > 0) {
    flags.push(`${unclassified} Partie(n) ohne Sieg-/Endart`);
  }
  const categorySum = report.matches.filter((match) => Boolean(match.victoryKind)).length;
  if (categorySum !== report.summary.matches) {
    flags.push(`Siegarten-Attribution unvollständig: ${categorySum}/${report.summary.matches}`);
  }
  // Every match is a 16-power free-for-all. A fair player slot therefore wins
  // about 1/16 of all games, not 50 %; compare against that field expectation.
  const fieldSize = Math.max(2, report.config.factions.length);
  const expectedWinRate = 1 / fieldSize;
  if (report.summary.winRate < expectedWinRate * 0.4) {
    flags.push(
      `Spieler-KI unter FFA-Erwartung: ${(report.summary.winRate * 100).toFixed(1)} % ` +
        `(Erwartung ${(expectedWinRate * 100).toFixed(1)} % bei ${fieldSize} Mächten)`,
    );
  }
  const kinds = new Map<string, number>();
  for (const match of report.matches) {
    const kind = match.victoryKind ?? 'ohne Sieg';
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  const trueKinds = [...kinds.entries()].filter(
    ([kind]) => !kind.startsWith('Ausgelöscht') && !kind.startsWith('Erschöpfung') && kind !== 'ohne Sieg',
  );
  const substantive = trueKinds.filter(([, count]) => count / report.summary.matches >= 0.05);
  if (report.summary.matches >= 20 && substantive.length < 3) {
    flags.push(`Zu wenige substanzielle Siegarten: ${substantive.length} (mindestens 3 erwartet)`);
  }
  const techKind = 'Aeterna-Protokoll — 48 Forschungen abgeschlossen';
  const techShare = (kinds.get(techKind) ?? 0) / report.summary.matches;
  if (report.summary.matches >= 20 && (techShare < 0.1 || techShare > 0.4)) {
    flags.push(`Technologie-Anteil außerhalb 10–40 %: ${(techShare * 100).toFixed(1)} %`);
  }
  const dominant = trueKinds.sort((a, b) => b[1] - a[1])[0];
  if (dominant && report.summary.matches >= 20 && dominant[1] / report.summary.matches > 0.5) {
    flags.push(`Siegart-Dominanz über 50 %: ${(dominant[1] / report.summary.matches * 100).toFixed(0)} % „${dominant[0]}“`);
  }
  for (const [profile, bucket] of profileBuckets) {
    if (bucket.winRate > expectedWinRate * 2.5) {
      flags.push(`Profil ${profile} über 2,5× Erwartung: ${(bucket.winRate * 100).toFixed(1)} %`);
    }
    if (bucket.winRate < expectedWinRate * 0.4) {
      flags.push(`Profil ${profile} unter 0,4× Erwartung: ${(bucket.winRate * 100).toFixed(1)} %`);
    }
  }
  if (report.summary.errors > 0) flags.push(`${report.summary.errors} Partie(n) mit Laufzeitfehler`);
  if (report.summary.anomalies > 0) flags.push(`${report.summary.anomalies} Zustandsanomalie(n)`);
  return flags;
}

export function runSelfPlay(config: SelfPlayConfig = {}): SelfPlayReport {
  const seeds = (config.seeds?.length ? config.seeds : [17, 4242]).map((value) => value >>> 0);
  const factions = config.factions?.length ? config.factions : FACTION_IDS;
  const scenarios = config.profileIds?.length
    ? SELFPLAY_SCENARIOS.filter((scenario) => config.profileIds?.includes(scenario.id))
    : SELFPLAY_SCENARIOS;
  const maxCycles = Math.max(1, Math.min(MAX_CYCLES, config.maxCycles ?? MAX_CYCLES));
  const opponents = config.opponents !== false;
  const mode = config.mode ?? 'windows';

  const results: MatchResult[] = [];
  for (const seed of seeds) {
    for (const faction of factions) {
      for (const [scenarioIndex, scenario] of scenarios.entries()) {
        const matchSeed = (seed + FACTION_IDS.indexOf(faction) * 7919 + scenarioIndex * 104729) >>> 0;
        results.push(runMatch(mode, scenario, scenarioIndex, faction, matchSeed, maxCycles, opponents));
      }
    }
  }

  const summary = emptyBucket();
  for (const result of results) addToBucket(summary, result);
  finishBucket(summary, results);
  const report: SelfPlayReport = {
    mode,
    generatedAt: new Date().toISOString(),
    config: { seeds, profileIds: scenarios.map((scenario) => scenario.id), maxCycles, opponents, factions },
    summary,
    byProfile: aggregate(results, (result) => result.profileId),
    byFaction: aggregate(results, (result) => result.faction),
    flags: [],
    matches: results,
  };
  report.flags = flagsFor(report);
  return report;
}

declare global {
  interface Window {
    __selfplay?: {
      run: (config?: SelfPlayConfig) => SelfPlayReport;
    };
  }
}

const status = document.getElementById('selfplay-status');
if (status) status.textContent = 'selfplay ready';

window.__selfplay = {
  run: (config?: SelfPlayConfig) => runSelfPlay(config),
};
document.body.dataset.selfplayReady = '1';
