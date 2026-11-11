'use strict';

/**
 * Captures real BattleView frames at the standard game camera.
 *
 * Usage:
 *   node_modules/.bin/electron tools/renders/capture-battle.cjs
 *
 * The Vite dev server must already run at PAX_CAPTURE_URL (default
 * http://127.0.0.1:5177/). The script boots fresh campaigns, injects battles
 * through the production endCycle path, and writes a full 13-class frame plus
 * two auto-framed detail battles to art/renders/.
 */
const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const url = process.env.PAX_CAPTURE_URL || 'http://127.0.0.1:5177/';
const outDir = process.env.PAX_CAPTURE_DIR || join(__dirname, '..', '..', 'art', 'renders');
const width = Number(process.env.PAX_CAPTURE_WIDTH || 1600);
const height = Number(process.env.PAX_CAPTURE_HEIGHT || 900);

app.on('window-all-closed', () => {});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(win, label, expression, timeoutMs = 20_000) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < timeoutMs) {
    try {
      if (await win.webContents.executeJavaScript(`Boolean(${expression})`, true)) return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(100);
  }
  throw new Error(`${label} timed out (${expression})${last ? `; last error: ${last}` : ''}`);
}

function fixture(ids) {
  const classes = JSON.stringify(ids);
  return `(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const pax = window.__pax;
    if (!pax) throw new Error('no pax hook');
    if (!pax.game) {
      const start = document.querySelector('[data-act="start"]');
      if (!start) throw new Error('no campaign start button');
      start.click();
    }
    for (let i = 0; i < 120 && !pax.game; i++) await sleep(80);
    const game = pax.game;
    if (!game) throw new Error('campaign did not boot');
    const player = game.player;
    const playerFleet = game.fleets.find((fleet) => fleet.owner === player);
    const enemyFleet = game.fleets.find((fleet) => fleet.owner !== player && game.empires[fleet.owner]?.alive)
      ?? game.fleets.find((fleet) => fleet.owner !== player);
    if (!playerFleet || !enemyFleet) throw new Error('missing battle fleets');
    const ids = ${classes};
    const hull = Object.fromEntries(pax.shipClasses.map((entry) => [entry.id, entry.hull]));
    const capital = game.empires[player].capital;
    const capitalSystem = game.systems.find((system) => system.planets.some((planet) => planet.id === capital));
    const target = game.systems.find((system) => system.id !== capitalSystem?.id && system.planets.every((planet) => planet.owner === null))
      ?? game.systems.find((system) => system.owner === player && system.id !== capitalSystem?.id);
    if (!target) throw new Error('no battle system');
    target.owner = player;
    const zero = (fleet) => {
      for (const cls of Object.keys(fleet.ships)) { fleet.ships[cls] = 0; fleet.hp[cls] = 0; }
      fleet.path = []; fleet.step = 0; fleet.wait = 0;
    };
    for (const fleet of game.fleets) {
      if (fleet !== playerFleet && fleet !== enemyFleet && fleet.system === target.id) zero(fleet);
    }
    const squad = (fleet, list) => {
      zero(fleet);
      fleet.system = target.id; fleet.path = [target.id]; fleet.step = 0; fleet.wait = 1;
      for (const cls of list) { fleet.ships[cls] = 1; fleet.hp[cls] = hull[cls]; }
    };
    squad(playerFleet, ids);
    squad(enemyFleet, ids);
    for (const key of Object.keys(game.states)) game.states[key] = 'peace';
    for (const key of Object.keys(game.relations)) game.relations[key] = 0;
    const warKey = [player, enemyFleet.owner].sort().join('|');
    game.states[warKey] = 'war';
    game.relations[warKey] = -80;
    game.cycle = 4;
    game.victory = null;
    for (const planet of game.systems.flatMap((system) => system.planets)) {
      planet.queue = null; planet.progress = 0; planet.siege = 0;
    }
    for (const empire of Object.values(game.empires)) {
      for (const branch of Object.keys(empire.active)) {
        empire.active[branch] = 'civic12';
        empire.progress[branch] = -1e9;
      }
    }
    pax.sync({ world: true, scope: true });
    pax.handleEndCycle();
    return { player, enemy: enemyFleet.owner, target: target.name, classes: ids.length };
  })()`;
}

async function capture(ids, filename) {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    backgroundColor: '#05070c',
    webPreferences: { backgroundThrottling: false, offscreen: false },
  });
  try {
    win.setContentSize(width, height);
    await win.loadURL(url);
    win.showInactive();
    await waitFor(win, `${filename} app boot`, `window.__pax && document.querySelector('[data-act="start"]')`);
    const setup = await win.webContents.executeJavaScript(fixture(ids), true);
    await waitFor(win, `${filename} fleet build`, `document.querySelector('.battle-overlay')?.dataset.shipGroups === '${ids.length * 2}'`);
    await sleep(700);
    const image = await win.webContents.capturePage();
    writeFileSync(join(outDir, filename), image.toPNG());
    console.log(`[capture] ${filename}: ${JSON.stringify(setup)}`);
  } finally {
    win.destroy();
  }
}

app.whenReady().then(async () => {
  try {
    mkdirSync(outDir, { recursive: true });
    const bootstrap = new BrowserWindow({ width, height, show: false });
    await bootstrap.loadURL(url);
    await waitFor(bootstrap, 'class list', `window.__pax?.shipClasses?.length >= 13`);
    const all = await bootstrap.webContents.executeJavaScript('window.__pax.shipClasses.map((entry) => entry.id)', true);
    bootstrap.destroy();
    assert(all.length >= 13, `expected at least 13 ship classes, got ${all.length}`);
    await capture(all, `battle-${all.length}-classes.png`);
    await capture(all.slice(0, 7), 'battle-detail-a.png');
    await capture(all.slice(7), 'battle-detail-b.png');
    app.exit(0);
  } catch (error) {
    console.error(`FAIL [capture-battle] ${error instanceof Error ? error.message : String(error)}`);
    app.exit(1);
  }
});
