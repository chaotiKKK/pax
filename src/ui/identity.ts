import { BRANCHES, BRANCH_ORDER, BUILDING_ORDER, FACTIONS_BY_ID } from '../data';
import type { BuildingId, FactionId } from '../types';

/**
 * Cosmetic empire identity: name, three accent colours, banner crest and
 * pattern, an architectural style that changes the building cards, and a
 * preferred research branch ("Hauslehre"). It is a local skin — the simulation
 * never reads it, so LAN snapshots stay untouched and every client can carry
 * its own heraldry.
 */
export interface EmpireIdentity {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  crest: number;
  pattern: number;
  style: string;
  tech: string;
}

export interface ArchStyle {
  id: string;
  name: string;
  desc: string;
  sigil: string;
  glyphs: string[];
}

const STORAGE_KEY = 'pax-aeterna-identity';

export const DEFAULT_IDENTITY: EmpireIdentity = {
  name: '',
  primary: '#f0a63f',
  secondary: '#23384a',
  accent: '#f3ecdd',
  crest: 0,
  pattern: 1,
  style: 'imperial',
  tech: 'balanced',
};

export const PRIMARY_SWATCHES = ['#f0a63f', '#e0566b', '#62d2c4', '#a98bf0', '#8fce9c', '#6f9bd1', '#d9b45a', '#cfd6de'];
export const SECONDARY_SWATCHES = ['#23384a', '#3a2230', '#1f3a33', '#2c2740', '#3d3320', '#1d2b3c'];
export const ACCENT_SWATCHES = ['#f3ecdd', '#ffd9a0', '#9fe5d8', '#d8c7ff', '#ffe3e8', '#c9d4e2'];

export const ARCH_STYLES: ArchStyle[] = [
  {
    id: 'imperial',
    name: 'Imperialer Klassizismus',
    desc: 'Symmetrie, Achsen, steinerne Würde. Bauten wirken wie Ämter, die niemals schließen.',
    sigil: '✶',
    glyphs: ['⌂', '◉', '⛏', '✦', '◍', '⛨', '☀', '⚒', '⌸', '⇄', '⛫', '⚓', '✧', '△', '⌬', '⊛'],
  },
  {
    id: 'organic',
    name: 'Biomorpher Organismus',
    desc: 'Gewachsene Tragwerke, Häute statt Fassaden. Jede Kolonie sieht aus, als würde sie atmen.',
    sigil: '❋',
    glyphs: ['❋', '◉', '❖', '✿', '❍', '⬡', '☀', '⬢', '❂', '⇝', '❈', '⚘', '✺', '✹', '❉', '◎'],
  },
  {
    id: 'brutalist',
    name: 'Brutalistischer Block',
    desc: 'Sichtbarer Beton, ehrliche Kanten, keine Verzierung. Was hält, braucht kein Ornament.',
    sigil: '▣',
    glyphs: ['▣', '◼', '◆', '▤', '▥', '▦', '▧', '▨', '▩', '◧', '◨', '◩', '◪', '◫', '⬓', '⬔'],
  },
  {
    id: 'nomad',
    name: 'Nomadische Ringe',
    desc: 'Modulare Ringe, die sich trennen und wieder verbinden. Architektur als Reise, nicht als Ort.',
    sigil: '◎',
    glyphs: ['◎', '○', '◌', '◍', '◐', '◑', '◒', '◓', '◔', '◕', '◖', '◗', '◜', '◝', '◞', '◟'],
  },
  {
    id: 'sacral',
    name: 'Sakrales Maßwerk',
    desc: 'Spitzbögen, Lichter, vertikale Geste. Selbst eine Raffinerie bekommt hier ein Fenster.',
    sigil: '✠',
    glyphs: ['✚', '☩', '✠', '✟', '☨', '✞', '✛', '✜', '✝', '†', '‡', '⛨', '⛪', '⛯', '☦', '☧'],
  },
];

const TECH_SIGILS: Record<string, string> = {
  aegis: '⛨',
  bio: '❋',
  civic: '⚖',
  command: '✦',
  econ: '⛭',
  flux: '≈',
  vector: '➤',
  void: '◌',
};

export interface TechOption {
  id: string;
  name: string;
  sigil: string;
}

export const TECH_OPTIONS: TechOption[] = [
  { id: 'balanced', name: 'Ausgeglichen', sigil: '◇' },
  ...BRANCH_ORDER.map((b) => ({ id: b, name: BRANCHES[b].name, sigil: TECH_SIGILS[b] ?? '✦' })),
];

export function techLabel(id: string): string {
  return TECH_OPTIONS.find((t) => t.id === id)?.name ?? 'Ausgeglichen';
}

export function archStyle(id: string): ArchStyle {
  return ARCH_STYLES.find((s) => s.id === id) ?? ARCH_STYLES[0];
}

export function styleGlyph(styleId: string, building: BuildingId): string {
  const style = archStyle(styleId);
  const index = BUILDING_ORDER.indexOf(building);
  return style.glyphs[index] ?? '·';
}

// ---------------------------------------------------------------------------
// persistence
// ---------------------------------------------------------------------------
function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[<>&"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

function sanitize(raw: unknown): EmpireIdentity {
  const value = (raw ?? {}) as Partial<EmpireIdentity> & { color?: string };
  const primary = hex(value.primary ?? value.color, DEFAULT_IDENTITY.primary);
  const crest = Number.isInteger(value.crest) ? Math.max(0, Math.min(5, value.crest as number)) : DEFAULT_IDENTITY.crest;
  const pattern = Number.isInteger(value.pattern) ? Math.max(0, Math.min(4, value.pattern as number)) : DEFAULT_IDENTITY.pattern;
  const style = ARCH_STYLES.some((s) => s.id === value.style) ? (value.style as string) : DEFAULT_IDENTITY.style;
  const tech = TECH_OPTIONS.some((t) => t.id === value.tech) ? (value.tech as string) : DEFAULT_IDENTITY.tech;
  return {
    name: cleanName(value.name),
    primary,
    secondary: hex(value.secondary, DEFAULT_IDENTITY.secondary),
    accent: hex(value.accent, DEFAULT_IDENTITY.accent),
    crest,
    pattern,
    style,
    tech,
  };
}

export function loadIdentity(): EmpireIdentity {
  try {
    return sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_IDENTITY };
  }
}

export function saveIdentity(identity: EmpireIdentity): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(identity)));
  } catch {
    /* storage may be unavailable in private windows */
  }
}

// ---------------------------------------------------------------------------
// heraldry
// ---------------------------------------------------------------------------
export const BANNER_PATTERNS = ['Teilung', 'Streifen', 'Winkel', 'Orbit', 'Strahlen'];

export function crestMarkup(shape: number, color: string): string {
  switch (((shape % 6) + 6) % 6) {
    case 1:
      return `<path d="M24 6l18 18-18 18L6 24z" fill="none" stroke="${color}" stroke-width="1.3"/>
        <path d="M24 14l10 10-10 10-10-10z" fill="none" stroke="${color}" stroke-width="0.7" opacity="0.65"/>
        <circle cx="24" cy="24" r="2.4" fill="${color}"/>`;
    case 2:
      return `<path d="M24 5l15 6v14c0 9-7 15-15 18-8-3-15-9-15-18V11z" fill="none" stroke="${color}" stroke-width="1.2"/>
        <path d="M24 13v20M16 22h16" stroke="${color}" stroke-width="1.1"/>`;
    case 3:
      return `<circle cx="24" cy="15" r="5" fill="none" stroke="${color}" stroke-width="1.1"/>
        <circle cx="15" cy="32" r="5" fill="none" stroke="${color}" stroke-width="1.1"/>
        <circle cx="33" cy="32" r="5" fill="none" stroke="${color}" stroke-width="1.1"/>
        <path d="M24 20l-6 8M24 20l6 8M20 32h8" stroke="${color}" stroke-width="0.7"/>
        <circle cx="24" cy="24" r="2" fill="${color}"/>`;
    case 4:
      return `<path d="M24 5l4.6 12.4L42 19l-10 8.6L35 41l-11-7-11 7 3-13.4L6 19l13.4-1.6z" fill="none" stroke="${color}" stroke-width="1.2"/>
        <circle cx="24" cy="24" r="2.4" fill="${color}"/>`;
    case 5:
      return `<path d="M24 5l16.5 9.5v19L24 43 7.5 33.5v-19z" fill="none" stroke="${color}" stroke-width="1.2"/>
        <path d="M16 17h16M16 24h16M16 31h16" stroke="${color}" stroke-width="0.8" opacity="0.7"/>
        <circle cx="24" cy="24" r="2" fill="${color}"/>`;
    default:
      return `<polygon points="24,6 41,33 7,33" fill="none" stroke="${color}" stroke-width="1.2"/>
        <circle cx="24" cy="24" r="9" fill="none" stroke="${color}" stroke-width="0.6" opacity="0.6"/>
        <circle cx="24" cy="24" r="2.6" fill="${color}"/>`;
  }
}

function patternMarkup(pattern: number, color: string): string {
  switch (pattern) {
    case 1:
      return `<path d="M26 0v80M58 0v80M90 0v80M122 0v80" stroke="${color}" stroke-width="9" opacity="0.55"/>`;
    case 2:
      return `<path d="M0 62l40-26 40 26 40-26v18L80 54 40 80 0 54z" fill="${color}" opacity="0.6"/>`;
    case 3:
      return `<circle cx="80" cy="40" r="30" fill="none" stroke="${color}" stroke-width="1.4" opacity="0.85"/>
        <circle cx="80" cy="40" r="38" fill="none" stroke="${color}" stroke-width="0.6" opacity="0.5"/>`;
    case 4:
      return `<g opacity="0.5" stroke="${color}" stroke-width="2">
        <path d="M80 40L8 6M80 40L152 6M80 40L8 74M80 40L152 74M80 40L80 0M80 40L80 80"/></g>`;
    default:
      return `<path d="M0 80L160 0" stroke="${color}" stroke-width="26" opacity="0.3"/>`;
  }
}

function shortFrom(name: string, fallback: string): string {
  if (!name) return fallback;
  const first = name.split(' ')[0] ?? name;
  return first.slice(0, 9).toUpperCase();
}

export function bannerSvg(identity: EmpireIdentity, faction: FactionId, cls = 'ie-banner'): string {
  const fallback = FACTIONS_BY_ID[faction] ?? null;
  const label = shortFrom(identity.name, fallback ? fallback.short : 'REICH');
  return `<svg class="${cls}" viewBox="0 0 160 100" role="img" aria-label="Banner">
    <rect x="0.5" y="0.5" width="159" height="99" fill="#080c13" stroke="${identity.primary}" stroke-opacity="0.45"/>
    ${patternMarkup(identity.pattern, identity.secondary)}
    <g transform="translate(35.6 9) scale(1.85)">${crestMarkup(identity.crest, identity.accent)}</g>
    <text x="80" y="93" text-anchor="middle" font-family="Bahnschrift, Segoe UI, sans-serif" font-size="9" letter-spacing="2.4" fill="${identity.primary}">${label}</text>
  </svg>`;
}

// ---------------------------------------------------------------------------
// applying a skin to a faction (local only)
// ---------------------------------------------------------------------------
interface FactionDefaults {
  name: string;
  short: string;
  css: string;
  cssSoft: string;
  color: number;
}

const DEFAULTS = new Map<FactionId, FactionDefaults>(
  Object.values(FACTIONS_BY_ID).map((f) => [
    f.id,
    { name: f.name, short: f.short, css: f.css, cssSoft: f.cssSoft, color: f.color },
  ]),
);
const CRESTS = new Map<FactionId, number>();
const PATTERNS = new Map<FactionId, number>();

function rgba(hexColor: string, alpha: number): string {
  const n = Number.parseInt(hexColor.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function defaultFactionName(faction: FactionId): string {
  return DEFAULTS.get(faction)?.name ?? FACTIONS_BY_ID[faction]?.name ?? faction;
}

export function applyIdentityToFaction(faction: FactionId, identity: EmpireIdentity): void {
  const def = FACTIONS_BY_ID[faction];
  const original = DEFAULTS.get(faction);
  if (!def || !original) return;
  const clean = sanitize(identity);
  def.css = clean.primary;
  def.cssSoft = rgba(clean.primary, 0.16);
  def.color = Number.parseInt(clean.primary.slice(1), 16);
  def.name = clean.name || original.name;
  def.short = clean.name ? shortFrom(clean.name, original.short) : original.short;
  CRESTS.set(faction, clean.crest);
  PATTERNS.set(faction, clean.pattern);
}

export function crestFor(faction: FactionId): number {
  return CRESTS.get(faction) ?? -1;
}

export function patternFor(faction: FactionId): number {
  return PATTERNS.get(faction) ?? 0;
}

export function restoreFaction(faction: FactionId): void {
  const def = FACTIONS_BY_ID[faction];
  const original = DEFAULTS.get(faction);
  if (!def || !original) return;
  def.name = original.name;
  def.short = original.short;
  def.css = original.css;
  def.cssSoft = original.cssSoft;
  def.color = original.color;
  CRESTS.delete(faction);
  PATTERNS.delete(faction);
}

// ---------------------------------------------------------------------------
// editor markup (title screen and in-game modal share it)
// ---------------------------------------------------------------------------
function colorRow(key: 'primary' | 'secondary' | 'accent', label: string, identity: EmpireIdentity, swatches: string[]): string {
  return `<div class="ie-color-row">
    <span class="ie-label">${label}</span>
    <input type="color" data-ie="color" data-key="${key}" value="${identity[key]}" />
    <span class="ie-opts">${swatches
      .map(
        (c) =>
          `<button class="ie-swatch ${identity[key] === c ? 'is-on' : ''}" data-ie="swatch" data-key="${key}" data-v="${c}" style="--sw:${c}" title="${c}" aria-label="${label} ${c}"></button>`,
      )
      .join('')}</span>
  </div>`;
}

function buildingPreview(identity: EmpireIdentity): string {
  return BUILDING_ORDER.slice(0, 3)
    .map(
      (b) => `<div class="build-btn is-preview">
        <span class="glyph">${styleGlyph(identity.style, b)}</span>
        <span>${BRANCH_LABEL(b)}<br><span class="cost">Stilprobe</span></span>
        <span class="cnt"></span>
      </div>`,
    )
    .join('');
}

function BRANCH_LABEL(building: BuildingId): string {
  switch (building) {
    case 'mine':
      return 'Schürfer';
    case 'lab':
      return 'Labor';
    case 'shipyard':
      return 'Werft';
    default:
      return 'Bauwerk';
  }
}

export function identityEditorHtml(faction: FactionId): string {
  const identity = loadIdentity();
  const style = archStyle(identity.style);
  return `
    <div class="identity-editor" data-ie-faction="${faction}">
      <div class="ie-head">
        <span class="eyebrow">Reichsidentität</span>
        <span class="ie-head-actions">
          <button class="btn btn-sm btn-ghost" data-ie="random">Zufall</button>
          <button class="btn btn-sm btn-ghost" data-ie="reset">Standard</button>
        </span>
      </div>
      <div class="ie-body">
        <div class="ie-side">
          <div class="ie-flag">${bannerSvg(identity, faction)}</div>
          <div class="ie-build-preview building-grid" data-style="${identity.style}" style="--ie-accent:${identity.accent};--ie-secondary:${identity.secondary}">
            ${buildingPreview(identity)}
          </div>
          <span class="ie-caption">Bauwesen-Vorschau · ${style.name}</span>
        </div>
        <div class="ie-controls">
          <label class="ie-name">Reichsname
            <input type="text" data-ie="name" maxlength="24" value="${identity.name.replace(/"/g, '&quot;')}" placeholder="${defaultFactionName(faction)}" />
          </label>
          ${colorRow('primary', 'Primär', identity, PRIMARY_SWATCHES)}
          ${colorRow('secondary', 'Sekundär', identity, SECONDARY_SWATCHES)}
          ${colorRow('accent', 'Akzent', identity, ACCENT_SWATCHES)}
          <div class="ie-row"><span class="ie-label">Emblem</span><span class="ie-opts">
            ${[0, 1, 2, 3, 4, 5]
              .map(
                (i) => `<button class="ie-opt ie-crest ${i === identity.crest ? 'is-on' : ''}" data-ie="crest" data-v="${i}" title="Emblem ${i + 1}">
                  <svg viewBox="0 0 48 48">${crestMarkup(i, identity.accent)}</svg></button>`,
              )
              .join('')}
          </span></div>
          <div class="ie-row"><span class="ie-label">Banner</span><span class="ie-opts">
            ${BANNER_PATTERNS.map(
              (label, i) => `<button class="ie-opt ie-pat ${i === identity.pattern ? 'is-on' : ''}" data-ie="pattern" data-v="${i}" title="${label}">
                <svg viewBox="0 0 160 100"><rect width="160" height="100" fill="#0a0e15"/>${patternPreview(i, identity.secondary)}</svg>
              </button>`,
            ).join('')}
          </span></div>
          <div class="ie-row"><span class="ie-label">Stil</span><span class="ie-opts ie-styles">
            ${ARCH_STYLES.map(
              (s) => `<button class="ie-opt ie-style ${s.id === identity.style ? 'is-on' : ''}" data-ie="style" data-v="${s.id}" title="${s.name}">${s.sigil}</button>`,
            ).join('')}
          </span></div>
          <div class="ie-row"><span class="ie-label">Hauslehre</span><span class="ie-opts ie-techs">
            ${TECH_OPTIONS.map(
              (t) => `<button class="ie-opt ie-tech ${t.id === identity.tech ? 'is-on' : ''}" data-ie="tech" data-v="${t.id}" title="${t.name}">${t.sigil}</button>`,
            ).join('')}
          </span></div>
          <p class="ie-style-desc">${style.desc}</p>
        </div>
      </div>
      <p class="hint ie-hint">Kosmetik für dein Reich: Name, Farben, Wappen, Banner, Baustil und Technikausrichtung. Wird lokal gespeichert und wirkt sofort auf HUD, Flotten und Bauwesen.</p>
    </div>`;
}

function patternPreview(pattern: number, color: string): string {
  switch (pattern) {
    case 1:
      return `<path d="M26 0v100M58 0v100M90 0v100M122 0v100" stroke="${color}" stroke-width="14" opacity="0.9"/>`;
    case 2:
      return `<path d="M0 74l40-30 40 30 40-30v22L80 96 40 66 0 96z" fill="${color}" opacity="0.9"/>`;
    case 3:
      return `<circle cx="80" cy="50" r="28" fill="none" stroke="${color}" stroke-width="3" opacity="0.9"/>`;
    case 4:
      return `<g opacity="0.85" stroke="${color}" stroke-width="3"><path d="M80 50L10 12M80 50L150 12M80 50L10 88M80 50L150 88"/></g>`;
    default:
      return `<path d="M0 100L160 0" stroke="${color}" stroke-width="30" opacity="0.8"/>`;
  }
}

// ---------------------------------------------------------------------------
// editor behaviour
// ---------------------------------------------------------------------------
let applyCallback: ((identity: EmpireIdentity) => void) | null = null;

function paint(root: HTMLElement): void {
  const identity = loadIdentity();
  const faction = (root.querySelector('[data-ie-faction]') as HTMLElement | null)?.dataset.ieFaction as FactionId | undefined;
  const flag = root.querySelector('.ie-flag');
  if (flag && faction) flag.innerHTML = bannerSvg(identity, faction);

  const name = root.querySelector('[data-ie="name"]') as HTMLInputElement | null;
  if (name && document.activeElement !== name) name.value = identity.name;

  root.querySelectorAll('[data-ie="color"]').forEach((el) => {
    const input = el as HTMLInputElement;
    const key = input.dataset.key as 'primary' | 'secondary' | 'accent' | undefined;
    if (key) input.value = identity[key];
  });
  root.querySelectorAll('[data-ie="swatch"]').forEach((el) => {
    const btn = el as HTMLElement;
    const key = btn.dataset.key as 'primary' | 'secondary' | 'accent' | undefined;
    btn.classList.toggle('is-on', !!key && btn.dataset.v === identity[key]);
  });
  root.querySelectorAll('[data-ie="crest"]').forEach((el) => {
    el.classList.toggle('is-on', Number((el as HTMLElement).dataset.v) === identity.crest);
  });
  root.querySelectorAll('[data-ie="pattern"]').forEach((el) => {
    el.classList.toggle('is-on', Number((el as HTMLElement).dataset.v) === identity.pattern);
  });
  root.querySelectorAll('[data-ie="style"]').forEach((el) => {
    const btn = el as HTMLElement;
    btn.classList.toggle('is-on', btn.dataset.v === identity.style);
  });
  root.querySelectorAll('[data-ie="tech"]').forEach((el) => {
    const btn = el as HTMLElement;
    btn.classList.toggle('is-on', btn.dataset.v === identity.tech);
  });

  const style = archStyle(identity.style);
  const desc = root.querySelector('.ie-style-desc');
  if (desc) desc.textContent = style.desc;
  const caption = root.querySelector('.ie-caption');
  if (caption) caption.textContent = `Bauwesen-Vorschau · ${style.name}`;

  const preview = root.querySelector('.ie-build-preview') as HTMLElement | null;
  if (preview) {
    preview.dataset.style = identity.style;
    preview.style.setProperty('--ie-accent', identity.accent);
    preview.style.setProperty('--ie-secondary', identity.secondary);
    preview.querySelectorAll('.build-btn').forEach((el, i) => {
      const glyph = el.querySelector('.glyph');
      const building = BUILDING_ORDER[i];
      if (glyph && building) glyph.textContent = styleGlyph(identity.style, building);
    });
  }
  applyCallback?.(identity);
}

function colorPatch(key: 'primary' | 'secondary' | 'accent', value: string): Partial<EmpireIdentity> {
  if (key === 'primary') return { primary: value };
  if (key === 'secondary') return { secondary: value };
  return { accent: value };
}

function commit(root: HTMLElement, patch: Partial<EmpireIdentity>): void {
  const next = sanitize({ ...loadIdentity(), ...patch });
  saveIdentity(next);
  paint(root);
}

export function refreshIdentityEditor(root: HTMLElement): void {
  paint(root);
}

export function bindIdentityEditor(root: HTMLElement, onApply?: (identity: EmpireIdentity) => void): void {
  if (onApply) applyCallback = onApply;
  if (root.dataset.ieBound === '1') {
    paint(root);
    return;
  }
  root.dataset.ieBound = '1';

  root.addEventListener('input', (ev) => {
    const target = ev.target as HTMLInputElement;
    if (target.dataset.ie === 'name') commit(root, { name: target.value });
    if (target.dataset.ie === 'color') {
      const key = target.dataset.key as 'primary' | 'secondary' | 'accent' | undefined;
      if (key && /^#[0-9a-f]{6}$/i.test(target.value)) commit(root, colorPatch(key, target.value));
    }
  });

  root.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest('[data-ie]') as HTMLElement | null;
    if (!target) return;
    const act = target.dataset.ie;
    if (act === 'swatch' && target.dataset.v) {
      const key = target.dataset.key as 'primary' | 'secondary' | 'accent' | undefined;
      if (key) commit(root, colorPatch(key, target.dataset.v));
    } else if (act === 'crest') commit(root, { crest: Number(target.dataset.v ?? 0) });
    else if (act === 'pattern') commit(root, { pattern: Number(target.dataset.v ?? 0) });
    else if (act === 'style' && target.dataset.v) commit(root, { style: target.dataset.v });
    else if (act === 'tech' && target.dataset.v) commit(root, { tech: target.dataset.v });
    else if (act === 'random') {
      const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];
      commit(root, {
        primary: pick(PRIMARY_SWATCHES),
        secondary: pick(SECONDARY_SWATCHES),
        accent: pick(ACCENT_SWATCHES),
        crest: Math.floor(Math.random() * 6),
        pattern: Math.floor(Math.random() * 5),
        style: ARCH_STYLES[Math.floor(Math.random() * ARCH_STYLES.length)].id,
        tech: TECH_OPTIONS[Math.floor(Math.random() * TECH_OPTIONS.length)].id,
      });
    } else if (act === 'reset') commit(root, { ...DEFAULT_IDENTITY });
  });

  paint(root);
}
