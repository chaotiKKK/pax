import './ui/styles.css';
import { AudioEngine } from './audio';
import { FACTIONS_BY_ID, SHIP_CLASSES, SHIP_ORDER } from './data';
import { createGame } from './galaxy';
import { applyCommand } from './commands';
import { GalaxyView } from './render/galaxyView';
import { SystemScope } from './render/systemView';
import { BattleView } from './render/battleView';
import { ArsenalView } from './render/arsenalView';
import { endCycle } from './sim';
import { LanClient, type NetEvent } from './net';
import { Hud, type HudActions, type TabId } from './ui/hud';
import { Lobby, type LobbyPlayerView } from './ui/lobby';
import { applyIdentityToFaction, loadIdentity } from './ui/identity';
import type { Command, FactionId, Game, LobbyPlayer, ShipId } from './types';

const uiRoot = document.getElementById('ui') as HTMLElement;
const overlays = document.getElementById('overlays') as HTMLElement;
const galaxyCanvas = document.getElementById('galaxy') as HTMLCanvasElement;

const audio = new AudioEngine();
let hud: Hud;
let lobby: Lobby;
let galaxy: GalaxyView;
let scope: SystemScope;
let battle: BattleView;
let arsenal: ArsenalView | null = null;
let arsenalOverlay: HTMLDivElement | null = null;

let game: Game | null = null;
let busy = false;

const ui = {
  tab: 'sector' as TabId,
  system: null as number | null,
  planet: null as number | null,
  fleet: null as number | null,
  targetFleet: null as number | null,
};

type Mode = 'solo' | 'host' | 'client';
interface MpState {
  mode: Mode;
  lan: LanClient | null;
  myId: string;
  hostId: string;
  players: LobbyPlayer[];
  chat: { name: string; text: string }[];
  ready: Set<string>;
  code: string | null;
  choice: FactionId | null;
  connecting: boolean;
}

const mp: MpState = {
  mode: 'solo',
  lan: null,
  myId: '',
  hostId: '',
  players: [],
  chat: [],
  ready: new Set(),
  code: null,
  choice: null,
  connecting: false,
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// rendering sync
// ---------------------------------------------------------------------------
function sync(opts: { world?: boolean; scope?: boolean } = {}): void {
  hud.setState({
    game,
    tab: ui.tab,
    system: ui.system,
    planet: ui.planet,
    fleet: ui.fleet,
    targetFleet: ui.targetFleet,
    audio: audio.enabled,
    busy,
  });
  if (!game) return;
  if (opts.world) galaxy.refresh();
  galaxy.setSelection(ui.system);
  if (opts.scope !== false) {
    const sys = ui.system !== null ? game.systems[ui.system] : null;
    scope.setSystem(sys, sys ? sys.explored[game.player] : false);
    scope.setSelected(ui.planet);
    scope.resize();
  }
}

function bootWorld(g: Game): void {
  game = g;
  const capital = g.empires[g.player].capital;
  const planet = g.systems.flatMap((s) => s.planets).find((p) => p.id === capital);
  ui.system = planet ? planet.systemId : null;
  ui.planet = capital;
  ui.fleet = null;
  ui.targetFleet = null;
  ui.tab = 'sector';
  busy = false;
  galaxy.setGame(g);
  galaxy.resize();
  sync({ world: true, scope: true });
  requestAnimationFrame(() => {
    galaxy.resize();
    scope.resize();
  });
}

function selectSystem(id: number): void {
  ui.system = id;
  ui.planet = null;
  ui.fleet = null;
  ui.tab = 'sector';
  sync({ scope: true });
  audio.blip(560, 0.05, 'sine', 0.04);
}

function selectPlanet(id: number | null): void {
  ui.planet = id;
  sync({ scope: true });
  audio.blip(680, 0.05, 'sine', 0.04);
}

function selectFleet(id: number): void {
  if (!game) return;
  const fleet = game.fleets.find((f) => f.id === id);
  if (!fleet) return;
  ui.fleet = id;
  ui.system = fleet.system;
  ui.planet = null;
  ui.tab = 'sector';
  sync({ scope: true });
  audio.blip(420, 0.06, 'triangle', 0.05);
}

function chooseTab(tab: TabId): void {
  ui.tab = tab;
  sync({ scope: false });
  if (tab === 'sector') requestAnimationFrame(() => scope.resize());
  audio.blip(600, 0.04, 'sine', 0.03);
}

// ---------------------------------------------------------------------------
// commands (solo, host and client share one path)
// ---------------------------------------------------------------------------
function dispatch(cmd: Command): void {
  if (!game) return;
  if (busy) {
    hud.toast('Der Zyklus läuft noch.', 'bad');
    return;
  }
  if (mp.mode === 'client') {
    mp.lan?.send({ k: 'cmd', cmd });
    return;
  }
  const res = applyCommand(game, game.player, cmd);
  hud.toast(res.msg, res.ok ? 'good' : 'bad');
  if (res.ok) audio.confirm();
  else audio.deny();
  sync({ world: true, scope: cmd.kind === 'colonize' });
  if (res.ok && mp.mode === 'host') broadcastState();
}

async function handleEndCycle(): Promise<void> {
  if (!game || busy || battle.active) return;
  if (mp.mode === 'client') {
    mp.lan?.send({ k: 'ready', ready: true });
    hud.toast('Bereitschaft an den Host gemeldet.', 'info');
    return;
  }
  busy = true;
  audio.whoosh();
  hud.sweep(`Zyklus ${game.cycle} · ${game.systems.filter((s) => s.owner === game!.player).length} Sektoren`);
  sync();
  const g = game;
  const battles = endCycle(g);
  const mine = battles.filter((b) => b.attacker === g.player || b.defender === g.player);
  sync({ world: true, scope: true });
  await sleep(420);
  for (const record of mine) {
    audio.boom();
    await battle.play(record);
    sync({ world: true, scope: false });
    const won = record.winner === g.player;
    hud.toast(won ? `Sieg im Orbit von ${record.systemName}` : `Rückzug aus ${record.systemName}`, won ? 'good' : 'bad');
  }
  busy = false;
  sync({ world: true, scope: true });
  if (mp.mode === 'host') broadcastState();
  if (g.victory) {
    hud.showVictory(g, () => {
      game = null;
      hud.showTitle();
    });
  }
}

// ---------------------------------------------------------------------------
// LAN
// ---------------------------------------------------------------------------
function playerViews(): LobbyPlayerView[] {
  return mp.players.map((p) => ({
    id: p.id,
    name: p.name,
    faction: p.faction,
    ready: mp.ready.has(p.id),
    host: p.host,
    // The host is identified by its role flag: its relay id and its roster
    // entry can diverge while the room is being created.
    me: mp.mode === 'host' ? p.host : p.id === mp.myId,
  }));
}

function refreshLobby(status?: string): void {
  const me = mp.players.find((p) => p.id === mp.myId);
  lobby.update({
    phase: game ? 'waiting' : 'waiting',
    code: mp.code,
    isHost: mp.mode === 'host',
    status: status ?? '',
    players: playerViews(),
    chat: mp.chat,
    myFaction: me?.faction ?? mp.choice,
    canStart:
      mp.mode === 'host' &&
      mp.players.length >= 1 &&
      mp.players.every((p) => p.faction !== null) &&
      (mp.players.length === 1 || mp.ready.has(mp.myId) || true),
  });
}

function rosterPayload(): Record<string, unknown> {
  return {
    k: 'roster',
    code: mp.code,
    players: mp.players.map((p) => ({
      id: p.id,
      name: p.name,
      faction: p.faction,
      ready: mp.ready.has(p.id),
      host: p.host,
    })),
  };
}

function broadcastRoster(): void {
  mp.lan?.send(rosterPayload());
}

function broadcastState(): void {
  if (!game) return;
  mp.lan?.send({ k: 'state', game });
}

function freeFaction(desired: FactionId | null): FactionId {
  const used = new Set(mp.players.map((p) => p.faction).filter(Boolean) as string[]);
  if (desired && !used.has(desired)) return desired;
  const open = Object.keys(FACTIONS_BY_ID).find((id) => !used.has(id));
  return open ?? Object.keys(FACTIONS_BY_ID)[0];
}

function handleNet(ev: NetEvent): void {
  switch (ev.t) {
    case 'created': {
      mp.myId = ev.peerId;
      mp.code = ev.code;
      mp.mode = 'host';
      mp.players = [{ id: mp.myId, name: mp.players[0]?.name ?? 'Host', faction: mp.choice, ready: false, host: true }];
      lobby.update({ phase: 'waiting', code: mp.code, isHost: true, players: playerViews(), status: '' });
      break;
    }
    case 'joined': {
      mp.myId = ev.peerId;
      mp.hostId = ev.hostId;
      mp.mode = 'client';
      lobby.update({ phase: 'waiting', status: 'Verbunden — warte auf die Zuweisung des Hosts.' });
      mp.lan?.send({ k: 'hello', name: mp.players[0]?.name ?? 'Gast', faction: mp.choice }, mp.hostId);
      break;
    }
    case 'peer-joined': {
      if (mp.mode !== 'host') return;
      if (mp.players.some((p) => p.id === ev.peerId)) return;
      const faction = freeFaction(null);
      mp.players.push({ id: ev.peerId, name: ev.name, faction, ready: false, host: false });
      broadcastRoster();
      if (game) mp.lan?.send({ k: 'state', game }, ev.peerId);
      refreshLobby(`${ev.name} ist beigetreten.`);
      break;
    }
    case 'peer-left': {
      mp.players = mp.players.filter((p) => p.id !== ev.peerId);
      mp.ready.delete(ev.peerId);
      if (mp.mode === 'host') broadcastRoster();
      refreshLobby('Ein Spieler hat den Raum verlassen.');
      break;
    }
    case 'host-left': {
      hud.toast('Der Host hat die Partie beendet.', 'bad');
      leaveLan();
      break;
    }
    case 'error': {
      lobby.update({ status: ev.msg });
      mp.connecting = false;
      break;
    }
    case 'closed': {
      if (mp.mode !== 'solo') hud.toast('LAN-Verbindung getrennt.', 'bad');
      break;
    }
    case 'message': {
      handlePayload(ev.from, ev.payload);
      break;
    }
    default:
      break;
  }
}

function handlePayload(from: string, payload: Record<string, unknown>): void {
  const k = String(payload.k ?? '');
  const lan = mp.lan;
  if (!lan) return;

  if (k === 'hello') {
    if (mp.mode !== 'host') return;
    const existing = mp.players.find((p) => p.id === from);
    const desired = (payload.faction as FactionId | null) ?? null;
    if (existing) {
      existing.name = String(payload.name ?? existing.name);
      if (desired && !mp.players.some((p) => p.id !== from && p.faction === desired)) existing.faction = desired;
    } else {
      mp.players.push({ id: from, name: String(payload.name ?? 'Gast'), faction: freeFaction(desired), ready: false, host: false });
    }
    broadcastRoster();
    refreshLobby();
    return;
  }

  if (k === 'roster') {
    const list = (payload.players as LobbyPlayer[]) ?? [];
    mp.players = list;
    mp.code = String(payload.code ?? mp.code ?? '');
    mp.ready = new Set(list.filter((p) => p.ready).map((p) => p.id));
    refreshLobby();
    return;
  }

  if (k === 'chat') {
    mp.chat = [...mp.chat, { name: String(payload.name ?? 'Gast'), text: String(payload.text ?? '') }].slice(-24);
    if (mp.mode === 'host') lan.send({ k: 'chat', name: String(payload.name ?? 'Gast'), text: String(payload.text ?? '') });
    refreshLobby();
    return;
  }

  if (k === 'ready') {
    if (mp.mode === 'host') {
      if (payload.ready) mp.ready.add(from);
      else mp.ready.delete(from);
      broadcastRoster();
      refreshLobby();
    }
    return;
  }

  if (k === 'cmd' && mp.mode === 'host' && game) {
    const actor = mp.players.find((p) => p.id === from)?.faction;
    if (!actor) return;
    const res = applyCommand(game, actor, payload.cmd as Command);
    if (res.ok) broadcastState();
    else lan.send({ k: 'chat', name: 'System', text: res.msg }, from);
    return;
  }

  if (k === 'start' && mp.mode === 'client') {
    const next = payload.game as Game;
    const me = mp.players.find((p) => p.id === mp.myId);
    if (!next || !me?.faction) return;
    next.player = me.faction;
    lobby.hide();
    bootWorld(next);
    hud.toast(`Partie gestartet als ${FACTIONS_BY_ID[me.faction].short}.`, 'good');
    return;
  }

  if (k === 'state' && mp.mode === 'client' && game) {
    const next = payload.game as Game;
    const me = mp.players.find((p) => p.id === mp.myId);
    if (!next) return;
    next.player = me?.faction ?? game.player;
    game = next;
    sync({ world: true, scope: true });
    if (next.victory) {
      const finished = next;
      hud.showVictory(finished, () => {
        leaveLan();
      });
    }
    return;
  }
}

function hostStart(seed: number): void {
  const me = mp.players.find((p) => p.host);
  if (!me?.faction) {
    refreshLobby('Wähle zuerst eine Macht.');
    return;
  }
  applyIdentityToFaction(me.faction, loadIdentity());
  const g = createGame(seed, me.faction);
  lobby.hide();
  bootWorld(g);
  mp.lan?.send({ k: 'start', game: g });
  broadcastRoster();
  hud.toast(`LAN-Partie gestartet — ${mp.players.length} Spieler.`, 'good');
}

function leaveLan(): void {
  mp.lan?.close();
  mp.lan = null;
  mp.mode = 'solo';
  mp.players = [];
  mp.ready = new Set();
  mp.code = null;
  mp.hostId = '';
  mp.chat = [];
  lobby.hide();
  game = null;
  hud.showTitle();
}

async function hostLan(name: string, revealed?: (code: string) => void): Promise<void> {
  if (mp.connecting) return;
  mp.connecting = true;
  mp.mode = 'host';
  mp.players = [{ id: 'host', name, faction: mp.choice, ready: false, host: true }];
  lobby.show('host', 'Verbinde mit dem LAN-Relay…');
  const lan = new LanClient(handleNet);
  mp.lan = lan;
  try {
    await lan.connect();
    lan.create(name);
  } catch {
    mp.connecting = false;
    lobby.update({ status: 'Relay nicht erreichbar. Starte „npm run lan“ oder die Desktop-App.' });
    return;
  }
  mp.connecting = false;
  void revealed;
}

async function joinLan(code: string, name: string, host = ''): Promise<void> {
  if (mp.connecting) return;
  mp.connecting = true;
  mp.mode = 'client';
  mp.players = [{ id: 'me', name, faction: mp.choice, ready: false, host: false }];
  lobby.show('client', 'Verbinde…');
  const lan = new LanClient(handleNet);
  mp.lan = lan;
  try {
    await lan.connect(LanClient.url(host || undefined));
    lan.join(code, name);
  } catch {
    mp.connecting = false;
    lobby.update({ status: 'Relay nicht erreichbar. Prüfe WLAN und Host-Adresse.' });
    return;
  }
  mp.connecting = false;
}

function pickFaction(id: FactionId): void {
  mp.choice = id;
  const me = mp.players.find((p) => (mp.mode === 'host' ? p.host : p.id === mp.myId));
  if (me) me.faction = id;
  if (mp.mode === 'host') {
    if (mp.players.length === 1) mp.players[0].faction = id;
    broadcastRoster();
  } else {
    mp.lan?.send({ k: 'hello', name: me?.name ?? 'Gast', faction: id }, mp.hostId);
  }
  refreshLobby();
}

function toggleReady(): void {
  const me = mp.players.find((p) => p.id === mp.myId);
  if (!me) return;
  const now = !mp.ready.has(mp.myId);
  if (now) mp.ready.add(mp.myId);
  else mp.ready.delete(mp.myId);
  if (mp.mode === 'host') {
    broadcastRoster();
    refreshLobby(now ? 'Bereit — Gäste können beitreten.' : '');
  } else {
    mp.lan?.send({ k: 'ready', ready: now });
    refreshLobby(now ? 'Bereit gemeldet.' : '');
  }
}

function sendChat(text: string): void {
  const me = mp.players.find((p) => p.id === mp.myId);
  const name = me?.name ?? 'Ich';
  mp.chat = [...mp.chat, { name, text }].slice(-24);
  if (mp.mode === 'host') mp.lan?.send({ k: 'chat', name, text });
  else mp.lan?.send({ k: 'chat', name, text }, mp.hostId);
  refreshLobby();
}

// ---------------------------------------------------------------------------
// HUD actions
// ---------------------------------------------------------------------------
const actions: HudActions = {
  selectSystem,
  selectPlanet,
  selectFleet,
  beginTarget: (fleetId) => {
    ui.targetFleet = fleetId;
    galaxy.setTargetMode(true);
    sync({ scope: false });
    hud.toast('Kursziel wählen — klicke einen Sektor.', 'info');
  },
  cancelTarget: () => {
    ui.targetFleet = null;
    galaxy.setTargetMode(false);
    sync({ scope: false });
  },
  colonize: (planetId) => {
    if (!game) return;
    const planet = game.systems.flatMap((s) => s.planets).find((p) => p.id === planetId);
    if (!planet) return;
    const ark = game.fleets.find((f) => f.owner === game!.player && f.system === planet.systemId && f.ships.ark > 0);
    if (!ark) {
      hud.toast('Keine Arche im System.', 'bad');
      audio.deny();
      return;
    }
    dispatch({ kind: 'colonize', fleetId: ark.id, planetId });
  },
  build: (planetId, building) => dispatch({ kind: 'building', planetId, building }),
  buildShip: (planetId, ship) => dispatch({ kind: 'ship', planetId, ship }),
  research: (branch, techId) => dispatch({ kind: 'research', branch, techId }),
  diplo: (other, action) => dispatch({ kind: 'diplo', other, action }),
  endCycle: () => {
    void handleEndCycle();
  },
  setTab: chooseTab,
  startGame: (faction, seed) => {
    applyIdentityToFaction(faction, loadIdentity());
    const g = createGame(seed, faction);
    bootWorld(g);
    hud.toast(`Kampagne ${seed} gestartet — ${SHIP_ORDER.length} Rumpfklassen verfügbar.`, 'good');
    audio.confirm();
  },
  toggleAudio: () => {
    audio.setEnabled(!audio.enabled);
    hud.setState({ audio: audio.enabled });
    if (audio.enabled) audio.confirm();
  },
  lanHost: () => lobby.show('host'),
  lanJoin: () => lobby.show('client'),
};

hud = new Hud(uiRoot, actions);
lobby = new Lobby({
  hostLan: (name) => void hostLan(name),
  joinLan: (code, name, host) => void joinLan(code, name, host),
  pickFaction,
  toggleReady,
  start: hostStart,
  chat: sendChat,
  leave: leaveLan,
});
galaxy = new GalaxyView(galaxyCanvas, hud.stageHost);
scope = new SystemScope(hud.scopeCanvas);
battle = new BattleView(overlays);

galaxy.onPick = (res) => {
  if (!res || !game) return;
  if (res.type === 'fleet') {
    selectFleet(res.id);
    return;
  }
  if (ui.targetFleet !== null) {
    const fleetId = ui.targetFleet;
    ui.targetFleet = null;
    galaxy.setTargetMode(false);
    if (mp.mode === 'client') {
      dispatch({ kind: 'move', fleetId, target: res.id });
      selectSystem(res.id);
      return;
    }
    const res2 = applyCommand(game, game.player, { kind: 'move', fleetId, target: res.id });
    hud.toast(res2.msg, res2.ok ? 'good' : 'bad');
    if (res2.ok) {
      audio.confirm();
      selectSystem(res.id);
      if (mp.mode === 'host') broadcastState();
    } else {
      audio.deny();
      sync({ scope: false });
    }
    return;
  }
  selectSystem(res.id);
};

scope.onPick = (planetId) => {
  if (planetId !== null) selectPlanet(planetId);
};

// ---------------------------------------------------------------------------
// Arsenal
// ---------------------------------------------------------------------------
function arsenalStats(id: ShipId): string {
  const d = SHIP_CLASSES[id];
  return `<div><span>Legierungen</span><b>${d.alloy}</b></div>
    <div><span>Angriff</span><b>${d.attack}</b></div>
    <div><span>Hülle</span><b>${d.hull}</b></div>
    <div><span>Tempo</span><b>${d.speed}</b></div>`;
}

function openArsenal(): void {
  if (arsenalOverlay) return;
  const el = document.createElement('div');
  el.className = 'overlay';
  el.style.zIndex = '45';
  el.innerHTML = `
    <div class="modal">
      <div class="modal-head">
        <h2>Arsenal · Schiffsrümpfe</h2>
        <button class="btn btn-sm btn-ghost" data-close>Schließen</button>
      </div>
      <div class="modal-body">
        <div class="modal-list">
          ${SHIP_ORDER.map(
            (s) => `<button class="arsenal-item ${s === 'dreadnought' ? 'is-active' : ''}" data-ship="${s}">
              <b>${SHIP_CLASSES[s].name}</b>
              <span>${SHIP_CLASSES[s].role}</span>
            </button>`,
          ).join('')}
        </div>
        <div class="arsenal-view">
          <div class="arsenal-canvas-wrap"><canvas></canvas></div>
          <div class="arsenal-stats">${arsenalStats('dreadnought')}</div>
          <div class="arsenal-desc">${SHIP_CLASSES.dreadnought.desc}</div>
        </div>
      </div>
    </div>`;
  overlays.appendChild(el);
  arsenalOverlay = el;

  const canvas = el.querySelector('canvas') as HTMLCanvasElement;
  arsenal = new ArsenalView(canvas);
  const faction = game ? FACTIONS_BY_ID[game.player] : FACTIONS_BY_ID.concord;
  void arsenal.setShip('dreadnought', faction.color);

  const statsEl = el.querySelector('.arsenal-stats') as HTMLElement;
  const descEl = el.querySelector('.arsenal-desc') as HTMLElement;
  el.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    if (target.closest('[data-close]')) {
      closeArsenal();
      return;
    }
    const item = target.closest('[data-ship]') as HTMLElement | null;
    if (!item || !arsenal) return;
    const id = item.dataset.ship as ShipId;
    el.querySelectorAll('.arsenal-item').forEach((n) => n.classList.remove('is-active'));
    item.classList.add('is-active');
    statsEl.innerHTML = arsenalStats(id);
    descEl.textContent = SHIP_CLASSES[id].desc;
    void arsenal.setShip(SHIP_CLASSES[id].model, faction.color);
    audio.blip(700, 0.05, 'sine', 0.04);
  });
  requestAnimationFrame(() => arsenal?.resize());
}

function closeArsenal(): void {
  arsenal?.dispose();
  arsenal = null;
  arsenalOverlay?.remove();
  arsenalOverlay = null;
}

hud.openExternal = (name) => {
  if (name === 'arsenal') openArsenal();
  else hud.showHelp();
};

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------
window.addEventListener('pointerdown', () => audio.ensure(), { once: true });

window.addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLInputElement) return;
  if (lobby.isOpen) return;
  if (ev.code === 'Space') {
    ev.preventDefault();
    void handleEndCycle();
  } else if (ev.key === 'Escape') {
    if (arsenalOverlay) {
      closeArsenal();
      return;
    }
    if (ui.targetFleet !== null) {
      actions.cancelTarget();
      return;
    }
    ui.planet = null;
    ui.fleet = null;
    sync({ scope: true });
  } else if (ev.key >= '1' && ev.key <= '8') {
    const tabs: TabId[] = ['sector', 'empire', 'research', 'diplomacy'];
    const idx = Number(ev.key) - 1;
    if (idx < tabs.length) chooseTab(tabs[idx]);
  }
});

window.addEventListener('resize', () => {
  galaxy.resize();
  scope.resize();
  battle.resize();
  arsenal?.resize();
});

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game) galaxy.tick(dt);
  if (game && !battle.active && hud.getState().tab === 'sector') scope.tick(dt);
  battle.tick(dt);
  arsenal?.tick(dt);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Development-only inspection hook used by the automated playthrough checks.
// `import.meta.env.DEV` is false in production builds, so the bundler drops this.
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
  (window as unknown as Record<string, unknown>).__pax = {
    get game() {
      return game;
    },
    set game(next: Game | null) {
      game = next;
    },
    sync,
    broadcastState,
    handleEndCycle,
    bootWorld,
    get mode() {
      return mp.mode;
    },
    get players() {
      return mp.players;
    },
    get myId() {
      return mp.myId;
    },
    get battleActive() {
      return battle.active;
    },
  };
}
