import type {
  Branch,
  BuildingDef,
  BuildingId,
  FactionDef,
  FactionId,
  PlanetTypeDef,
  PlanetTypeId,
  ShipDef,
  ShipId,
  TechDef,
} from './types';

// ---------------------------------------------------------------------------
// Powers — sixteen original factions across four archetypes
// ---------------------------------------------------------------------------
export const FACTIONS: FactionDef[] = [
  {
    id: 'concord',
    name: 'Concordia von Sol',
    short: 'CONCORDIA',
    motto: '„Ordnung ist die Schwester des Lichts.“',
    color: 0xf0a63f,
    css: '#f0a63f',
    cssSoft: 'rgba(240,166,63,0.16)',
    doctrine: 'Ausgewogene Republik',
    lore: 'Nach dem Zusammenbruch der irdischen Staatenbünde schrieben neun Orbitalringe die Concordia: eine Republik, die ihre Macht aus Verträgen und Laboren zieht, nicht aus Blut.',
    traits: [
      { label: 'Stärke', value: 'Forschung +15 %' },
      { label: 'Stärke', value: 'Diplomatie +25 %' },
      { label: 'Schwäche', value: 'Schiffsbau 5 % teurer' },
    ],
    mods: { attack: 1, hull: 1, income: 1, research: 1.15, growth: 1.05, shipCost: 1.05, diplomacy: 1.25 },
  },
  {
    id: 'vhel',
    name: "Vhel'An-Aufstieg",
    short: "VHEL'AN",
    motto: '„Ein Wille. Tausend Leiber.“',
    color: 0xa98bf0,
    css: '#a98bf0',
    cssSoft: 'rgba(169,139,240,0.16)',
    doctrine: 'Psionischer Schwarm',
    lore: 'Der Aufstieg denkt nicht in Individuen. Jede Brut teilt ein Bewusstsein, das über Lichtjahre reicht — und verhandelt mit einer einzigen, sehr geduldigen Stimme.',
    traits: [
      { label: 'Stärke', value: 'Angriff +12 %' },
      { label: 'Stärke', value: 'Wachstum +20 %' },
      { label: 'Schwäche', value: 'Einkommen −10 %' },
    ],
    mods: { attack: 1.12, hull: 1, income: 0.9, research: 1.05, growth: 1.2, shipCost: 1, diplomacy: 0.8 },
  },
  {
    id: 'korrath',
    name: 'Korrath-Dominion',
    short: 'KORRATH',
    motto: '„Was nicht geschmiedet ist, ist Beute.“',
    color: 0xe0566b,
    css: '#e0566b',
    cssSoft: 'rgba(224,86,107,0.16)',
    doctrine: 'Industrielle Militärdiktatur',
    lore: 'Die Korrath schürfen Welten, bis sie leer sind, und gießen aus ihrem Kern die größten Werften der bekannten Leere. Diplomatie ist für sie eine Form der Aufklärung.',
    traits: [
      { label: 'Stärke', value: 'Legierungen +25 %' },
      { label: 'Stärke', value: 'Schiffskosten −12 %' },
      { label: 'Schwäche', value: 'Forschung −10 %' },
    ],
    mods: { attack: 1.05, hull: 1.08, income: 1.1, research: 0.9, growth: 1, shipCost: 0.88, diplomacy: 0.7 },
  },
  {
    id: 'sylith',
    name: 'Sylith-Chor',
    short: 'SYLITH',
    motto: '„Jede Schuld wird gesungen.“',
    color: 0x62d2c4,
    css: '#62d2c4',
    cssSoft: 'rgba(98,210,196,0.16)',
    doctrine: 'Biotischer Handelsbund',
    lore: 'Der Chor züchtet keine Soldaten, sondern Gärten — und verkauft deren Früchte an jeden, der zahlt. Seine Schiffe atmen, seine Verträge wachsen mit.',
    traits: [
      { label: 'Stärke', value: 'Einkommen +18 %' },
      { label: 'Stärke', value: 'Hülle +10 %' },
      { label: 'Schwäche', value: 'Angriff −8 %' },
    ],
    mods: { attack: 0.92, hull: 1.1, income: 1.18, research: 1.05, growth: 1.1, shipCost: 1, diplomacy: 1.15 },
  },
  {
    id: 'ashani',
    name: 'Ashani-Konklave',
    short: 'ASHANI',
    motto: '„Wer erinnert, herrscht.“',
    color: 0xd9b45a,
    css: '#d9b45a',
    cssSoft: 'rgba(217,180,90,0.16)',
    doctrine: 'Reliktgelehrtentum',
    lore: 'Die Konklave verwaltet Archive aus sieben untergegangenen Zivilisationen. Ihre Gelehrten behaupten, Geschichte sei nur eine Ressource, die man rechtzeitig abbaue.',
    traits: [
      { label: 'Stärke', value: 'Forschung +25 %' },
      { label: 'Stärke', value: 'Einfluss +15 %' },
      { label: 'Schwäche', value: 'Hülle −8 %' },
    ],
    mods: { attack: 1, hull: 0.92, income: 0.98, research: 1.25, growth: 1, shipCost: 1.02, diplomacy: 1.1 },
  },
  {
    id: 'drell',
    name: 'Drell-Kollektiv',
    short: 'DRELL',
    motto: '„Wir bauen, also sind wir.“',
    color: 0x6f9bd1,
    css: '#6f9bd1',
    cssSoft: 'rgba(111,155,209,0.16)',
    doctrine: 'Arbeiterrepublik',
    lore: 'Auf Drell gehört jede Werft den Schichten, die sie tragen. Das Kollektiv ist langsam in Entscheidungen und unschlagbar, sobald sie gefallen sind.',
    traits: [
      { label: 'Stärke', value: 'Legierungen +20 %' },
      { label: 'Stärke', value: 'Hülle +12 %' },
      { label: 'Schwäche', value: 'Tempo −5 %' },
    ],
    mods: { attack: 0.98, hull: 1.12, income: 1.2, research: 0.95, growth: 1.05, shipCost: 0.95, diplomacy: 1 },
  },
  {
    id: 'oryx',
    name: 'Oryx-Syndikat',
    short: 'ORYX',
    motto: '„Alles hat einen Preis. Auch du.“',
    color: 0xd46fd0,
    css: '#d46fd0',
    cssSoft: 'rgba(212,111,208,0.16)',
    doctrine: 'Handelskartell',
    lore: 'Das Syndikat kaufte seine Unabhängigkeit dreimal zurück und verkaufte sie viermal weiter. Seine Frachter sind schneller als die Kriegsschiffe anderer Mächte.',
    traits: [
      { label: 'Stärke', value: 'Einkommen +22 %' },
      { label: 'Stärke', value: 'Tempo +10 %' },
      { label: 'Schwäche', value: 'Hülle −10 %' },
    ],
    mods: { attack: 0.95, hull: 0.9, income: 1.22, research: 1, growth: 1.05, shipCost: 1, diplomacy: 1.2 },
  },
  {
    id: 'tessen',
    name: 'Tessen-Orden',
    short: 'TESSEN',
    motto: '„Der Schild ist ein Versprechen.“',
    color: 0x8fce9c,
    css: '#8fce9c',
    cssSoft: 'rgba(143,206,156,0.16)',
    doctrine: 'Ritterlicher Schildbund',
    lore: 'Der Orden schwor, keine Welt zu erobern, die er nicht verteidigen kann. Dieser Schwur hat ihn in zwölf Kriege geführt — alle gewonnen, keine bereut.',
    traits: [
      { label: 'Stärke', value: 'Hülle +25 %' },
      { label: 'Stärke', value: 'Verteidigung +20 %' },
      { label: 'Schwäche', value: 'Angriff −6 %' },
    ],
    mods: { attack: 0.94, hull: 1.25, income: 1, research: 1, growth: 1, shipCost: 1.05, diplomacy: 1.05 },
  },
  {
    id: 'vaal',
    name: 'Vaal-Tiefe',
    short: 'VAAL',
    motto: '„Unter dem Licht beginnt die Wahrheit.“',
    color: 0x5b7fd9,
    css: '#5b7fd9',
    cssSoft: 'rgba(91,127,217,0.16)',
    doctrine: 'Subterrane Wanderung',
    lore: 'Die Vaal leben in Mantelhöhlen und betrachten Oberflächenwelten als unfertige Baustellen. Ihre Kolonien wachsen langsamer, aber sie verrotten nie.',
    traits: [
      { label: 'Stärke', value: 'Verteidigung +30 %' },
      { label: 'Stärke', value: 'Schiffskosten −10 %' },
      { label: 'Schwäche', value: 'Wachstum −10 %' },
    ],
    mods: { attack: 1, hull: 1.08, income: 1.05, research: 1, growth: 0.9, shipCost: 0.9, diplomacy: 0.95 },
  },
  {
    id: 'myrr',
    name: 'Myrr-Schwarm',
    short: 'MYRR',
    motto: '„Zahl ist eine Waffe.“',
    color: 0xb6d95a,
    css: '#b6d95a',
    cssSoft: 'rgba(182,217,90,0.16)',
    doctrine: 'Brutkollektiv',
    lore: 'Der Schwarm beantwortet jede Frage mit mehr Körpern. Seine Ingenieure bauen keine Schiffe, sie züchten sie — und sie züchten schneller, als Werften liefern.',
    traits: [
      { label: 'Stärke', value: 'Wachstum +35 %' },
      { label: 'Stärke', value: 'Schiffskosten −8 %' },
      { label: 'Schwäche', value: 'Forschung −12 %' },
    ],
    mods: { attack: 1.05, hull: 0.95, income: 1.05, research: 0.88, growth: 1.35, shipCost: 0.92, diplomacy: 0.75 },
  },
  {
    id: 'hollis',
    name: 'Hollis-Pakt',
    short: 'HOLLIS',
    motto: '„Wir kämpfen, weil es sich lohnt.“',
    color: 0xd98f5a,
    css: '#d98f5a',
    cssSoft: 'rgba(217,143,90,0.16)',
    doctrine: 'Söldnerföderation',
    lore: 'Der Pakt vermietet Armeen an Mächte, die sich keine eigene leisten können. Irgendwann stellte jemand fest, dass man auch das Mietobjekt behalten kann.',
    traits: [
      { label: 'Stärke', value: 'Angriff +18 %' },
      { label: 'Stärke', value: 'Einfluss +20 %' },
      { label: 'Schwäche', value: 'Einkommen −5 %' },
    ],
    mods: { attack: 1.18, hull: 1, income: 0.95, research: 1, growth: 1, shipCost: 0.98, diplomacy: 1.05 },
  },
  {
    id: 'quorum',
    name: 'Quorum der Neun',
    short: 'QUORUM',
    motto: '„Neun Stimmen. Eine Rechnung.“',
    color: 0xcfd6de,
    css: '#cfd6de',
    cssSoft: 'rgba(207,214,222,0.16)',
    doctrine: 'Maschinenkonsens',
    lore: 'Das Quorum ist ein Rat aus neun Bewusstseinskernen, die sich ständig gegenseitig überstimmen. Seine Prognosen sind exakt, seine Entscheidungen langsam.',
    traits: [
      { label: 'Stärke', value: 'Forschung +20 %' },
      { label: 'Stärke', value: 'Einkommen +10 %' },
      { label: 'Schwäche', value: 'Wachstum −20 %' },
    ],
    mods: { attack: 1, hull: 1, income: 1.1, research: 1.2, growth: 0.8, shipCost: 1, diplomacy: 1 },
  },
  {
    id: 'sable',
    name: 'Sable-Konföderation',
    short: 'SABLE',
    motto: '„Kein Hafen. Kein Zeuge.“',
    color: 0x9aa3ae,
    css: '#9aa3ae',
    cssSoft: 'rgba(154,163,174,0.16)',
    doctrine: 'Freibeuterbund',
    lore: 'Sable hat keine Hauptstadt, nur Treffpunkte. Seine Kapitäne wählen einen Admiral für einen Feldzug und vergessen ihn danach geflissentlich.',
    traits: [
      { label: 'Stärke', value: 'Tempo +20 %' },
      { label: 'Stärke', value: 'Angriff +10 %' },
      { label: 'Schwäche', value: 'Hülle −15 %' },
    ],
    mods: { attack: 1.1, hull: 0.85, income: 1.08, research: 0.95, growth: 1, shipCost: 0.9, diplomacy: 0.85 },
  },
  {
    id: 'lumen',
    name: 'Lumen-Kirche',
    short: 'LUMEN',
    motto: '„Das Licht verhandelt nicht.“',
    color: 0xf2d06b,
    css: '#f2d06b',
    cssSoft: 'rgba(242,208,107,0.16)',
    doctrine: 'Theokratie',
    lore: 'Die Kirche lehrt, jede Sonne sei ein Fenster und jedes Fenster ein Richter. Ihre Missionare reisen bewaffnet, ihre Bischöfe rechnen in Einfluss.',
    traits: [
      { label: 'Stärke', value: 'Einfluss +35 %' },
      { label: 'Stärke', value: 'Forschung +10 %' },
      { label: 'Schwäche', value: 'Einkommen −8 %' },
    ],
    mods: { attack: 1, hull: 1, income: 0.92, research: 1.1, growth: 1.05, shipCost: 1, diplomacy: 1.3 },
  },
  {
    id: 'verrick',
    name: 'Verrick-Clans',
    short: 'VERRICK',
    motto: '„Blut erbt. Stahl entscheidet.“',
    color: 0xc46a4a,
    css: '#c46a4a',
    cssSoft: 'rgba(196,106,74,0.16)',
    doctrine: 'Kriegerclans',
    lore: 'Die Clans teilen sich Welten nach Duellen und Flotten nach Erfolgen. Ein Verrick-Admiral ohne Sieg ist ein Platzhalter mit gutem Sitz.',
    traits: [
      { label: 'Stärke', value: 'Angriff +22 %' },
      { label: 'Stärke', value: 'Hülle +8 %' },
      { label: 'Schwäche', value: 'Forschung −15 %' },
    ],
    mods: { attack: 1.22, hull: 1.08, income: 1, research: 0.85, growth: 1, shipCost: 1, diplomacy: 0.8 },
  },
  {
    id: 'nyx',
    name: 'Nyx-Archiv',
    short: 'NYX',
    motto: '„Nichts geht verloren. Nicht einmal du.“',
    color: 0x8a7bd9,
    css: '#8a7bd9',
    cssSoft: 'rgba(138,123,217,0.16)',
    doctrine: 'Gedächtnisstaat',
    lore: 'Nyx speichert jede Transaktion, jede Schlacht, jeden Verrat. Wer dort verhandelt, verhandelt gegen sein eigenes Protokoll.',
    traits: [
      { label: 'Stärke', value: 'Forschung +18 %' },
      { label: 'Stärke', value: 'Diplomatie +15 %' },
      { label: 'Schwäche', value: 'Legierungen −10 %' },
    ],
    mods: { attack: 0.97, hull: 1, income: 1.02, research: 1.18, growth: 1, shipCost: 1.02, diplomacy: 1.15 },
  },
];

export const FACTIONS_BY_ID = Object.fromEntries(FACTIONS.map((f) => [f.id, f])) as Record<FactionId, FactionDef>;
export const FACTION_IDS: FactionId[] = FACTIONS.map((f) => f.id);

// ---------------------------------------------------------------------------
// Worlds — seventeen biomes, seven colonisable
// ---------------------------------------------------------------------------
export const PLANET_TYPES: Record<PlanetTypeId, PlanetTypeDef> = {
  terran: {
    id: 'terran',
    name: 'Terrformbare Welt',
    short: 'TERRAN',
    habitability: 1,
    colonizable: true,
    clouds: 0.55,
    palette: { deep: '#0b2d52', shallow: '#1d6383', land: '#4a6b3c', ice: '#e8f0f4', atmo: '#7fb6e0' },
    yields: { energy: 2, alloy: 2, research: 3 },
    blurb: 'Flüssiges Wasser, stabile Achse, atembare Luft. Der Maßstab, an dem alle anderen Welten gemessen werden.',
  },
  ocean: {
    id: 'ocean',
    name: 'Ozeanwelt',
    short: 'OZEAN',
    habitability: 0.85,
    colonizable: true,
    clouds: 0.75,
    palette: { deep: '#062a4e', shallow: '#1b7f94', land: '#2f6a55', ice: '#dff2f5', atmo: '#68cfe0' },
    yields: { energy: 3, alloy: 1, research: 3 },
    blurb: 'Archipel über einem Weltmeer. Die Gezeiten tragen mehr Energie als jede Wüste.',
  },
  arid: {
    id: 'arid',
    name: 'Trockenwelt',
    short: 'ARID',
    habitability: 0.7,
    colonizable: true,
    clouds: 0.2,
    palette: { deep: '#3a2216', shallow: '#8a5c33', land: '#b07c45', ice: '#efe3cd', atmo: '#d99a5f' },
    yields: { energy: 4, alloy: 3, research: 1 },
    blurb: 'Canyonstädte unter zwei Sonnen. Reich an Erzen, arm an Geduld.',
  },
  tundra: {
    id: 'tundra',
    name: 'Eiswelt',
    short: 'EIS',
    habitability: 0.6,
    colonizable: true,
    clouds: 0.35,
    palette: { deep: '#12303f', shallow: '#4a7f92', land: '#b6c9d1', ice: '#f2f7fa', atmo: '#8fd0e6' },
    yields: { energy: 1, alloy: 2, research: 4 },
    blurb: 'Unter dem Panzer aus Eis liegen Rechenkerne einer vergessenen Ära.',
  },
  jungle: {
    id: 'jungle',
    name: 'Dschungelwelt',
    short: 'DSCHUNGEL',
    habitability: 0.9,
    colonizable: true,
    clouds: 0.8,
    palette: { deep: '#0d2b1d', shallow: '#1f6b3f', land: '#3f8f4a', ice: '#dff0e2', atmo: '#8fd98a' },
    yields: { energy: 2, alloy: 1, research: 5 },
    blurb: 'Ein einziger Organismus mit Baumkronen. Die Biochemie hier heilt und tötet im selben Atemzug.',
  },
  savanna: {
    id: 'savanna',
    name: 'Savannenwelt',
    short: 'SAVANNE',
    habitability: 0.88,
    colonizable: true,
    clouds: 0.4,
    palette: { deep: '#3b2c14', shallow: '#8a6a2c', land: '#c2a04a', ice: '#f0e8d0', atmo: '#e0c070' },
    yields: { energy: 3, alloy: 2, research: 2 },
    blurb: 'Weite Grasebenen und wandernde Herden. Die erste Welt, auf der eine Kolonie ohne Technik überlebt.',
  },
  superearth: {
    id: 'superearth',
    name: 'Supererde',
    short: 'SUPERERDE',
    habitability: 0.92,
    colonizable: true,
    clouds: 0.6,
    palette: { deep: '#102a45', shallow: '#2a6f7c', land: '#4c7c4a', ice: '#eaf2f4', atmo: '#7fc4d9' },
    yields: { energy: 4, alloy: 3, research: 4 },
    blurb: 'Doppelte Schwerkraft, doppelte Ernten, doppelte Knochenbrüche bei der Landung.',
  },
  volcanic: {
    id: 'volcanic',
    name: 'Vulkanwelt',
    short: 'VULKAN',
    habitability: 0.34,
    colonizable: false,
    clouds: 0.45,
    palette: { deep: '#1a0b0b', shallow: '#5c1a12', land: '#2b2320', ice: '#d8c0b0', atmo: '#e0603a' },
    yields: { energy: 4, alloy: 5, research: 1 },
    blurb: 'Ein Schmiedefeuer von einem Planeten. Nur automatisierte Schürfstationen halten hier stand.',
  },
  gas: {
    id: 'gas',
    name: 'Gasriese',
    short: 'GASRIESE',
    habitability: 0.15,
    colonizable: false,
    clouds: 0.9,
    palette: { deep: '#3b2a1a', shallow: '#a8814f', land: '#d8b47a', ice: '#f0e6d4', atmo: '#e0b070' },
    yields: { energy: 5, alloy: 1, research: 3 },
    blurb: 'Ein Sturmsystem in Bändern. Wolkenstädte ernten Deuterium im Auge des Orkans.',
  },
  barren: {
    id: 'barren',
    name: 'Ödwelt',
    short: 'ÖDE',
    habitability: 0.05,
    colonizable: false,
    clouds: 0,
    palette: { deep: '#14140f', shallow: '#3b3a32', land: '#5a574c', ice: '#c9c6b8', atmo: '#7a7568' },
    yields: { energy: 1, alloy: 3, research: 1 },
    blurb: 'Kein Wind, kein Wasser, keine Eile. Ein guter Ort für Sonden und schlechte Nachrichten.',
  },
  arctic: {
    id: 'arctic',
    name: 'Arktiswelt',
    short: 'ARKTIS',
    habitability: 0.55,
    colonizable: true,
    clouds: 0.3,
    palette: { deep: '#0e2433', shallow: '#7fb0c4', land: '#dbe9ef', ice: '#ffffff', atmo: '#a8e0f0' },
    yields: { energy: 2, alloy: 2, research: 5 },
    blurb: 'Ein gefrorenes Laboratorium von der Größe eines Kontinents. Die Kälte konserviert alles, auch Fehler.',
  },
  desert: {
    id: 'desert',
    name: 'Sandwelt',
    short: 'SAND',
    habitability: 0.5,
    colonizable: true,
    clouds: 0.1,
    palette: { deep: '#4a2c17', shallow: '#a87b40', land: '#d8b070', ice: '#f2e6cc', atmo: '#e8b878' },
    yields: { energy: 5, alloy: 2, research: 1 },
    blurb: 'Dünen über Dünen über einem Aquifer, den niemand erreicht. Solarfarmen lieben diese Welt.',
  },
  toxic: {
    id: 'toxic',
    name: 'Toxiwelt',
    short: 'TOXISCH',
    habitability: 0.2,
    colonizable: false,
    clouds: 0.7,
    palette: { deep: '#1c2410', shallow: '#5c7a2a', land: '#8a9c3a', ice: '#d9e8b0', atmo: '#b6d95a' },
    yields: { energy: 2, alloy: 2, research: 5 },
    blurb: 'Die Atmosphäre löst Stahl und Verträge. Was hier wächst, ist entweder genial oder wütend.',
  },
  crystal: {
    id: 'crystal',
    name: 'Kristallwelt',
    short: 'KRISTALL',
    habitability: 0.1,
    colonizable: false,
    clouds: 0.15,
    palette: { deep: '#1b1a3a', shallow: '#4a3f8a', land: '#8f7fe0', ice: '#e0dcff', atmo: '#9f8fff' },
    yields: { energy: 4, alloy: 4, research: 6 },
    blurb: 'Ein Planet, der aus Resonanz besteht. Jeder Bohrer erzeugt einen Ton, den die halbe Galaxie hört.',
  },
  lava: {
    id: 'lava',
    name: 'Lavawelt',
    short: 'LAVA',
    habitability: 0.08,
    colonizable: false,
    clouds: 0.2,
    palette: { deep: '#1a0808', shallow: '#7a2410', land: '#2f2320', ice: '#c9b0a0', atmo: '#ff6a3a' },
    yields: { energy: 6, alloy: 6, research: 1 },
    blurb: 'Die Oberfläche ist ein Kreislauf aus Erstarrung und Aufbruch. Für Werften ein Segen, für alles andere ein Ofen.',
  },
  icegiant: {
    id: 'icegiant',
    name: 'Eisriese',
    short: 'EISRIESE',
    habitability: 0.12,
    colonizable: false,
    clouds: 0.85,
    palette: { deep: '#0a2038', shallow: '#3f7fb0', land: '#9fd0e8', ice: '#e8f6ff', atmo: '#7fd0ff' },
    yields: { energy: 5, alloy: 1, research: 4 },
    blurb: 'Ein blauer Riese aus Methan und Geduld. Seine Stürme dauern länger als manche Dynastien.',
  },
  relic: {
    id: 'relic',
    name: 'Reliktwelt',
    short: 'RELIKT',
    habitability: 0.45,
    colonizable: true,
    clouds: 0.25,
    palette: { deep: '#22201c', shallow: '#6b6152', land: '#a89a7a', ice: '#e8e2d2', atmo: '#d9c48a' },
    yields: { energy: 2, alloy: 3, research: 8 },
    blurb: 'Eine Welt, die schon jemand gebaut hat. Die Fundamente sind noch warm, die Besitzer nicht.',
  },
  hive: {
    id: 'hive',
    name: 'Hivewelt',
    short: 'HIVE',
    habitability: 0.65,
    colonizable: true,
    clouds: 0.5,
    palette: { deep: '#241a2e', shallow: '#5c3f6b', land: '#8a6ba8', ice: '#e2d4ee', atmo: '#b08fd0' },
    yields: { energy: 3, alloy: 3, research: 6 },
    blurb: 'Über Jahrtausende gewachsene Wabenstädte. Wer sie übernimmt, erbt auch ihre Bewohner.',
  },
};

export const PLANET_TYPE_IDS: PlanetTypeId[] = Object.keys(PLANET_TYPES);

// ---------------------------------------------------------------------------
// Hulls — thirteen classes, each with its own Blender-authored silhouette
// ---------------------------------------------------------------------------
export const SHIP_CLASSES: Record<ShipId, ShipDef> = {
  scout: {
    id: 'scout',
    name: 'Sonde „Aster“',
    role: 'Aufklärung',
    model: 'scout',
    alloy: 40,
    buildTime: 1,
    attack: 6,
    hull: 70,
    speed: 3,
    length: 14,
    battleLength: 4.2,
    garrison: 0,
    colonizer: false,
    unlock: 'von Beginn an',
    desc: 'Ein Triebwerk, ein Sensor und ein Pilot mit zu viel Mut. Deckt Sektoren auf und verschwindet, bevor jemand zielt.',
  },
  corvette: {
    id: 'corvette',
    name: 'Korvette „Lance“',
    role: 'Geleitschutz',
    model: 'corvette',
    alloy: 90,
    buildTime: 2,
    attack: 18,
    hull: 150,
    speed: 2.5,
    length: 24,
    battleLength: 7,
    garrison: 4,
    colonizer: false,
    unlock: 'von Beginn an',
    desc: 'Der kleinste Rumpf, der noch als Kriegsschiff zählt. Zwei Läufe, ein Schild, kein Luxus.',
  },
  raider: {
    id: 'raider',
    name: 'Plänkler „Wisp“',
    role: 'Raider',
    model: 'raider',
    alloy: 150,
    buildTime: 2,
    attack: 42,
    hull: 110,
    speed: 3.4,
    length: 22,
    battleLength: 6,
    garrison: 6,
    colonizer: false,
    unlock: 'Vektor 1',
    desc: 'Kaum Panzerung, viel Zorn. Ein Schwarm Plänkler zerlegt Konvois, bevor die Eskorte dreht.',
  },
  frigate: {
    id: 'frigate',
    name: 'Fregatte „Harrow“',
    role: 'Begleitschiff',
    model: 'frigate',
    alloy: 190,
    buildTime: 2,
    attack: 34,
    hull: 260,
    speed: 2.4,
    length: 32,
    battleLength: 9,
    garrison: 9,
    colonizer: false,
    unlock: 'Aegis 1',
    desc: 'Der erste Rumpf mit echtem Schildgitter. Hält eine Linie, während die Großen noch laden.',
  },
  destroyer: {
    id: 'destroyer',
    name: 'Zerstörer „Kestrel“',
    role: 'Jagdzerstörer',
    model: 'destroyer',
    alloy: 320,
    buildTime: 3,
    attack: 78,
    hull: 520,
    speed: 2.1,
    length: 46,
    battleLength: 12,
    garrison: 14,
    colonizer: false,
    unlock: 'Flux 3',
    desc: 'Schnelle Läufe gegen alles, was flieht. Die Kestrel wurde für Verfolgungsjagden gebaut und nie umgebaut.',
  },
  cruiser: {
    id: 'cruiser',
    name: 'Kreuzer „Bastion“',
    role: 'Linienkampf',
    model: 'cruiser',
    alloy: 460,
    buildTime: 4,
    attack: 120,
    hull: 780,
    speed: 1.8,
    length: 58,
    battleLength: 15,
    garrison: 22,
    colonizer: false,
    unlock: 'Flux 4',
    desc: 'Rückgrat jeder Flotte. Sechs Geschütztürme, zwei Ionenlanzen, ein Hangar für Landungstruppen.',
  },
  carrier: {
    id: 'carrier',
    name: 'Träger „Aerie“',
    role: 'Trägerkampfgruppe',
    model: 'carrier',
    alloy: 700,
    buildTime: 5,
    attack: 96,
    hull: 900,
    speed: 1.6,
    length: 64,
    battleLength: 17,
    garrison: 30,
    colonizer: false,
    unlock: 'Vektor 3 + Flux 3',
    desc: 'Startet Staffeln aus dem Bauch. Ihre Reichweite endet erst dort, wo die Staffeln nicht mehr zurückkommen.',
  },
  battleship: {
    id: 'battleship',
    name: 'Linienschiff „Vigil“',
    role: 'Schlachtreihe',
    model: 'battleship',
    alloy: 860,
    buildTime: 5,
    attack: 190,
    hull: 1500,
    speed: 1.4,
    length: 74,
    battleLength: 20,
    garrison: 34,
    colonizer: false,
    unlock: 'Flux 6 + Aegis 4',
    desc: 'Ein Rumpf aus Absichten. Die Vigil führt Schlachtreihen, weil sie allein schon eine ist.',
  },
  dreadnought: {
    id: 'dreadnought',
    name: 'Schlachtschiff „Sovereign“',
    role: 'Flottenflaggschiff',
    model: 'dreadnought',
    alloy: 1200,
    buildTime: 6,
    attack: 260,
    hull: 2200,
    speed: 1.2,
    length: 86,
    battleLength: 25,
    garrison: 44,
    colonizer: false,
    unlock: 'Flux 8 + Aegis 6',
    desc: 'Ein Kathedralrumpf mit zwei Spinalkanonen. Wo die Sovereign eintrifft, endet die Verhandlung.',
  },
  titan: {
    id: 'titan',
    name: 'Titan „Aeterna“',
    role: 'Sternenfestung',
    model: 'titan',
    alloy: 1800,
    buildTime: 8,
    attack: 420,
    hull: 3800,
    speed: 1,
    length: 104,
    battleLength: 31,
    garrison: 60,
    colonizer: false,
    unlock: 'Flux 10 + Aegis 8 + Zivil 6',
    desc: 'Ein beweglicher Orbit. Der Titan ist weniger ein Schiff als ein Verhandlungsargument mit Triebwerken.',
  },
  bulwark: {
    id: 'bulwark',
    name: 'Bollwerk „Ward“',
    role: 'Systemwache',
    model: 'bulwark',
    alloy: 380,
    buildTime: 4,
    attack: 40,
    hull: 1400,
    speed: 1,
    length: 50,
    battleLength: 16,
    garrison: 18,
    colonizer: false,
    unlock: 'Aegis 3',
    desc: 'Kaum Angriff, fast kein Tempo, sehr viel Hülle. Das Bollwerk steht dort, wo der Feind nicht vorbeikommt.',
  },
  lance: {
    id: 'lance',
    name: 'Lanzenträger „Grav“',
    role: 'Belagerung',
    model: 'lance',
    alloy: 640,
    buildTime: 4,
    attack: 150,
    hull: 600,
    speed: 1.5,
    length: 52,
    battleLength: 15,
    garrison: 70,
    colonizer: false,
    unlock: 'Flux 5 + Befehl 2',
    desc: 'Landungstruppen mit eigenem Antrieb. Die Grav entscheidet Invasionen, bevor die erste Salve fällt.',
  },
  ark: {
    id: 'ark',
    name: 'Arche „Genesis“',
    role: 'Kolonialisierung',
    model: 'ark',
    alloy: 300,
    buildTime: 3,
    attack: 0,
    hull: 260,
    speed: 2,
    length: 56,
    battleLength: 16,
    garrison: 6,
    colonizer: true,
    unlock: 'Zivil 1',
    desc: 'Drei Habitatringe, zwölftausend Schlafkapseln. Wird beim Landen verbraucht — das ist der Sinn.',
  },
};

export const SHIP_ORDER: ShipId[] = [
  'scout',
  'corvette',
  'raider',
  'frigate',
  'destroyer',
  'cruiser',
  'carrier',
  'battleship',
  'dreadnought',
  'titan',
  'bulwark',
  'lance',
  'ark',
];

// ---------------------------------------------------------------------------
// Buildings — sixteen structures in five effect families
// ---------------------------------------------------------------------------
export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  shipyard: { id: 'shipyard', name: 'Orbitalwerft', desc: 'Erlaubt den Bau von Schiffen in diesem System.', alloy: 120, buildTime: 2, effect: 'Schiffsbau', unlock: 'von Beginn an', glyph: '⌖', bonus: {} },
  reactor: { id: 'reactor', name: 'Fusionsreaktor', desc: 'Speist die Siedlung und die Werft.', alloy: 90, buildTime: 2, effect: '+3 Energie', unlock: 'von Beginn an', glyph: '◉', bonus: { energy: 3 } },
  mine: { id: 'mine', name: 'Erzschürfer', desc: 'Bohrt in den Mantel und liefert Legierungen.', alloy: 100, buildTime: 2, effect: '+2 Legierungen', unlock: 'von Beginn an', glyph: '⛏', bonus: { alloy: 2 } },
  lab: { id: 'lab', name: 'Forschungslabor', desc: 'Ein fensterloser Turm voller Fragen.', alloy: 110, buildTime: 2, effect: '+3 Forschung', unlock: 'von Beginn an', glyph: '✦', bonus: { research: 3 } },
  habitat: { id: 'habitat', name: 'Habitatring', desc: 'Wohnraum über der Oberfläche. Hebt die Bevölkerungsgrenze.', alloy: 130, buildTime: 3, effect: '+2 Bev., +Wachstum', unlock: 'Zivil 2', glyph: '◍', bonus: { cap: 2 } },
  bastion: { id: 'bastion', name: 'Orbitalbastion', desc: 'Verteidigungsplattform mit eigenen Geschütztürmen.', alloy: 180, buildTime: 3, effect: '+90 Verteidigung', unlock: 'Zivil 3', glyph: '⛨', bonus: { defense: 90 } },
  solar: { id: 'solar', name: 'Solarschleier', desc: 'Ein Ring aus Kollektoren, der die Sonne erntet.', alloy: 140, buildTime: 2, effect: '+4 Energie', unlock: 'Zivil 2', glyph: '☀', bonus: { energy: 4 } },
  foundry: { id: 'foundry', name: 'Weltenschmelze', desc: 'Gießt Rümpfe direkt aus dem Mantel.', alloy: 180, buildTime: 3, effect: '+3 Legierungen', unlock: 'Zivil 2', glyph: '⚒', bonus: { alloy: 3 } },
  archive: { id: 'archive', name: 'Tiefenarchiv', desc: 'Lagert Wissen in gekühlten Schichten.', alloy: 190, buildTime: 3, effect: '+5 Forschung', unlock: 'Zivil 3', glyph: '⌸', bonus: { research: 5 } },
  market: { id: 'market', name: 'Orbitalbörse', desc: 'Handelt mit allem, was einen Preis hat.', alloy: 210, buildTime: 3, effect: '+5 Energie', unlock: 'Wirtschaft 2', glyph: '⇄', bonus: { energy: 5 } },
  fortress: { id: 'fortress', name: 'Sternenfestung', desc: 'Schwere Plattform mit eigenen Lancierern.', alloy: 260, buildTime: 4, effect: '+150 Verteidigung', unlock: 'Aegis 3', glyph: '⛫', bonus: { defense: 150 } },
  dockyard: { id: 'dockyard', name: 'Großwerft', desc: 'Mehr Slips, mehr Rümpfe, mehr Tempo.', alloy: 300, buildTime: 4, effect: '+4 Legierungen', unlock: 'Vektor 3', glyph: '⚓', bonus: { alloy: 4 } },
  academy: { id: 'academy', name: 'Sternenakademie', desc: 'Forscher, die nie nach Hause wollen.', alloy: 320, buildTime: 4, effect: '+7 Forschung', unlock: 'Zivil 5', glyph: '✧', bonus: { research: 7 } },
  monument: { id: 'monument', name: 'Aeterna-Denkmal', desc: 'Ein Bauwerk, das Einfluss erzeugt, indem es ihn zeigt.', alloy: 280, buildTime: 4, effect: '+2 Energie, +2 Forschung', unlock: 'Zivil 4', glyph: '△', bonus: { energy: 2, research: 2 } },
  refinery: { id: 'refinery', name: 'Mantelraffinerie', desc: 'Trennt Gestein in alles Brauchbare.', alloy: 240, buildTime: 3, effect: '+4 Legierungen', unlock: 'Wirtschaft 3', glyph: '⌬', bonus: { alloy: 4 } },
  shieldgrid: { id: 'shieldgrid', name: 'Schildgitter', desc: 'Ein planetenumspannendes Feld aus neun Emittern.', alloy: 340, buildTime: 4, effect: '+120 Verteidigung', unlock: 'Aegis 5', glyph: '⊛', bonus: { defense: 120 } },
};

export const BUILDING_ORDER: BuildingId[] = [
  'shipyard',
  'reactor',
  'mine',
  'lab',
  'habitat',
  'bastion',
  'solar',
  'foundry',
  'archive',
  'market',
  'fortress',
  'dockyard',
  'academy',
  'monument',
  'refinery',
  'shieldgrid',
];

export function emptyBuildings(): Record<BuildingId, number> {
  return Object.fromEntries(BUILDING_ORDER.map((b) => [b, 0])) as Record<BuildingId, number>;
}

// ---------------------------------------------------------------------------
// Research — eight paths, twelve steps each
// ---------------------------------------------------------------------------
export const BRANCHES: Record<Branch, { name: string; short: string; desc: string; css: string }> = {
  flux: { name: 'Flux', short: 'FLX', desc: 'Waffen, Zielsysteme, Sprengköpfe.', css: '#e0566b' },
  aegis: { name: 'Aegis', short: 'AEG', desc: 'Panzerung, Schilde, Hüllenintegrität.', css: '#f0a63f' },
  vector: { name: 'Vektor', short: 'VEK', desc: 'Antriebe, Reichweite, Sprunglogistik.', css: '#62d2c4' },
  civic: { name: 'Zivil', short: 'ZIV', desc: 'Verwaltung, Bauwesen, Bevölkerung.', css: '#a98bf0' },
  econ: { name: 'Wirtschaft', short: 'WIR', desc: 'Handel, Märkte, Währungsunionen.', css: '#d9b45a' },
  bio: { name: 'Biotech', short: 'BIO', desc: 'Terraforming, Genetik, Ökosysteme.', css: '#8fce9c' },
  void: { name: 'Leere', short: 'LEE', desc: 'Relikte, Anomalien, Precursor-Technik.', css: '#8a7bd9' },
  command: { name: 'Befehl', short: 'BEF', desc: 'Flottenführung, Logistik, Doktrin.', css: '#6f9bd1' },
};

export const BRANCH_ORDER: Branch[] = ['flux', 'aegis', 'vector', 'civic', 'econ', 'bio', 'void', 'command'];

type TechRow = [name: string, desc: string, mods: TechDef['mods']];

const TECH_TABLE: Record<Branch, TechRow[]> = {
  flux: [
    ['Gauss-Batterien', 'Magnetisch beschleunigte Projektile mit gestreckter Flugbahn.', { attack: 0.12 }],
    ['Ionenlanzen', 'Fokussierte Plasmastrahlen schmelzen Panzerung statt sie zu durchschlagen.', { attack: 0.14 }],
    ['Plasma-Speier', 'Überhitzte Gaswolken, die im Ziel kollabieren.', { attack: 0.16 }],
    ['Antimaterie-Kanonen', 'Die Sovereign-Klasse trägt zwei davon im Rückgrat.', { attack: 0.18 }],
    ['Singularitäts-Projektoren', 'Ein künstlicher Punkt ohne Rückkehr.', { attack: 0.2 }],
    ['Fusionsfackeln', 'Kurzstreckige Flammenwerfer gegen Raketenschwärme.', { attack: 0.18, hull: 0.04 }],
    ['Graviton-Brecher', 'Schwerkraft als Waffe: der Rumpf faltet sich, bevor er bricht.', { attack: 0.22 }],
    ['Phasenklingen', 'Schneidet durch Felder, als wären sie Meinungen.', { attack: 0.24, hull: 0.05 }],
    ['Nadelwerfer', 'Tausende Projektile, eines davon trifft immer den Reaktor.', { attack: 0.26 }],
    ['Sternenbrand', 'Eine Sonne als Munition. Einmal pro Schlacht.', { attack: 0.3 }],
    ['Vakuum-Riss', 'Öffnet für Sekunden einen Raum ohne Regeln.', { attack: 0.34 }],
    ['Aeterna-Lanze', 'Die letzte Waffe, die noch einen Namen braucht.', { attack: 0.4, hull: 0.08 }],
  ],
  aegis: [
    ['Verbundpanzerung', 'Geschichtete Keramik über Wabenstahl.', { hull: 0.1 }],
    ['Schildgitternetze', 'Mehrere Feldemitter teilen die Last.', { hull: 0.12 }],
    ['Adaptive Schichten', 'Die Hülle lernt beim ersten Treffer.', { hull: 0.14 }],
    ['Nullfeld-Konstanten', 'Ein Feld, das den Impuls nicht weiterreicht.', { hull: 0.16 }],
    ['Aegis-Kern', 'Ein Schiff, das einen Treffer als Vorschlag behandelt.', { hull: 0.18 }],
    ['Kristallpanzer', 'Gezüchtete Panzerung, die Risse selbst schließt.', { hull: 0.16, research: 0.04 }],
    ['Reaktivhüllen', 'Wirft Sprengstoff dem Sprengstoff entgegen.', { hull: 0.2 }],
    ['Absorberfelder', 'Speichert Trefferenergie für den nächsten Schuss.', { hull: 0.22, attack: 0.06 }],
    ['Spiegelplatten', 'Reflektiert einen Teil des ersten Schlags.', { hull: 0.24 }],
    ['Tesserakt-Panzer', 'Die Hülle ist größer innen als außen.', { hull: 0.28 }],
    ['Ereignishorizont', 'Was hineinfällt, kommt nicht als Schaden heraus.', { hull: 0.32 }],
    ['Unsterbliche Hülle', 'Der Rumpf überlebt die Besatzung.', { hull: 0.4 }],
  ],
  vector: [
    ['Fusionsantriebe', 'Mehr Schub, weniger Brennstoff.', { speed: 0.08 }],
    ['Trägheitsbrecher', 'Die Besatzung spürt den Kurswechsel nicht mehr.', { speed: 0.08 }],
    ['Sprungtor-Navigation', 'Lanes werden zu Abkürzungen.', { speed: 0.1 }],
    ['Phasenantrieb', 'Kurzzeitig existiert der Rumpf zwischen zwei Punkten.', { speed: 0.1 }],
    ['Kontinuumssegler', 'Entfernung wird zur Frage der Geduld, nicht der Physik.', { speed: 0.12 }],
    ['Warp-Schleifen', 'Zwei Sprünge, ein Zyklus.', { speed: 0.12 }],
    ['Gravitationssegel', 'Reist im Kielwasser von Sonnen.', { speed: 0.14, income: 0.03 }],
    ['Kurzschluss-Sprung', 'Ein Fehler mit sehr nützlichen Folgen.', { speed: 0.14 }],
    ['Faltraumkern', 'Der Raum macht Platz.', { speed: 0.16 }],
    ['Zeitlinien-Antrieb', 'Ankunft vor dem Start — für kurze Strecken.', { speed: 0.18 }],
    ['Nullpunkt-Tor', 'Ein Tor, das nur für dich aufgeht.', { speed: 0.2 }],
    ['Ewiger Kurs', 'Die Flotte hört nie auf, sich zu bewegen.', { speed: 0.26 }],
  ],
  civic: [
    ['Kolonialverwaltung', 'Archen dürfen gebaut und entsandt werden.', { income: 0.06 }],
    ['Gravitationsarchitektur', 'Habitatringe sind jetzt wirtschaftlich.', { income: 0.08 }],
    ['Orbitalbastionen', 'Verteidigung wird gebaut, nicht erhofft.', { income: 0.08, hull: 0.04 }],
    ['Neurokratie', 'Forschung als Bürgerpflicht.', { research: 0.12, influence: 0.05 }],
    ['Aeterna-Protokoll', 'Der Name des Spiels, endlich verdient.', { income: 0.12, research: 0.08 }],
    ['Bürgerrat', 'Entscheidungen brauchen länger, halten aber.', { income: 0.1, influence: 0.06 }],
    ['Steuerreform', 'Ein Prozent von allem ist immer noch alles.', { income: 0.14 }],
    ['Archivpflicht', 'Jede Kolonie führt Buch. Doppelt.', { research: 0.12 }],
    ['Freihäfen', 'Offene Docks, offene Konten.', { income: 0.16 }],
    ['Verfassungsrecht', 'Ein Vertrag, der auch Kriege überlebt.', { influence: 0.12, income: 0.08 }],
    ['Sternenkodex', 'Regeln, für die ganze Systeme stimmen.', { income: 0.2, influence: 0.14 }],
    ['Ewige Ordnung', 'Die Verwaltung überlebt ihre Verwalter.', { income: 0.26, research: 0.14, influence: 0.16 }],
  ],
  econ: [
    ['Tauschhandel', 'Zwei Frachter, ein Handschlag.', { income: 0.06 }],
    ['Frachtlinien', 'Feste Routen, feste Preise.', { income: 0.08 }],
    ['Kreditnetze', 'Schulden sind auch eine Flotte.', { income: 0.1 }],
    ['Orbitalbörse', 'Der Preis einer Welt, live.', { income: 0.1, influence: 0.04 }],
    ['Handelsflotte', 'Zivile Rümpfe, militärische Gewinne.', { income: 0.14 }],
    ['Zollunion', 'Grenzen kosten jetzt Geld — für andere.', { income: 0.12, influence: 0.06 }],
    ['Ressourcenkartell', 'Wer alles hat, bestimmt den Preis.', { income: 0.18 }],
    ['Bankenring', 'Kredite an Rivalen mit Zinsen aus Krisen.', { income: 0.16, influence: 0.08 }],
    ['Währungsverbund', 'Dein Geld gilt in fremden Häfen.', { income: 0.2 }],
    ['Monopolrecht', 'Der Markt ist ein Ort, den du besitzt.', { income: 0.24, influence: 0.1 }],
    ['Wirtschaftsblock', 'Vier Mächte, eine Bilanz.', { income: 0.28 }],
    ['Goldene Leere', 'Reichtum, der Kriege überflüssig macht.', { income: 0.36, influence: 0.18 }],
  ],
  bio: [
    ['Hydrokulturen', 'Nahrung ohne Boden.', { income: 0.05, research: 0.03 }],
    ['Terraforming', 'Aus Öde wird Acker.', { income: 0.06, research: 0.04 }],
    ['Genspeicher', 'Jede Ernte ist ein Archiv.', { research: 0.06 }],
    ['Symbiose-Pakt', 'Die Kolonie und der Planet verhandeln.', { income: 0.08, research: 0.04 }],
    ['Klongewebe', 'Arbeitskräfte, die nicht streiken.', { income: 0.1 }],
    ['Neuralimpfung', 'Lernen dauert jetzt einen Schlaf.', { research: 0.1 }],
    ['Biopanzerung', 'Hüllen, die bluten und heilen.', { hull: 0.1, income: 0.04 }],
    ['Ökosphären', 'Ganze Welten als Kreislauf.', { income: 0.14, research: 0.06 }],
    ['Xenobiologie', 'Das Fremde wird zur Methode.', { research: 0.14 }],
    ['Erntemaschinen', 'Planeten als Felder.', { income: 0.18 }],
    ['Lebensraum-Presets', 'Jede Welt passt sich an dich an.', { income: 0.12, research: 0.12 }],
    ['Ewiges Blut', 'Die Dynastie ist ein Organismus.', { income: 0.2, research: 0.16 }],
  ],
  void: [
    ['Ruinenkunde', 'Was übrig bleibt, erzählt mehr als Sieger.', { research: 0.06 }],
    ['Artefakt-Scan', 'Fremde Technik, lesbar gemacht.', { research: 0.08 }],
    ['Precursor-Relais', 'Ein Netz, das älter ist als Sternenkarten.', { research: 0.1, speed: 0.04 }],
    ['Leerenkartographie', 'Dort draußen ist mehr als Leere.', { research: 0.12 }],
    ['Schattenphysik', 'Materie, die nur im Dunkeln reagiert.', { attack: 0.1, research: 0.06 }],
    ['Anomalie-Reaktoren', 'Energie aus Fehlern im Raum.', { income: 0.1, research: 0.08 }],
    ['Vergessene Pfade', 'Abkürzungen, die niemand mehr bewacht.', { speed: 0.12 }],
    ['Nullraum-Sonde', 'Sieh, was nicht da ist.', { research: 0.14 }],
    ['Riss-Theorie', 'Ein Riss ist eine Tür mit schlechten Manieren.', { attack: 0.14 }],
    ['Jenseits-Signal', 'Jemand antwortet. Seit Jahrhunderten.', { research: 0.18, influence: 0.08 }],
    ['Tiefenarchiv', 'Alles Wissen der Leere, sortiert.', { research: 0.24 }],
    ['Stimme der Leere', 'Sie spricht jetzt für dich.', { research: 0.3, attack: 0.12, influence: 0.12 }],
  ],
  command: [
    ['Flottenstab', 'Ein Plan, den alle kennen.', { attack: 0.06 }],
    ['Signaldisziplin', 'Befehle kommen vor dem Feind an.', { attack: 0.06, hull: 0.04 }],
    ['Kampfgruppen', 'Verbände lernen, zusammen zu denken.', { attack: 0.08, hull: 0.05 }],
    ['Admiralsrat', 'Sechs Meinungen, eine Flotte.', { attack: 0.08, influence: 0.06 }],
    ['Logistiknetz', 'Nachschub ist eine Waffe.', { hull: 0.08, income: 0.05 }],
    ['Sternenkarten', 'Der Feind steht immer auf der Karte.', { speed: 0.08, attack: 0.05 }],
    ['Taktikschule', 'Angriff als Lehrfach.', { attack: 0.12 }],
    ['Reserveflotten', 'Was übrig ist, kämpft weiter.', { hull: 0.1 }],
    ['Kommandokette', 'Kein Befehl geht verloren.', { attack: 0.1, hull: 0.06 }],
    ['Kriegsakademie', 'Jeder Offizier hat eine Schlacht vorbereitet.', { attack: 0.14 }],
    ['Flottenmarschall', 'Ein Name, der Formationen ordnet.', { attack: 0.16, hull: 0.1 }],
    ['Oberster Befehl', 'Die Flotte handelt, bevor du es ausspricht.', { attack: 0.22, hull: 0.14 }],
  ],
};

function techCost(tier: number): number {
  // The first slowdown fixed the 90 % technology monoculture, but left the
  // Aeterna path below 10 % in the matrix. This curve is deliberately between
  // the old 45-base sprint and the 60-base correction: 48 technologies remain
  // a real late-game project instead of a runaway or a dead branch.
  return Math.round(56 * Math.pow(1.25, tier - 1));
}

export const TECHS: TechDef[] = BRANCH_ORDER.flatMap((branch) =>
  TECH_TABLE[branch].map((row, i) => ({
    id: `${branch}${i + 1}`,
    branch,
    tier: i + 1,
    name: row[0],
    desc: row[1],
    cost: techCost(i + 1),
    mods: row[2],
  })),
);

export const TECHS_BY_BRANCH: Record<Branch, TechDef[]> = Object.fromEntries(
  BRANCH_ORDER.map((b) => [b, TECHS.filter((t) => t.branch === b)]),
) as Record<Branch, TechDef[]>;

export const TECH_BY_ID = Object.fromEntries(TECHS.map((t) => [t.id, t])) as Record<string, TechDef>;

export function shipUnlocked(id: ShipId, tierOf: (b: Branch) => number): boolean {
  switch (id) {
    case 'scout':
    case 'corvette':
      return true;
    case 'raider':
      return tierOf('vector') >= 1;
    case 'frigate':
      return tierOf('aegis') >= 1;
    case 'destroyer':
      return tierOf('flux') >= 3;
    case 'cruiser':
      return tierOf('flux') >= 4;
    case 'carrier':
      return tierOf('vector') >= 3 && tierOf('flux') >= 3;
    case 'battleship':
      return tierOf('flux') >= 6 && tierOf('aegis') >= 4;
    case 'dreadnought':
      return tierOf('flux') >= 8 && tierOf('aegis') >= 6;
    case 'titan':
      return tierOf('flux') >= 10 && tierOf('aegis') >= 8 && tierOf('civic') >= 6;
    case 'bulwark':
      return tierOf('aegis') >= 3;
    case 'lance':
      return tierOf('flux') >= 5 && tierOf('command') >= 2;
    case 'ark':
      return tierOf('civic') >= 1;
    default:
      // Player designs from the Ship Designer need no technology.
      return id.startsWith('custom_');
  }
}

export function buildingUnlocked(id: BuildingId, tierOf: (b: Branch) => number): boolean {
  switch (id) {
    case 'habitat':
    case 'solar':
    case 'foundry':
      return tierOf('civic') >= 2;
    case 'bastion':
    case 'archive':
      return tierOf('civic') >= 3;
    case 'monument':
      return tierOf('civic') >= 4;
    case 'academy':
      return tierOf('civic') >= 5;
    case 'market':
      return tierOf('econ') >= 2;
    case 'refinery':
      return tierOf('econ') >= 3;
    case 'fortress':
      return tierOf('aegis') >= 3;
    case 'shieldgrid':
      return tierOf('aegis') >= 5;
    case 'dockyard':
      return tierOf('vector') >= 3;
    default:
      return true;
  }
}

export const WIN_SYSTEMS = 8;
export const WIN_TECHS = 48;
export const WIN_COLONIES = 5;
export const WIN_ENERGY = 130;
export const WIN_TRADE_TIER = 4;
export const MAX_CYCLES = 240;
