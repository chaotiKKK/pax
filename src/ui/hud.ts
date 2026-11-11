import {
  BRANCHES,
  BRANCH_ORDER,
  BUILDINGS,
  BUILDING_ORDER,
  FACTIONS,
  FACTIONS_BY_ID,
  FACTION_IDS,
  PLANET_TYPES,
  SHIP_CLASSES,
  SHIP_ORDER,
  TECHS_BY_BRANCH,
  TECH_BY_ID,
  WIN_COLONIES,
  WIN_ENERGY,
  WIN_SYSTEMS,
  WIN_TECHS,
  WIN_TRADE_TIER,
  buildingUnlocked,
  shipUnlocked,
} from '../data';
import {
  colonyCap,
  colonyDefense,
  colonyOutput,
  empireMods,
  fleetPower,
  hullOf,
  incomeOf,
  relOf,
  stateOf,
  techTier,
} from '../sim';
import type { Branch, BuildingId, FactionId, Fleet, Game, Planet, ShipId, StarSystem } from '../types';
import {
  applyIdentityToFaction,
  archStyle,
  bindIdentityEditor,
  crestFor,
  crestMarkup,
  identityEditorHtml,
  loadIdentity,
  refreshIdentityEditor,
  styleGlyph,
  techLabel,
} from './identity';
import { GOVERNMENTS, RACE_TRAITS, RELIGIONS, START_HULLS, WORLDVIEWS, optionById } from '../profile';
import { listSaves, saveMetaLine } from '../save';
import { listArmyTemplates } from '../ships/armies';
import { helpContentHtml } from './helpView';

export type TabId = 'sector' | 'fleets' | 'empire' | 'research' | 'diplomacy';

export interface UIState {
  game: Game | null;
  tab: TabId;
  system: number | null;
  planet: number | null;
  fleet: number | null;
  targetFleet: number | null;
  audio: boolean;
  busy: boolean;
  /** True while the system scope covers the centre stage (central system view). */
  systemStage: boolean;
}

export interface HudActions {
  selectSystem(id: number | null): void;
  selectPlanet(id: number | null): void;
  selectFleet(id: number | null): void;
  beginTarget(fleetId: number): void;
  cancelTarget(): void;
  haltFleet?(fleetId: number): void;
  toggleSystemStage?(): void;
  colonize(planetId: number): void;
  build(planetId: number, b: BuildingId): void;
  buildShip(planetId: number, s: ShipId): void;
  research(branch: Branch, techId: string): void;
  diplo(other: FactionId, action: 'gift' | 'pact' | 'alliance' | 'war' | 'peace'): void;
  endCycle(): void;
  setTab(tab: TabId): void;
  startGame(faction: FactionId, seed: number, armyId?: string): void;
  backToMenu?(): void;
  openPause?(): void;
  openShipDesigner?(): void;
  openArmyEditor?(): void;
  toggleAudio(): void;
  lanHost?(): void;
  lanJoin?(): void;
  identityChanged?(): void;
  clearSelection?(): void;
  getAudioSettings?(): { music: number; sfx: number };
  setAudioVolume?(bus: 'music' | 'sfx', value: number): void;
  saveGame?(slot: number): void;
  loadGame?(slot: number): void;
  deleteSave?(slot: number): void;
  exportSave?(): void;
  importSave?(file: File): void;
  continueGame?(): void;
}

// NOTE: no module-level snapshot of SHIP_ORDER — custom ships are registered
// into SHIP_CLASSES/SHIP_ORDER at boot, after this module is evaluated.

const nf = (n: number, digits = 0) =>
  n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function escapeHtml(text: string): string {
  return text.replace(/[&<>'\"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch] ?? ch));
}

function legacyCrest(id: FactionId, c: string): string {
  const idx = Math.max(0, FACTION_IDS.indexOf(id));
  const sides = 3 + (idx % 6);
  const radius = 14 + (idx % 4);
  const pts = Array.from({ length: sides }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / sides + (idx % 3) * 0.12;
    return `${(24 + Math.cos(a) * radius).toFixed(1)},${(24 + Math.sin(a) * radius).toFixed(1)}`;
  }).join(' ');
  return `<polygon points="${pts}" fill="none" stroke="${c}" stroke-width="1.1"/>
    <circle cx="24" cy="24" r="${3 + (idx % 3)}" fill="${c}"/>
    <path d="M24 4.5v7.5M24 36v7.5M4.5 24h7.5M36 24h7.5" stroke="${c}" stroke-width="0.7"/>`;
}

function crestSvg(id: FactionId, cls = 'crest'): string {
  const faction = FACTIONS_BY_ID[id];
  const c = faction ? faction.css : '#f0a63f';
  const shape = crestFor(id);
  const inner = shape >= 0 ? crestMarkup(shape, c) : legacyCrest(id, c);
  return `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true">${inner}</svg>`;
}


function shipSummary(f: Fleet): string {
  const parts = SHIP_ORDER.filter((c) => f.ships[c] > 0).map((c) => `${f.ships[c]}× ${SHIP_CLASSES[c]?.role ?? c}`);
  return parts.length ? parts.join(' · ') : 'leer';
}

function integrity(g: Game, f: Fleet): number {
  const mods = empireMods(g, f.owner);
  const max = SHIP_ORDER.reduce((s, c) => s + f.ships[c] * SHIP_CLASSES[c].hull * mods.hull, 0);
  return max > 0 ? Math.max(0, Math.min(1, hullOf(f) / max)) : 0;
}

function dateLabel(cycle: number): string {
  const year = 2187 + Math.floor((cycle - 1) / 12);
  const month = ((cycle - 1) % 12) + 1;
  return `${year}.${String(month).padStart(2, '0')}`;
}

function systemOwnerLabel(sys: StarSystem): string {
  if (!sys.owner) return 'unbeansprucht';
  return FACTIONS_BY_ID[sys.owner].name;
}

export class Hud {
  private shell!: HTMLDivElement;
  private railEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private tabsEl!: HTMLElement;
  private topEl!: HTMLElement;
  private commandEl!: HTMLElement;
  private scopeEl!: HTMLElement;
  private scopeHead!: HTMLElement;
  private toastHost!: HTMLDivElement;
  private overlayRoot!: HTMLDivElement;
  private veil!: HTMLDivElement;
  private stamp!: HTMLDivElement;
  private state: UIState = {
    game: null,
    tab: 'sector',
    system: null,
    planet: null,
    fleet: null,
    targetFleet: null,
    audio: true,
    busy: false,
    systemStage: false,
  };
  private titleFaction: FactionId = 'concord';
  readonly scopeCanvas: HTMLCanvasElement;

  constructor(private root: HTMLElement, private actions: HudActions) {
    this.buildShell();
    this.scopeCanvas = this.scopeEl.querySelector('canvas') as HTMLCanvasElement;
    document.addEventListener('click', this.handleClick);
    document.addEventListener('input', this.handleInput);
    this.showTitle();
  }

  private buildShell(): void {
    this.shell = document.createElement('div');
    this.shell.className = 'shell';
    this.shell.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark"><span>✦</span></div>
          <div><h1>Pax Aeterna</h1><small>Cycles of the Void</small></div>
        </div>
        <div class="topbar-center" id="topbar-center"></div>
        <div class="topbar-right">
          <button class="icon-btn" data-act="identity" title="Reichsidentität — Name, Farben, Banner, Baustil (I)" aria-label="Reichsidentität bearbeiten">◈</button>
          <button class="icon-btn" data-act="arsenal" title="Arsenal — Schiffsdatenbank" aria-label="Arsenal öffnen">⌖</button>
          <button class="icon-btn" data-act="audio" title="Ton umschalten" aria-label="Ton umschalten" id="audio-btn">♪</button>
          <button class="icon-btn" data-act="saveload" title="Speichern / Laden (F5 / F9)" aria-label="Speichern oder laden">💾</button>
          <button class="icon-btn" data-act="help" title="Handbuch" aria-label="Handbuch öffnen">?</button>
          <button class="icon-btn" data-act="pause" title="Pause-Menü (Esc)" aria-label="Pause-Menü öffnen">⏸</button>
          <button class="icon-btn" data-act="menu" title="Hauptmenü" aria-label="Zum Hauptmenü">☰</button>
        </div>
      </header>
      <aside class="rail" id="rail"></aside>
      <section class="stage" id="stage"></section>
      <aside class="panel">
        <nav class="tabs" id="tabs"></nav>
        <div class="scope" id="scope">
          <canvas></canvas>
          <div class="scope-head" id="scope-head"></div>
        </div>
        <div class="panel-body" id="panel-body"></div>
      </aside>
      <footer class="command" id="command"></footer>`;
    this.root.appendChild(this.shell);

    this.railEl = this.shell.querySelector('#rail') as HTMLElement;
    this.bodyEl = this.shell.querySelector('#panel-body') as HTMLElement;
    this.tabsEl = this.shell.querySelector('#tabs') as HTMLElement;
    this.topEl = this.shell.querySelector('#topbar-center') as HTMLElement;
    this.commandEl = this.shell.querySelector('#command') as HTMLElement;
    this.scopeEl = this.shell.querySelector('#scope') as HTMLElement;
    this.scopeHead = this.shell.querySelector('#scope-head') as HTMLElement;

    const stage = this.shell.querySelector('#stage') as HTMLElement;
    this.toastHost = document.createElement('div');
    this.toastHost.className = 'toasts';
    stage.appendChild(this.toastHost);

    const overlays = document.getElementById('overlays') as HTMLElement;
    this.overlayRoot = document.createElement('div');
    this.overlayRoot.className = 'overlay-root';
    overlays.appendChild(this.overlayRoot);

    this.veil = document.createElement('div');
    this.veil.className = 'cycle-veil';
    overlays.appendChild(this.veil);
    this.stamp = document.createElement('div');
    this.stamp.className = 'cycle-stamp';
    overlays.appendChild(this.stamp);
  }

  get stageHost(): HTMLElement {
    return this.shell.querySelector('#stage') as HTMLElement;
  }

  setState(next: Partial<UIState>): void {
    this.state = { ...this.state, ...next };
    this.render();
  }

  getState(): UIState {
    return this.state;
  }

  render(): void {
    const game = this.state.game;
    this.shell.style.display = game ? '' : 'none';
    if (!game) return;

    this.renderTop(game);
    this.renderRail(game);
    this.renderTabs();
    this.renderPanel(game);
    this.renderCommand(game);
    (document.getElementById('audio-btn') as HTMLElement | null)?.classList.toggle('is-on', this.state.audio);
  }

  // ------------------------------------------------------------------ topbar
  private renderTop(g: Game): void {
    const wars = FACTION_IDS.filter((f) => f !== g.player && stateOf(g, g.player, f) === 'war');
    const systems = g.systems.filter((s) => s.owner === g.player).length;
    const pct = Math.min(100, Math.round((systems / WIN_SYSTEMS) * 100));
    this.topEl.innerHTML = `
      <div class="cycle-block"><span>Zyklus</span><b>${String(g.cycle).padStart(2, '0')}</b></div>
      <div class="date-block">${dateLabel(g.cycle)} · Sektorzeit</div>
      <div class="alerts">
        ${wars.length ? `<span class="alert-chip is-war">Krieg · ${wars.map((w) => FACTIONS_BY_ID[w].short).join(', ')}</span>` : `<span class="alert-chip">Frieden</span>`}
        <span class="alert-chip is-science">Hegemonie ${pct} %</span>
      </div>`;
  }

  // -------------------------------------------------------------------- rail
  private renderRail(g: Game): void {
    const emp = g.empires[g.player];
    const mods = empireMods(g, g.player);
    const inc = incomeOf(g, g.player);
    const faction = FACTIONS_BY_ID[g.player];
    const systems = g.systems.filter((s) => s.owner === g.player).length;
    const colonies = g.systems.reduce((s, sys) => s + sys.planets.filter((p) => p.owner === g.player).length, 0);
    const tradeTier = emp.techs.filter((id) => id.startsWith('econ')).length;
    const fleets = g.fleets.filter((f) => f.owner === g.player);
    const power = fleets.reduce((s, f) => s + fleetPower(g, f), 0);

    const resBar = (value: number, max: number, color: string) =>
      `<div class="res-bar" style="color:${color}"><i style="width:${Math.max(2, Math.min(100, (value / max) * 100))}%"></i></div>`;

    this.railEl.innerHTML = `
      <div class="crest-wrap">
        ${crestSvg(g.player)}
        <div>
          <div class="empire-name">${faction.name}</div>
          <div class="empire-doctrine">${faction.doctrine}</div>
        </div>
      </div>
      <div class="rail-section"><span>Reserven</span><span>${dateLabel(g.cycle)}</span></div>
      <div class="res-row">
        <span class="rl">Energie</span><span class="rv">${nf(emp.energy)}</span>
        <span class="rd ${inc.net >= 0 ? 'is-pos' : 'is-neg'}">${inc.net >= 0 ? '+' : ''}${nf(inc.net, 1)}</span>
        ${resBar(emp.energy, 400, '#f0a63f')}
      </div>
      <div class="res-row">
        <span class="rl">Legierungen</span><span class="rv">${nf(emp.alloy)}</span>
        <span class="rd is-pos">+${nf(inc.alloy, 1)}</span>
        ${resBar(emp.alloy, 800, '#d9d2c2')}
      </div>
      <div class="res-row">
        <span class="rl">Forschung</span><span class="rv">${nf(inc.research, 1)}</span>
        <span class="rd">${emp.techs.length}/${WIN_TECHS} Techs</span>
        ${resBar(inc.research, 40, '#62d2c4')}
      </div>
      <div class="res-row">
        <span class="rl">Einfluss</span><span class="rv">${nf(emp.influence)}</span>
        <span class="rd">+${nf(1.6 * mods.influence, 1)}</span>
        ${resBar(emp.influence, 120, '#a98bf0')}
      </div>
      <div class="rail-section"><span>Reich</span><span>${faction.short}</span></div>
      <div class="stat-grid">
        <div class="stat"><span>Sektoren</span><b>${systems}/${WIN_SYSTEMS}</b></div>
        <div class="stat"><span>Kolonien</span><b>${colonies}/${WIN_COLONIES}</b></div>
        <div class="stat"><span>Flotten</span><b>${fleets.length}</b></div>
        <div class="stat"><span>Kampfkraft</span><b>${nf(power)}</b></div>
      </div>
      <div class="rail-section"><span>Auftrag</span><span>Ziel</span></div>
      <div class="objective ${systems >= WIN_SYSTEMS ? 'is-done' : ''}"><i>${systems >= WIN_SYSTEMS ? '✓' : '1'}</i><span>${WIN_SYSTEMS} Sektoren kontrollieren — bisher ${systems}</span></div>
      <div class="objective ${colonies >= WIN_COLONIES && inc.energy >= WIN_ENERGY && tradeTier >= WIN_TRADE_TIER ? 'is-done' : ''}"><i>${colonies >= WIN_COLONIES && inc.energy >= WIN_ENERGY && tradeTier >= WIN_TRADE_TIER ? '✓' : '2'}</i><span>${WIN_COLONIES} Kolonien, ${WIN_ENERGY} Energie und Wirtschaftsstufe ${WIN_TRADE_TIER} — ${colonies}/${WIN_COLONIES}, ${nf(inc.energy)} Energie, Stufe ${tradeTier}</span></div>
      <div class="objective ${emp.techs.length >= WIN_TECHS ? 'is-done' : ''}"><i>${emp.techs.length >= WIN_TECHS ? '✓' : '3'}</i><span>${WIN_TECHS} Forschungen abschließen — ${emp.techs.length} erreicht</span></div>
      <div class="objective ${FACTION_IDS.filter((f) => f !== g.player && !g.empires[f].alive).length >= FACTION_IDS.length - 1 ? 'is-done' : ''}"><i>4</i><span>Alle Rivalen brechen — ${FACTION_IDS.filter((f) => f !== g.player && !g.empires[f].alive).length}/${FACTION_IDS.length - 1}</span></div>
      <div class="rail-foot">${faction.motto}</div>`;
  }

  // -------------------------------------------------------------------- tabs
  private renderTabs(): void {
    const tabs: { id: TabId; label: string }[] = [
      { id: 'sector', label: 'Sektor' },
      { id: 'fleets', label: 'Flotten' },
      { id: 'empire', label: 'Reich' },
      { id: 'research', label: 'Forschung' },
      { id: 'diplomacy', label: 'Diplomatie' },
    ];
    this.tabsEl.innerHTML = tabs
      .map((t) => `<button class="tab ${this.state.tab === t.id ? 'is-active' : ''}" data-act="tab" data-tab="${t.id}">${t.label}</button>`)
      .join('');
    this.scopeEl.classList.toggle('hidden', this.state.tab !== 'sector');
  }

  private renderCommand(g: Game): void {
    const logs = g.log.slice(0, 2);
    this.commandEl.innerHTML = `
      <div class="ticker">
        ${logs
          .map(
            (l) =>
              `<div class="log-line is-${l.kind}"><b>${String(l.cycle).padStart(2, '0')}</b>${l.text}</div>`,
          )
          .join('')}
      </div>
      <div class="hint">Leertaste: Zyklus · 1–5: Registerkarten · Mausrad: Zoom · Ziehen: Karte</div>
      <button class="end-cycle" data-act="end-cycle" ${this.state.busy ? 'disabled' : ''}>
        Zyklus beenden <kbd>␣</kbd>
      </button>`;
  }

  // ------------------------------------------------------------------- panel
  private renderPanel(g: Game): void {
    if (this.state.tab === 'sector') this.renderScope(g);
    // Central system view: the system scope grows onto the centre stage.
    this.shell.classList.toggle(
      'system-stage',
      this.state.systemStage && this.state.tab === 'sector' && this.state.system !== null,
    );
    this.bodyEl.innerHTML =
      this.state.tab === 'sector'
        ? this.sectorHtml(g)
        : this.state.tab === 'fleets'
          ? this.fleetsHtml(g)
          : this.state.tab === 'empire'
            ? this.empireHtml(g)
            : this.state.tab === 'research'
              ? this.researchHtml(g)
              : this.diplomacyHtml(g);
  }

  private renderScope(g: Game): void {
    const sys = this.state.system !== null ? g.systems[this.state.system] : null;
    if (!sys) {
      this.scopeHead.innerHTML = `<div><div class="scope-title">Sternenkarte</div><div class="scope-sub">Kein Sektor gewählt</div></div>`;
      return;
    }
    const owner = sys.owner ? FACTIONS_BY_ID[sys.owner] : null;
    this.scopeHead.innerHTML = `
      <div class="scope-head-main">
        <div class="scope-title" style="color:${owner ? owner.css : 'var(--ink)'}">${sys.name}</div>
        <div class="scope-sub">Sternklasse ${sys.starClass} · ${sys.planets.length} Welten</div>
      </div>
      <div class="scope-head-actions">
        <div class="scope-tag">${owner ? owner.short : 'FREI'}</div>
        <button class="btn btn-sm" data-act="stage-toggle" title="${this.state.systemStage ? 'Zurück zur Galaxie (Esc)' : 'Zentrale Ansicht — das System füllt die Bühne'}">${this.state.systemStage ? '← Galaxie' : '⛶ Zentral'}</button>
        <button class="icon-btn scope-close" data-act="clear-selection" title="Auswahl schließen" aria-label="Systemauswahl schließen">×</button>
      </div>`;
  }

  private sectorHtml(g: Game): string {
    if (this.state.system === null) {
      const owned = g.systems.filter((s) => s.owner === g.player);
      return `
        <div class="panel-head">
          <div class="eyebrow">Sternenkarte</div>
          <h2>Kein Sektor gewählt</h2>
          <p class="sub">Klicke einen Stern, um Planeten, Flotten und Kolonien zu prüfen. Unbekannte Sektoren bleiben leer, bis eine Sonde sie erreicht.</p>
        </div>
        <div class="rule"></div>
        <h3 class="block-title">Deine Sektoren <span>${owned.length}</span></h3>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${owned
            .map(
              (s) => `<button class="planet-row" data-act="system" data-id="${s.id}">
                <span class="planet-orb" style="background:radial-gradient(circle at 34% 30%, ${FACTIONS_BY_ID[g.player].css}, ${FACTIONS_BY_ID[g.player].css}55 70%)"></span>
                <span><span class="planet-name">${s.name}</span><span class="planet-meta">${s.planets.filter((p) => p.owner === g.player).length} Kolonien · ${s.planets.length} Welten</span></span>
                <span class="planet-tag">${s.starClass}</span>
              </button>`,
            )
            .join('') || '<p class="sub">Noch kein Sektor unter Kontrolle.</p>'}
        </div>`;
    }

    const sys = g.systems[this.state.system];
    const explored = sys.explored[g.player];
    const owner = sys.owner ? FACTIONS_BY_ID[sys.owner] : null;
    const fleetsHere = g.fleets.filter((f) => f.system === sys.id);
    const selectedPlanet = this.state.planet !== null ? sys.planets.find((p) => p.id === this.state.planet) ?? null : null;

    const targetBanner =
      this.state.targetFleet !== null
        ? `<div class="target-banner"><span>Kursziel wählen — klicke einen Sektor auf der Karte.</span><button class="btn btn-sm btn-ghost" data-act="cancel-target">Abbrechen</button></div>`
        : '';

    return `
      ${targetBanner}
      <div class="panel-head">
        <div class="eyebrow">Sektor ${String(sys.id + 1).padStart(2, '0')} · Sternklasse ${sys.starClass}</div>
        <h2>${sys.name}</h2>
        <div class="chip-row">
          <span class="chip ${owner ? 'own-' + owner.id : ''}"><i></i>${systemOwnerLabel(sys)}</span>
          <span class="chip">${sys.planets.length} Welten</span>
          ${explored ? '' : '<span class="chip">ungescannt</span>'}
          ${sys.site === 'ruin' ? '<span class="chip">Ruinen</span>' : ''}
          ${sys.site === 'beacon' ? '<span class="chip">Leuchtfeuer</span>' : ''}
        </div>
      </div>
      ${
        explored
          ? `
      <div class="rule"></div>
      <h3 class="block-title">Welten <span>${sys.planets.length}</span></h3>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${sys.planets.map((p) => this.planetRow(p)).join('')}
      </div>
      ${selectedPlanet ? this.planetDetail(g, selectedPlanet) : ''}
      <div class="rule"></div>
      <h3 class="block-title">Verbände im System <span>${fleetsHere.length}</span></h3>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${fleetsHere.map((f) => this.fleetRow(g, f)).join('') || '<p class="sub">Keine Schiffe anwesend.</p>'}
      </div>`
          : `<p class="sub">Dieser Sektor ist ungescannt. Entsende eine Sonde, um Welten und Routen aufzudecken.</p>`
      }`;
  }

  private planetRow(p: Planet): string {
    const def = PLANET_TYPES[p.type];
    const owner = p.owner ? FACTIONS_BY_ID[p.owner] : null;
    const tag = owner
      ? `${nf(p.pop, 1)} Bev.`
      : `${Math.round(p.habitability * 100)} % habitabel`;
    return `<button class="planet-row ${this.state.planet === p.id ? 'is-active' : ''}" data-act="planet" data-id="${p.id}">
      <span class="planet-orb" style="background:radial-gradient(circle at 34% 28%, ${def.palette.land}, ${def.palette.deep} 72%)"></span>
      <span>
        <span class="planet-name">${p.name}</span>
        <span class="planet-meta">${def.short}${owner ? ' · ' + owner.short : ''}${p.buildings.bastion ? ' · Bastion' : ''}</span>
      </span>
      <span class="planet-tag"><b>${tag.split(' ')[0]}</b>${tag.split(' ').slice(1).join(' ')}</span>
    </button>`;
  }

  private planetDetail(g: Game, p: Planet): string {
    const def = PLANET_TYPES[p.type];
    const isMine = p.owner === g.player;
    const mods = empireMods(g, g.player);
    const out = colonyOutput(p, mods);
    const outRows = isMine
      ? `<div class="yield-row">
          <div class="yield"><span>Energie</span><b>+${nf(out.energy, 1)}</b></div>
          <div class="yield"><span>Legierung</span><b>+${nf(out.alloy, 1)}</b></div>
          <div class="yield"><span>Forschung</span><b>+${nf(out.research, 1)}</b></div>
        </div>`
      : `<div class="yield-row">
          <div class="yield"><span>Energie</span><b>${nf(p.yields.energy, 1)}</b></div>
          <div class="yield"><span>Legierung</span><b>${nf(p.yields.alloy, 1)}</b></div>
          <div class="yield"><span>Forschung</span><b>${nf(p.yields.research, 1)}</b></div>
        </div>`;

    const header = `
      <div class="rule"></div>
      <h3 class="block-title">${p.name} <span>${def.short}</span></h3>
      <p class="sub" style="font-family:var(--serif);font-style:italic;font-size:11.5px;color:var(--muted);margin:0">${def.blurb}</p>
      ${outRows}`;

    if (!isMine) {
      const colonizers = g.fleets.filter((f) => f.owner === g.player && f.system === p.systemId && f.ships.ark > 0);
      const enemyFleets = g.fleets.filter((f) => f.system === p.systemId && f.owner === p.owner);
      const canColonize = !p.owner && def.colonizable && colonizers.length > 0;
      const siegePct = p.owner ? Math.min(100, Math.round((p.siege / Math.max(1, colonyDefense(p))) * 100)) : 0;

      return `${header}
        ${
          p.owner
            ? `<div class="kv">
                 <dt>Verteidigung</dt><dd>${colonyDefense(p)}</dd>
                 <dt>Bevölkerung</dt><dd>${nf(p.pop, 1)}</dd>
                 <dt>Bastionen</dt><dd>${p.buildings.bastion}</dd>
               </div>
               <p class="sub">${siegePct > 0 ? `Invasion läuft — ${siegePct} % der Verteidigung gebrochen.` : enemyFleets.length ? 'Feindliche Flotte schützt den Orbit.' : 'Keine Verteidigungsflotte im Orbit. Eine Invasion beginnt, sobald deine Flotte ankommt.'}</p>`
            : `<div class="kv">
                 <dt>Habitabilität</dt><dd>${Math.round(p.habitability * 100)} %</dd>
                 <dt>Kolonisierbar</dt><dd>${def.colonizable ? 'ja' : 'nein'}</dd>
               </div>
               ${
                 canColonize
                   ? `<div class="btn-row"><button class="btn btn-primary" data-act="colonize" data-id="${p.id}">Arche landen — 30 Einfluss</button></div>`
                   : `<p class="sub">${def.colonizable ? 'Für die Besiedlung wird eine Arche im System benötigt.' : 'Diese Welt trägt keine Kolonie.'}</p>`
               }`
        }`;
    }

    const cap = colonyCap(p);
    const queue = p.queue;
    const queueProgress = queue
      ? (() => {
          const time = queue.kind === 'building' ? BUILDINGS[queue.id].buildTime : SHIP_CLASSES[queue.id].buildTime;
          const label = queue.kind === 'building' ? BUILDINGS[queue.id].name : SHIP_CLASSES[queue.id].name;
          return `<div class="kv"><dt>Im Bau</dt><dd>${label}</dd></div>
            <div class="tb-bar" style="--bc:var(--amber);height:4px"><i style="width:${(p.progress / time) * 100}%;background:var(--amber)"></i></div>
            <p class="sub">${time - p.progress} Zyklen verbleibend.</p>`;
        })()
      : `<p class="sub">Bauleiste frei.</p>`;

    const skin = loadIdentity();
    const archSkin = skin.style;
    const buildings = BUILDING_ORDER.map((b) => {
      const d = BUILDINGS[b];
      const locked = !buildingUnlocked(b, (br) => techTier(g, g.player, br));
      const afford = g.empires[g.player].alloy >= d.alloy;
      const disabled = locked || !afford || !!queue;
      return `<button class="build-btn" data-act="building" data-id="${p.id}" data-b="${b}" ${disabled ? 'disabled' : ''} title="${d.desc}">
        <span class="glyph">${styleGlyph(archSkin, b)}</span>
        <span>${d.name}<br><span class="cost">${locked ? d.unlock : d.effect}</span></span>
        <span class="cnt">${p.buildings[b] || ''}</span>
      </button>`;
    }).join('');

    const ships = SHIP_ORDER.map((s) => {
      const d = SHIP_CLASSES[s];
      const locked = !shipUnlocked(s, (br) => techTier(g, g.player, br));
      const cost = Math.round(d.alloy * FACTIONS_BY_ID[g.player].mods.shipCost);
      const disabled = locked || g.empires[g.player].alloy < cost || !!queue || p.buildings.shipyard <= 0;
      return `<div class="ship-row">
        <div>
          <div class="ship-name">${d.name}</div>
          <div class="ship-sub">${locked ? d.unlock : `${d.role} · ${d.buildTime} Zyklen · ${d.attack} Angriff / ${d.hull} Hülle`}</div>
        </div>
        <button class="btn btn-sm" data-act="ship" data-id="${p.id}" data-s="${s}" ${disabled ? 'disabled' : ''}>
          ${locked ? 'gesperrt' : `${cost} ⛭`}
        </button>
      </div>`;
    }).join('');

    return `${header}
      <div class="kv">
        <dt>Bevölkerung</dt><dd>${nf(p.pop, 1)} / ${cap}</dd>
        <dt>Verteidigung</dt><dd>${colonyDefense(p)}</dd>
        <dt>Werft</dt><dd>${p.buildings.shipyard ? 'aktiv' : 'fehlt'}</dd>
      </div>
      ${queueProgress}
      <div class="rule"></div>
      <h3 class="block-title">Bauwesen <span>${archStyle(loadIdentity().style).name} · ${nf(g.empires[g.player].alloy)} ⛭</span></h3>
      <div class="building-grid" data-style="${skin.style}" style="--ie-accent:${skin.accent};--ie-secondary:${skin.secondary}">${buildings}</div>
      <h3 class="block-title">Werft <span>${p.buildings.shipyard ? 'bereit' : 'nicht vorhanden'}</span></h3>
      <div style="display:flex;flex-direction:column;gap:6px">${ships}</div>`;
  }

  private fleetRow(g: Game, f: Fleet): string {
    const faction = FACTIONS_BY_ID[f.owner];
    const isMine = f.owner === g.player;
    const power = Math.round(fleetPower(g, f));
    const integ = Math.round(integrity(g, f) * 100);
    const route = f.path.length
      ? ` → ${g.systems[f.path[f.path.length - 1]].name} (${f.path.length - f.step} Sektoren)`
      : '';
    return `<div class="ship-row" style="border-left:2px solid ${faction.css}">
      <div>
        <div class="ship-name" style="color:${isMine ? 'var(--ink)' : faction.css}">${f.name}</div>
        <div class="ship-sub">${shipSummary(f)}${route}</div>
        <div class="ship-sub">Kampfkraft ${nf(power)} · Hülle ${integ} %</div>
      </div>
      ${
        isMine
          ? `<div class="btn-row">
              <button class="btn btn-sm" data-act="fleet" data-id="${f.id}">Steuerung</button>
              <button class="btn btn-sm btn-ghost" data-act="target" data-id="${f.id}">Ziel</button>
            </div>`
          : `<span class="chip own-${faction.id}"><i></i>${faction.short}</span>`
      }
    </div>`;
  }

  // ------------------------------------------------------------------ fleets
  private fleetsHtml(g: Game): string {
    const mine = g.fleets.filter((f) => f.owner === g.player);
    const selected = mine.find((f) => f.id === this.state.fleet) ?? null;
    const list = mine.length
      ? mine.map((f) => this.fleetRow(g, f)).join('')
      : '<p class="sub">Keine eigene Flotte. Baue Schiffe an einer Werft.</p>';
    if (!selected) {
      return `<div class="panel-head">
        <div class="eyebrow">Flottensteuerung</div>
        <h2>${mine.length} eigene Flotten</h2>
        <p class="sub">Wähle eine Flotte für Schiffe, Status und Befehle. „Ziel“ setzt den Kurs: danach einen Sektor in der Galaxie anklicken.</p>
      </div>
      <div class="rule"></div>
      ${list}`;
    }
    const f = selected;
    const here = g.systems[f.system];
    const route = f.path.length
      ? f.path.slice(f.step).map((id) => g.systems[id].name).join(' → ')
      : '—';
    const shipRows = SHIP_ORDER.filter((c) => f.ships[c] > 0)
      .map((c) => {
        const max = SHIP_CLASSES[c].hull * empireMods(g, f.owner).hull;
        const cur = max > 0 ? Math.round((f.hp[c] / max) * 100) : 0;
        return `<div class="ship-row">
          <div>
            <div class="ship-name">${f.ships[c]}× ${SHIP_CLASSES[c].name}</div>
            <div class="ship-sub">${SHIP_CLASSES[c].role} · Hülle ${cur} %</div>
          </div>
        </div>`;
      })
      .join('');
    return `<div class="panel-head">
      <div class="eyebrow">Flotte · ${FACTIONS_BY_ID[f.owner].short}</div>
      <h2>${f.name}</h2>
      <p class="sub">Aktuell: ${here.name} · Route: ${route}</p>
    </div>
    <div class="rule"></div>
    <div class="kv">
      <dt>Kampfkraft</dt><dd>${nf(fleetPower(g, f))}</dd>
      <dt>Hülle</dt><dd>${nf(hullOf(f))} HP</dd>
      <dt>Reparatur</dt><dd>${Math.round(integrity(g, f) * 100)} %</dd>
      <dt>Archen</dt><dd>${f.ships.ark}</dd>
    </div>
    <div class="btn-row">
      <button class="btn btn-sm" data-act="target" data-id="${f.id}">Kurs setzen</button>
      <button class="btn btn-sm btn-ghost" data-act="halt-fleet" data-id="${f.id}" ${f.path.length ? '' : 'disabled'}>Halten</button>
      <button class="btn btn-sm btn-ghost" data-act="fleet-system" data-id="${f.system}">System anzeigen</button>
    </div>
    <div class="rule"></div>
    <h3 class="block-title">Schiffe <span>${f.ships.ark} Arche(n)</span></h3>
    <div style="display:flex;flex-direction:column;gap:6px">${shipRows || '<p class="sub">Keine Schiffe.</p>'}</div>
    <div class="rule"></div>
    <h3 class="block-title">Alle Flotten <span>${mine.length}</span></h3>
    ${list}`;
  }

  // ------------------------------------------------------------------ empire
  private empireHtml(g: Game): string {
    const mods = empireMods(g, g.player);
    const inc = incomeOf(g, g.player);
    const profile = g.empires[g.player].profile;
    const hull = profile ? START_HULLS.find((h) => h.id === profile.shipClass) : null;
    const traitNames = profile
      ? profile.traits.map((id) => RACE_TRAITS.find((t) => t.id === id)?.name).filter(Boolean)
      : [];
    const colonies = g.systems.flatMap((s) => s.planets.filter((p) => p.owner === g.player).map((p) => ({ p, s })));
    const fleets = g.fleets.filter((f) => f.owner === g.player);

    return `
      <div class="panel-head">
        <div class="eyebrow">Reichsübersicht</div>
        <h2>${FACTIONS_BY_ID[g.player].name}</h2>
        <p class="sub">${FACTIONS_BY_ID[g.player].lore}</p>
        <p class="ie-motto">${FACTIONS_BY_ID[g.player].motto}</p>
        <div class="btn-row" style="margin-top:8px"><button class="btn btn-sm" data-act="identity">Identität bearbeiten</button></div>
      </div>
      <div class="rule"></div>
      <h3 class="block-title">Haushalt <span>pro Zyklus</span></h3>
      <div class="kv">
        <dt>Energie</dt><dd>${nf(inc.energy, 1)}</dd>
        <dt>Flottenunterhalt</dt><dd>−${nf(inc.upkeep, 1)}</dd>
        <dt>Netto</dt><dd style="color:${inc.net >= 0 ? '#a8d9b0' : '#e08a8a'}">${inc.net >= 0 ? '+' : ''}${nf(inc.net, 1)}</dd>
        <dt>Legierungen</dt><dd>+${nf(inc.alloy, 1)}</dd>
        <dt>Forschung</dt><dd>+${nf(inc.research, 1)}</dd>
      </div>
      <h3 class="block-title">Doktrinwerte <span>${FACTIONS_BY_ID[g.player].doctrine}</span></h3>
      <div class="kv">
        <dt>Angriff</dt><dd>${Math.round(mods.attack * 100)} %</dd>
        <dt>Hülle</dt><dd>${Math.round(mods.hull * 100)} %</dd>
        <dt>Einkommen</dt><dd>${Math.round(mods.income * 100)} %</dd>
        <dt>Forschung</dt><dd>${Math.round(mods.research * 100)} %</dd>
        <dt>Antrieb</dt><dd>${Math.round(mods.speed * 100)} %</dd>
        <dt>Hauslehre</dt><dd>${techLabel(loadIdentity().tech)}</dd>
      </div>
      <h3 class="block-title">Reichsprofil <span>${profile ? 'bei der Gründung gewählt' : 'Standard'}</span></h3>
      ${
        profile
          ? `<div class="kv">
        <dt>Schiffstyp</dt><dd>${hull ? `${hull.name} · ${hull.role}` : profile.shipClass}</dd>
        <dt>Regierung</dt><dd>${optionById(GOVERNMENTS, profile.government)?.name ?? profile.government}</dd>
        <dt>Weltanschauung</dt><dd>${optionById(WORLDVIEWS, profile.worldview)?.name ?? profile.worldview}</dd>
        <dt>Religion</dt><dd>${optionById(RELIGIONS, profile.religion)?.name ?? profile.religion}</dd>
        <dt>Fähigkeiten</dt><dd>${traitNames.length ? traitNames.join(' · ') : 'keine'}</dd>
      </div>`
          : '<p class="sub">Kein Gründungsprofil gespeichert.</p>'
      }
      <div class="rule"></div>
      <h3 class="block-title">Kolonien <span>${colonies.length}</span></h3>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${colonies
          .map(
            ({ p, s }) => `<button class="planet-row" data-act="planet-link" data-id="${p.id}" data-sys="${s.id}">
              <span class="planet-orb" style="background:radial-gradient(circle at 34% 28%, ${PLANET_TYPES[p.type].palette.land}, ${PLANET_TYPES[p.type].palette.deep} 72%)"></span>
              <span><span class="planet-name">${p.name}</span><span class="planet-meta">${s.name} · ${nf(p.pop, 1)} Bev.</span></span>
              <span class="planet-tag">${p.queue ? 'baut' : 'frei'}</span>
            </button>`,
          )
          .join('') || '<p class="sub">Keine Kolonien.</p>'}
      </div>
      <h3 class="block-title">Flotten <span>${fleets.length}</span></h3>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${fleets.map((f) => this.fleetRow(g, f)).join('') || '<p class="sub">Keine Flotten.</p>'}
      </div>`;
  }

  // ---------------------------------------------------------------- research
  private researchHtml(g: Game): string {
    const emp = g.empires[g.player];
    const ident = loadIdentity();
    return `
      <div class="panel-head">
        <div class="eyebrow">Forschung</div>
        <h2>${BRANCH_ORDER.length} Pfade</h2>
        <p class="sub">Baustil: <b style="color:var(--ink)">${archStyle(ident.style).sigil} ${archStyle(ident.style).name}</b> · Hauslehre: <b style="color:var(--ink)">${techLabel(ident.tech)}</b> · Jeder der ${BRANCH_ORDER.length} Pfade forscht parallel.</p>
      </div>
      <div class="rule"></div>
      ${BRANCH_ORDER.map((b) => {
        const meta = BRANCHES[b];
        const tier = techTier(g, g.player, b);
        const activeId = emp.active[b];
        const active = activeId ? TECH_BY_ID[activeId] : null;
        const pct = active ? Math.min(100, (emp.progress[b] / active.cost) * 100) : 0;
        const next = TECHS_BY_BRANCH[b].find((t) => !emp.techs.includes(t.id));
        return `<div class="tech-branch ${ident.tech === b ? 'is-doctrine' : ''}" style="--bc:${meta.css}">
          <div class="tb-head"><span class="tb-name">${meta.name}</span><span class="tb-tier">Stufe ${tier} / ${TECHS_BY_BRANCH[b].length}</span></div>
          <div class="tb-pips">${TECHS_BY_BRANCH[b].map((t) => `<span class="${emp.techs.includes(t.id) ? 'on' : ''}"></span>`).join('')}</div>
          <div class="tb-bar"><i style="width:${pct}%"></i></div>
          <div class="tb-now">${active ? `${active.name} — ${Math.round(emp.progress[b])} / ${active.cost}` : 'kein Projekt aktiv'}</div>
          ${
            next && next.id !== activeId
              ? `<div class="btn-row">
                   <button class="btn btn-sm" data-act="research" data-branch="${b}" data-tech="${next.id}">${next.name} wählen · ${next.cost}</button>
                 </div>
                 <p class="sub" style="margin:0">${next.desc}</p>`
              : active
                ? `<p class="sub" style="margin:0">${active.desc}</p>`
                : '<p class="sub" style="margin:0">Alle Stufen dieses Pfades abgeschlossen.</p>'
          }
        </div>`;
      }).join('')}`;
  }

  // --------------------------------------------------------------- diplomacy
  private diplomacyHtml(g: Game): string {
    const others = FACTION_IDS.filter((f) => f !== g.player);
    return `
      <div class="panel-head">
        <div class="eyebrow">Diplomatie</div>
        <h2>Die Mächte</h2>
        <p class="sub">Beziehungen wachsen langsam und brechen schnell. Ein Geschenk kostet 40 Energie; ein Pakt verlangt 22 Beziehung und 20 Einfluss.</p>
      </div>
      <div class="rule"></div>
      ${others
        .map((id) => {
          const f = FACTIONS_BY_ID[id];
          const rel = relOf(g, g.player, id);
          const st = stateOf(g, g.player, id);
          const alive = g.empires[id].alive;
          const systems = g.systems.filter((s) => s.owner === id).length;
          const barLeft = rel >= 0;
          const width = Math.abs(rel) / 2;
          return `<div class="diplo-card" style="opacity:${alive ? 1 : 0.45}">
            <div class="diplo-top">
              ${crestSvg(id, 'fc-crest')}
              <div style="flex:1">
                <div class="diplo-name" style="color:${f.css}">${f.name}</div>
                <div class="panel-head"><span class="sub">${f.doctrine} · ${systems} Sektoren</span></div>
              </div>
              <span class="chip ${st === 'war' ? 'own-korrath' : ''}">${st === 'war' ? 'Krieg' : st === 'alliance' ? 'Bündnis' : st === 'pact' ? 'Pakt' : 'Frieden'}</span>
            </div>
            <div class="rel-track" style="--rc:${barLeft ? '#8fce9c' : '#e0566b'}">
              <i style="${barLeft ? `left:50%;width:${width}%` : `right:50%;width:${width}%`}"></i>
            </div>
            <div class="kv"><dt>Beziehung</dt><dd>${Math.round(rel)}</dd><dt>Status</dt><dd>${alive ? 'aktiv' : 'ausgelöscht'}</dd></div>
            <div class="btn-row">
              <button class="btn btn-sm" data-act="diplo" data-faction="${id}" data-diplo="gift" ${alive ? '' : 'disabled'}>Geschenk 40 E</button>
              ${st === 'war'
                ? `<button class="btn btn-sm" data-act="diplo" data-faction="${id}" data-diplo="peace" ${alive ? '' : 'disabled'}>Frieden 15 I</button>`
                : `<button class="btn btn-sm" data-act="diplo" data-faction="${id}" data-diplo="pact" ${alive ? '' : 'disabled'}>Pakt 20 I</button>
                   <button class="btn btn-sm" data-act="diplo" data-faction="${id}" data-diplo="alliance" ${alive ? '' : 'disabled'}>Bündnis 40 I</button>
                   <button class="btn btn-sm btn-danger" data-act="diplo" data-faction="${id}" data-diplo="war" ${alive ? '' : 'disabled'}>Krieg</button>`}
            </div>
          </div>`;
        })
        .join('')}`;
  }

  // ------------------------------------------------------------------ toasts
  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast is-${kind}`;
    el.textContent = text;
    this.toastHost.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .4s ease';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 420);
    }, 3200);
  }

  sweep(label: string): void {
    this.veil.classList.remove('is-running');
    this.stamp.classList.remove('is-running');
    void this.veil.offsetWidth;
    this.veil.classList.add('is-running');
    this.stamp.textContent = label;
    this.stamp.classList.add('is-running');
  }

  // ------------------------------------------------------------------ events
  private handleInput = (ev: Event): void => {
    const input = ev.target as HTMLInputElement;
    if (input?.dataset.audio !== 'music' && input?.dataset.audio !== 'sfx') return;
    this.actions.setAudioVolume?.(input.dataset.audio, Number(input.value) / 100);
  };

  private handleClick = (ev: Event): void => {
    const target = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!target) return;
    const act = target.dataset.act ?? '';
    const id = target.dataset.id ? Number(target.dataset.id) : null;
    switch (act) {
      case 'tab':
        this.actions.setTab(target.dataset.tab as TabId);
        break;
      case 'system':
        if (id !== null) this.actions.selectSystem(id);
        break;
      case 'planet':
        if (id !== null) this.actions.selectPlanet(id);
        break;
      case 'planet-link':
        if (id !== null) {
          this.actions.selectSystem(Number(target.dataset.sys));
          this.actions.selectPlanet(id);
          this.actions.setTab('sector');
        }
        break;
      case 'fleet':
        if (id !== null) this.actions.selectFleet(id);
        break;
      case 'target':
        if (id !== null) this.actions.beginTarget(id);
        break;
      case 'cancel-target':
        this.actions.cancelTarget();
        break;
      case 'halt-fleet':
        if (id !== null) this.actions.haltFleet?.(id);
        break;
      case 'stage-toggle':
        this.actions.toggleSystemStage?.();
        break;
      case 'fleet-system':
        if (id !== null) {
          this.actions.selectSystem(id);
          this.actions.setTab('sector');
        }
        break;
      case 'colonize':
        if (id !== null) this.actions.colonize(id);
        break;
      case 'building':
        if (id !== null && target.dataset.b) this.actions.build(id, target.dataset.b as BuildingId);
        break;
      case 'ship':
        if (id !== null && target.dataset.s) this.actions.buildShip(id, target.dataset.s as ShipId);
        break;
      case 'research':
        if (target.dataset.branch && target.dataset.tech)
          this.actions.research(target.dataset.branch as Branch, target.dataset.tech);
        break;
      case 'diplo':
        if (target.dataset.faction)
          this.actions.diplo(
            target.dataset.faction as FactionId,
            target.dataset.diplo as 'gift' | 'pact' | 'alliance' | 'war' | 'peace',
          );
        break;
      case 'end-cycle':
        this.actions.endCycle();
        break;
      case 'audio':
        this.actions.toggleAudio();
        break;
      case 'identity':
        this.showIdentityEditor();
        break;
      case 'clear-selection':
        this.actions.clearSelection?.();
        break;
      case 'arsenal':
        this.openExternal?.('arsenal');
        break;
      case 'help':
        this.openExternal?.('help');
        break;
      case 'pause':
        this.actions.openPause?.();
        break;
      case 'close-overlay':
        this.overlayRoot.innerHTML = '';
        break;
      case 'saveload':
        this.showSaveLoad();
        break;
      case 'save-slot': {
        const s = Number(target.dataset.slot ?? 0);
        this.actions.saveGame?.(s);
        this.showSaveLoad();
        break;
      }
      case 'load-slot': {
        const s = Number(target.dataset.slot ?? 0);
        this.overlayRoot.innerHTML = '';
        this.actions.loadGame?.(s);
        break;
      }
      case 'del-slot': {
        const s = Number(target.dataset.slot ?? 0);
        this.actions.deleteSave?.(s);
        this.showSaveLoad();
        break;
      }
      case 'export-save':
        this.actions.exportSave?.();
        break;
      case 'continue':
        this.overlayRoot.innerHTML = '';
        this.actions.continueGame?.();
        break;
      case 'faction':
        if (target.dataset.faction) {
          this.titleFaction = target.dataset.faction as FactionId;
          this.overlayRoot
            .querySelectorAll('.faction-card')
            .forEach((el) => el.classList.toggle('is-active', (el as HTMLElement).dataset.faction === this.titleFaction));
          const btn = this.overlayRoot.querySelector('[data-act="start"]') as HTMLElement | null;
          if (btn) btn.style.setProperty('--fc', FACTIONS_BY_ID[this.titleFaction].css);
          const holder = this.overlayRoot.querySelector('[data-ie-faction]') as HTMLElement | null;
          if (holder) {
            holder.dataset.ieFaction = this.titleFaction;
            refreshIdentityEditor(this.overlayRoot);
          }
        }
        break;
      case 'restart':
        this.restartHandler?.();
        break;
      case 'lan-host':
        this.actions.lanHost?.();
        break;
      case 'lan-join':
        this.actions.lanJoin?.();
        break;
      case 'start': {
        const input = this.overlayRoot.querySelector('#seed-input') as HTMLInputElement | null;
        const seed = input && input.value.trim() ? Number(input.value.trim()) >>> 0 : Math.floor(Math.random() * 1e9);
        const armyId = (this.overlayRoot.querySelector<HTMLSelectElement>('[data-army]')?.value ?? '') || undefined;
        this.overlayRoot.innerHTML = '';
        this.actions.startGame(this.titleFaction, seed, armyId);
        break;
      }
      case 'title-back':
        this.enterMenu();
        this.actions.backToMenu?.();
        break;
      case 'menu':
        this.enterMenu();
        this.actions.backToMenu?.();
        break;
      case 'open-designer':
        this.actions.openShipDesigner?.();
        break;
      case 'open-army':
        this.actions.openArmyEditor?.();
        break;
      default:
        break;
    }
  };

  openExternal: ((name: 'arsenal' | 'help') => void) | null = null;
  private restartHandler: (() => void) | null = null;

  // ------------------------------------------------------------------ screens
  enterMenu(): void {
    this.overlayRoot.innerHTML = '';
    this.shell.style.display = 'none';
  }

  showTitle(): void {
    this.shell.style.display = 'none';
    this.overlayRoot.innerHTML = `
      <div class="overlay overlay-title">
        <div class="title-screen">
          <div class="title-hero">
            <div class="eyebrow">Ein 4X-Remake · Zyklus 2187</div>
            <h1>Pax<em>Aeterna</em></h1>
            <p class="lede">Sechzehn Mächte, vierundsechzig Sektoren und ein Frieden, der nie unterzeichnet wurde. Kolonisiere, forsche, baue Flotten — und entscheide, ob „Pax“ ein Vertrag ist oder ein Zustand, den man erzwingt.</p>
            <div class="title-meta">
              <div><b>64</b><span>Sektoren</span></div>
              <div><b>16</b><span>Mächte</span></div>
              <div><b>96</b><span>Technologien</span></div>
              <div><b>13</b><span>Schiffsrümpfe</span></div>
              <div><b>18</b><span>Welttypen</span></div>
            </div>
          </div>
          <div>
            <div class="eyebrow" style="margin-bottom:10px">Wähle deine Macht</div>
            <div class="faction-picker">
              ${FACTIONS.map(
                (f) => `<button class="faction-card ${f.id === this.titleFaction ? 'is-active' : ''}" style="--fc:${f.css}" data-act="faction" data-faction="${f.id}">
                  <div class="fc-head">${crestSvg(f.id, 'fc-crest')}<div><h3 style="color:${f.css}">${f.name}</h3><div class="doctrine">${f.doctrine}</div></div></div>
                  <ul>${f.traits.map((t) => `<li>${t.label}: ${t.value}</li>`).join('')}</ul>
                </button>`,
              ).join('')}
            </div>
            ${(() => { const auto = listSaves()[0]; return auto ? `<div class="title-actions"><button class="btn btn-primary" data-act="continue">▶ Weiterspielen (Autospeicher)</button><span class="save-info">${saveMetaLine(auto, FACTIONS_BY_ID[auto.player]?.name ?? auto.player)}</span></div>` : ''; })()}
            <div class="title-actions">
              <button class="btn btn-primary" data-act="start" style="--fc:${FACTIONS_BY_ID[this.titleFaction].css};padding:14px 22px">Kampagne beginnen</button>
              <label class="seed-field">Seed <input id="seed-input" type="text" inputmode="numeric" placeholder="auto" /></label>
            </div>
            <div class="title-actions" style="margin-top:8px">
              <button class="btn" data-act="lan-host">LAN-Partie hosten</button>
              <button class="btn" data-act="lan-join">LAN beitreten</button>
            </div>
            ${(() => {
              const templates = listArmyTemplates();
              if (!templates.length) return '';
              const opts = templates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
              return `<label class="seed-field" style="margin-top:8px">Startflotte <select data-army><option value="">Standard-Startflotte</option>${opts}</select></label>`;
            })()}
            <div class="title-actions" style="margin-top:8px">
              <button class="btn" data-act="title-back">‹ Hauptmenü</button>
              <button class="btn" data-act="open-designer">Schiff-Designer</button>
              <button class="btn" data-act="open-army">Armee-Editor</button>
            </div>
            ${identityEditorHtml(this.titleFaction)}
            <p class="hint" style="margin-top:10px">Ziehen dreht die Karte · Mausrad zoomt · Leertaste beendet den Zyklus</p>
          </div>
        </div>
      </div>`;
    bindIdentityEditor(this.overlayRoot, (identity) => {
      const btn = this.overlayRoot.querySelector('[data-act="start"]') as HTMLElement | null;
      btn?.style.setProperty('--fc', identity.primary);
    });
  }

  showSaveLoad(): void {
    const saves = listSaves();
    const row = (meta: ReturnType<typeof listSaves>[number], slot: number, label: string) => {
      if (!meta) {
        return `<div class="save-row"><span class="save-label">${label}</span><span class="save-empty">leer</span>${slot >= 0 ? `<button class="btn btn-sm" data-act="save-slot" data-slot="${slot}">Speichern</button>` : ''}</div>`;
      }
      const who = FACTIONS_BY_ID[meta.player]?.name ?? meta.player;
      return `<div class="save-row"><span class="save-label">${label}</span><span class="save-info">${saveMetaLine(meta, who)}</span><span class="save-actions"><button class="btn btn-sm btn-primary" data-act="load-slot" data-slot="${slot}">Laden</button>${slot >= 0 ? `<button class="btn btn-sm" data-act="save-slot" data-slot="${slot}">Überschreiben</button><button class="btn btn-sm btn-ghost" data-act="del-slot" data-slot="${slot}">Löschen</button>` : ''}</span></div>`;
    };
    this.overlayRoot.innerHTML = `
      <div class="overlay"><div class="modal">
        <div class="modal-head"><h2>Speichern / Laden</h2><button class="btn btn-sm btn-ghost" data-act="close-overlay">Schließen</button></div>
        <p class="hint">Autospeichern erfolgt nach jedem Zyklus (Solo &amp; Host). F5 = Schnell speichern, F9 = Schnell laden (Slot 1).</p>
        ${row(saves[0], -1, 'Autospeicher')}
        ${row(saves[1], 0, 'Slot 1')}${row(saves[2], 1, 'Slot 2')}${row(saves[3], 2, 'Slot 3')}
        <div class="save-row"><span class="save-label">Datei</span><span class="save-actions"><button class="btn btn-sm" data-act="export-save">Exportieren</button><label class="btn btn-sm">Importieren<input type="file" accept=".json,application/json" hidden data-import /></label></span></div>
      </div></div>`;
    const input = this.overlayRoot.querySelector('[data-import]') as HTMLInputElement | null;
    input?.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) this.actions.importSave?.(f);
    });
  }

  showIdentityEditor(): void {
    const g = this.state.game;
    if (!g) return;
    this.overlayRoot.innerHTML = `
      <div class="overlay" data-overlay="identity">
        <div class="modal identity-modal">
          <div class="modal-head">
            <h2>Reich bearbeiten</h2>
            <button class="btn btn-sm btn-ghost" data-act="close-overlay">Schließen</button>
          </div>
          <div class="identity-modal-body">${identityEditorHtml(g.player)}</div>
        </div>
      </div>`;
    bindIdentityEditor(this.overlayRoot, (identity) => {
      applyIdentityToFaction(g.player, identity);
      this.render();
      this.actions.identityChanged?.();
    });
  }

  showHelp(): void {
    const volume = this.actions.getAudioSettings?.() ?? { music: 0.62, sfx: 0.78 };
    this.overlayRoot.innerHTML = `
      <div class="overlay" data-help="true">
        <div class="modal">
          ${helpContentHtml(volume)}
        </div>
      </div>`;
    this.overlayRoot
      .querySelector('[data-help-close]')
      ?.addEventListener('click', () => { this.overlayRoot.innerHTML = ''; });
  }

  showVictory(g: Game, onRestart: () => void): void {
    const won = g.victory?.kind.includes('Ausgelöscht') || g.victory?.kind.includes('Erschöpfung') ? false : true;
    this.overlayRoot.innerHTML = `
      <div class="overlay">
        <div class="victory">
          <div class="eyebrow">${won ? 'Sieg' : 'Niederlage'} · Zyklus ${g.cycle}</div>
          <h1 style="color:${won ? 'var(--amber)' : 'var(--rose)'}">${won ? 'Pax Aeterna' : 'Finis'}</h1>
          <div class="rule"></div>
          <p>${g.victory?.kind ?? ''}</p>
          <p style="max-width:52ch">${won ? 'Die Sternenkarte trägt deinen Namen. Ob als Vertrag oder als Diktat, bleibt eine Frage für die Chronik.' : 'Die Chronik schließt diesen Band. Ein neuer Seed, eine neue Gelegenheit.'}</p>
          <button class="btn btn-primary" data-act="restart">Neue Kampagne</button>
        </div>
      </div>`;
    this.restartHandler = onRestart;
    this.shell.style.display = 'none';
  }

  hasOverlay(): boolean {
    return this.overlayRoot.childElementCount > 0;
  }

  /** Closes the identity modal or help screen on Escape without touching victory or LAN screens. */
  closeTransientOverlay(): boolean {
    if (!this.overlayRoot.querySelector('[data-overlay="identity"]') && !this.overlayRoot.querySelector('[data-help]')) return false;
    this.overlayRoot.innerHTML = '';
    return true;
  }

  clearOverlay(): void {
    this.overlayRoot.innerHTML = '';
  }
}
