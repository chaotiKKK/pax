import { SHIP_CLASSES } from './data';
import type { EmpireProfile, EmpireProfileMods, ShipId } from './types';

/**
 * Founding profile of an empire: starting hull, racial traits, government,
 * worldview and religion. The choices are baked into the created game (the
 * start fleet and `Empire.profileMods`), so a LAN client receives exactly the
 * same values in the host's snapshot.
 */
export interface ProfileOption {
  id: string;
  name: string;
  desc: string;
  sigil: string;
  mods?: Partial<EmpireProfileMods>;
}

export interface StartHull {
  id: ShipId;
  name: string;
  role: string;
  desc: string;
}

export const START_HULL_IDS: ShipId[] = ['scout', 'corvette', 'raider', 'frigate', 'destroyer', 'cruiser'];

export const START_HULLS: StartHull[] = START_HULL_IDS.filter((id) => SHIP_CLASSES[id]).map((id) => ({
  id,
  name: SHIP_CLASSES[id].name,
  role: SHIP_CLASSES[id].role,
  desc: SHIP_CLASSES[id].desc,
}));

export const MAX_TRAITS = 2;

export const RACE_TRAITS: ProfileOption[] = [
  {
    id: 'voidborn',
    name: 'Leerengeboren',
    sigil: '✧',
    desc: 'Jahrhunderte ohne Sonne: Hüllen halten mehr aus, der Handel bleibt vorsichtig.',
    mods: { hull: 1.08, income: 0.97 },
  },
  {
    id: 'psionic',
    name: 'Psionisches Erbe',
    sigil: '✦',
    desc: 'Gedanken reisen vor den Schiffen. Forschung und Feuerleitung profitieren.',
    mods: { research: 1.1, attack: 1.04 },
  },
  {
    id: 'martial',
    name: 'Kriegerkaste',
    sigil: '⚔',
    desc: 'Jede Generation wird an der Waffe geprüft; zivile Forschung bleibt zurück.',
    mods: { attack: 1.1, research: 0.96 },
  },
  {
    id: 'mercantile',
    name: 'Handelsgene',
    sigil: '⛁',
    desc: 'Preise sind die Muttersprache. Dafür sind die Rümpfe schlanker gebaut.',
    mods: { income: 1.1, hull: 0.97 },
  },
  {
    id: 'artificers',
    name: 'Werftgenies',
    sigil: '⚒',
    desc: 'Schweißnähte als Kulturdenkmal: stabilere Hüllen, weniger Überschuss.',
    mods: { hull: 1.1, income: 0.97 },
  },
  {
    id: 'diplomats',
    name: 'Versöhner',
    sigil: '☍',
    desc: 'Ein Wort vor jeder Salve. Einfluss wächst, die Flotte bleibt defensiv.',
    mods: { influence: 1.12, attack: 0.97 },
  },
  {
    id: 'adaptable',
    name: 'Anpassungsfähig',
    sigil: '✺',
    desc: 'Kein Spezialist, kein Schwachpunkt: breite Wirtschaft und breite Forschung.',
    mods: { income: 1.05, research: 1.05 },
  },
  {
    id: 'relentless',
    name: 'Unbeugsam',
    sigil: '⛨',
    desc: 'Rückschläge werden nicht verwaltet, sondern ausgesessen.',
    mods: { hull: 1.07, influence: 1.03, income: 1.04 },
  },
];

export const GOVERNMENTS: ProfileOption[] = [
  {
    id: 'republic',
    name: 'Republik',
    sigil: '◇',
    desc: 'Geteilte Macht, lange Debatten, keine Extreme. Das neutrale Fundament.',
  },
  {
    id: 'autocracy',
    name: 'Autokratie',
    sigil: '♛',
    desc: 'Ein Wille, eine Flotte. Angriff und Einfluss steigen, Forschung wird knapp.',
    mods: { attack: 1.08, influence: 1.05, income: 1.06, research: 0.97 },
  },
  {
    id: 'technocracy',
    name: 'Technokratie',
    sigil: '⌬',
    desc: 'Wer rechnen kann, entscheidet. Forschung beschleunigt, Wirtschaft bremst.',
    mods: { research: 1.1, income: 0.97 },
  },
  {
    id: 'theocracy',
    name: 'Theokratie',
    sigil: '☩',
    desc: 'Die Lehre ist Gesetz. Einfluss und Zusammenhalt, wenig weltliche Neugier.',
    mods: { influence: 1.12, research: 0.96 },
  },
  {
    id: 'syndicate',
    name: 'Konzernstaat',
    sigil: '⛃',
    desc: 'Jede Werft ist bilanzpflichtig. Einkommen hoch, Hüllen effizient statt dick.',
    mods: { income: 1.12, hull: 0.96 },
  },
  {
    id: 'hive',
    name: 'Schwarmrat',
    sigil: '⬡',
    desc: 'Viele Körper, ein Beschluss. Hüllen und Wirtschaft wachsen zusammen.',
    mods: { hull: 1.08, income: 1.04, research: 0.96 },
  },
  {
    id: 'clan',
    name: 'Clanschaft',
    sigil: '⌘',
    desc: 'Blut entscheidet über Ämter. Kampfkraft und Härte, keine stabile Kasse.',
    mods: { attack: 1.06, hull: 1.05, income: 0.97 },
  },
  {
    id: 'council',
    name: 'Rätebund',
    sigil: '⌸',
    desc: 'Acht Stimmen, ein Kompromiss. Forschung und Einfluss, späte Offensiven.',
    mods: { research: 1.05, influence: 1.06, attack: 0.97 },
  },
];

export const WORLDVIEWS: ProfileOption[] = [
  {
    id: 'pragmatic',
    name: 'Pragmatisch',
    sigil: '◇',
    desc: 'Keine Doktrin außer der Frage, was funktioniert.',
  },
  {
    id: 'expansionist',
    name: 'Expansionistisch',
    sigil: '➤',
    desc: 'Die Grenze ist ein Vorwurf. Mehr Einkommen, dünnere Sicherung.',
    mods: { income: 1.06, hull: 0.97 },
  },
  {
    id: 'isolationist',
    name: 'Isolationistisch',
    sigil: '⬢',
    desc: 'Was draußen bleibt, bleibt draußen. Hüllen und Heimatwelten zuerst.',
    mods: { hull: 1.09, influence: 0.96 },
  },
  {
    id: 'enlightened',
    name: 'Aufgeklärt',
    sigil: '✶',
    desc: 'Erkenntnis ist die einzige Pflicht. Forschung vor Feuerkraft.',
    mods: { research: 1.08, attack: 0.97 },
  },
  {
    id: 'militarist',
    name: 'Militaristisch',
    sigil: '⚔',
    desc: 'Frieden ist ein Zwischenstand. Angriff steigt, Forschung tritt zurück.',
    mods: { attack: 1.09, research: 0.97 },
  },
  {
    id: 'mercantile',
    name: 'Merkantil',
    sigil: '⛁',
    desc: 'Jeder Sektor ist ein Markt. Einkommen gegen politische Reichweite.',
    mods: { income: 1.08, influence: 0.97 },
  },
  {
    id: 'transcendent',
    name: 'Transzendent',
    sigil: '◌',
    desc: 'Die Leere ist eine Prüfung, keine Grenze. Einfluss und Geduld.',
    mods: { influence: 1.09, income: 0.97 },
  },
];

export const RELIGIONS: ProfileOption[] = [
  {
    id: 'secular',
    name: 'Säkular',
    sigil: '◇',
    desc: 'Der Staat kennt keine Altäre. Neutral in jeder Hinsicht.',
  },
  {
    id: 'solar',
    name: 'Sonnenkult',
    sigil: '☀',
    desc: 'Jede Sonne ist ein Fenster. Einfluss und Forschung, wenig Überschuss.',
    mods: { influence: 1.06, research: 1.03, income: 0.97 },
  },
  {
    id: 'void',
    name: 'Leerenmystik',
    sigil: '◌',
    desc: 'Wer die Leere hört, baut anders. Forschung und Hüllen, schwacher Handel.',
    mods: { research: 1.06, hull: 1.03, income: 0.97 },
  },
  {
    id: 'ancestors',
    name: 'Ahnenverehrung',
    sigil: '⌂',
    desc: 'Die Toten prüfen die Pläne. Hüllen und Einfluss, langsamer Fortschritt.',
    mods: { hull: 1.06, influence: 1.03, research: 0.97 },
  },
  {
    id: 'machine',
    name: 'Maschinenglaube',
    sigil: '⚙',
    desc: 'Präzision ist Frömmigkeit. Wirtschaft und Forschung, wenig Ausstrahlung.',
    mods: { income: 1.06, research: 1.03, influence: 0.97 },
  },
  {
    id: 'balance',
    name: 'Gleichgewicht',
    sigil: '☯',
    desc: 'Kein Extrem, keine Schuld. Kleine Vorteile in Wirtschaft, Forschung und Hülle.',
    mods: { income: 1.03, research: 1.03, hull: 1.03 },
  },
  {
    id: 'flame',
    name: 'Flammenbund',
    sigil: '✹',
    desc: 'Reinigung durch Feuer. Angriff und Härte, Forschung als Sünde.',
    mods: { attack: 1.06, hull: 1.05, research: 0.98, income: 1.03 },
  },
  {
    id: 'archive',
    name: 'Archivglaube',
    sigil: '⌬',
    desc: 'Nichts darf vergessen werden. Forschung und Einfluss, teure Verwaltung.',
    mods: { research: 1.07, influence: 1.03, income: 0.97 },
  },
];

export const NEUTRAL_PROFILE_MODS: EmpireProfileMods = {
  attack: 1,
  hull: 1,
  income: 1,
  research: 1,
  influence: 1,
};

export function defaultProfile(): EmpireProfile {
  return { shipClass: 'corvette', traits: [], government: 'republic', worldview: 'pragmatic', religion: 'secular' };
}

export function optionById(list: ProfileOption[], id: string): ProfileOption | null {
  return list.find((option) => option.id === id) ?? null;
}

function profileOption(list: ProfileOption[], value: unknown, fallback: string): string {
  return typeof value === 'string' && list.some((option) => option.id === value) ? value : fallback;
}

export function sanitizeTraits(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const traits: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    if (!RACE_TRAITS.some((trait) => trait.id === value)) continue;
    if (traits.includes(value)) continue;
    traits.push(value);
    if (traits.length >= MAX_TRAITS) break;
  }
  return traits;
}

export function sanitizeProfile(raw: unknown): EmpireProfile {
  const value = (raw ?? {}) as Partial<EmpireProfile>;
  const fallback = defaultProfile();
  const armyId =
    typeof value.armyId === 'string' && value.armyId && value.armyId.length <= 48 ? value.armyId : undefined;
  return {
    shipClass: START_HULLS.some((hull) => hull.id === value.shipClass)
      ? (value.shipClass as ShipId)
      : fallback.shipClass,
    ...(armyId ? { armyId } : {}),
    traits: sanitizeTraits(value.traits),
    government: profileOption(GOVERNMENTS, value.government, fallback.government),
    worldview: profileOption(WORLDVIEWS, value.worldview, fallback.worldview),
    religion: profileOption(RELIGIONS, value.religion, fallback.religion),
  };
}

function multiply(target: EmpireProfileMods, mods: Partial<EmpireProfileMods> | undefined): void {
  if (!mods) return;
  if (mods.attack) target.attack *= mods.attack;
  if (mods.hull) target.hull *= mods.hull;
  if (mods.income) target.income *= mods.income;
  if (mods.research) target.research *= mods.research;
  if (mods.influence) target.influence *= mods.influence;
}

/** Combined multipliers of every founding choice, relative to a neutral empire. */
export function profileMods(profile: EmpireProfile | null | undefined): EmpireProfileMods {
  const mods: EmpireProfileMods = { ...NEUTRAL_PROFILE_MODS };
  if (!profile) return mods;
  const clean = sanitizeProfile(profile);
  for (const id of clean.traits) multiply(mods, optionById(RACE_TRAITS, id)?.mods);
  multiply(mods, optionById(GOVERNMENTS, clean.government)?.mods);
  multiply(mods, optionById(WORLDVIEWS, clean.worldview)?.mods);
  multiply(mods, optionById(RELIGIONS, clean.religion)?.mods);
  return mods;
}
