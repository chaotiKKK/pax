'use strict';

/**
 * Down-hit regression test for the star map, driven in real Electron Chromium.
 *
 * Both cases press down on a system, move the camera while the pointer is
 * still held, and release at the original screen position. Selection must come
 * from the raycast taken on pointerdown, never from the release coordinates.
 */

const { app, BrowserWindow } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const target = process.env.PAX_SMOKE_URL;
if (!target) {
  console.error('FAIL [setup] PAX_SMOKE_URL is missing');
  process.exit(1);
}

const profileDir = mkdtempSync(join(tmpdir(), 'pax-aeterna-input-smoke-'));
app.setPath('userData', profileDir);
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('touch-events', 'enabled');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

let win = null;
let finished = false;
let currentCase = 'setup';
let watchdog = null;
let debuggerAttached = false;
const consoleErrors = [];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function finish(code, error) {
  if (finished) return;
  finished = true;
  if (watchdog) clearTimeout(watchdog);
  if (error) {
    console.error(`FAIL [${currentCase}] ${error instanceof Error ? error.message : String(error)}`);
  }
  if (debuggerAttached) {
    try {
      win?.webContents.debugger.detach();
    } catch {
      /* window may already be gone */
    }
    debuggerAttached = false;
  }
  try {
    win?.destroy();
    win = null;
  } catch {
    /* window already gone */
  }
  setTimeout(() => {
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* Chromium may still hold a cache file on Windows; the profile is disposable. */
    }
    process.exitCode = code;
    process.exit(code);
  }, 120);
}

async function page(script) {
  if (!win) throw new Error('browser window is not available');
  try {
    return await win.webContents.executeJavaScript(script, true);
  } catch (error) {
    throw new Error(`page evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function pageAsync(body) {
  return page(`(async () => {${body}})()`);
}

async function waitFor(label, expression, timeoutMs = 10_000) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      if (await page(`Boolean(${expression})`)) return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(80);
  }
  const suffix = lastError ? `; last page error: ${lastError}` : '';
  throw new Error(`${label} timed out after ${timeoutMs} ms (condition: ${expression})${suffix}`);
}

async function click(selector, fractionX = 0.5, fractionY = 0.5) {
  const quoted = JSON.stringify(selector);
  const rect = await page(`(() => {
    const el = document.querySelector(${quoted});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 80),
    };
  })()`);
  assert(rect, `UI target not found: ${selector}`);
  assert(rect.width > 2 && rect.height > 2, `UI target has no clickable area: ${selector}`);
  const x = Math.round(rect.left + rect.width * fractionX);
  const y = Math.round(rect.top + rect.height * fractionY);
  assert(
    x >= 0 && y >= 0 && x < rect.viewportWidth && y < rect.viewportHeight,
    `UI target ${selector} is outside the ${rect.viewportWidth}x${rect.viewportHeight} content viewport at (${x}, ${y})`,
  );
  const hit = await page(`(() => {
    const el = document.elementFromPoint(${x}, ${y});
    return el ? {
      matches: !!el.closest(${quoted}),
      atPoint: el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\\s+/).join('.') : ''),
    } : null;
  })()`);
  assert(
    hit && hit.matches,
    `UI target ${selector} is covered at (${x}, ${y}); hit ${hit ? hit.atPoint : 'nothing'}`,
  );

  win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
  win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await sleep(35);
  win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await sleep(200);
  return { x, y, label: rect.label };
}

async function startCampaign() {
  currentCase = 'campaign-start';
  // Fixed seed: candidate systems and their screen positions must be
  // reproducible when a down-hit assertion fails.
  await page(`(() => {
    const input = document.querySelector('#seed-input');
    if (input) input.value = '424242';
    return true;
  })()`);
  await click('[data-act="start"]', 0.5, 0.5);
  await waitFor(
    'campaign boot with a selected capital',
    `window.__pax?.game?.systems?.length > 0 && window.__pax.selection?.system !== null`,
    20_000,
  );
  await sleep(700);
  await page(`(() => {
    window.__pax.galaxy.resize();
    return true;
  })()`);
  await sleep(260);
}

async function chooseFoundingProfile() {
  currentCase = 'founding-profile';
  await waitFor('identity editor choices', `document.querySelector('button[data-ie="ship"]')`, 10_000);
  await click('button[data-ie="ship"][data-v="frigate"]', 0.5, 0.5);
  await click('button[data-ie="trait"][data-v="psionic"]', 0.5, 0.5);
  await click('button[data-ie="government"][data-v="technocracy"]', 0.5, 0.5);
  await click('button[data-ie="worldview"][data-v="enlightened"]', 0.5, 0.5);
  await click('button[data-ie="religion"][data-v="void"]', 0.5, 0.5);
  const saved = await page(`(() => {
    try { return JSON.parse(localStorage.getItem('pax-aeterna-identity') || '{}'); } catch { return {}; }
  })()`);
  assert(saved.shipClass === 'frigate', `ship choice was not persisted: ${JSON.stringify(saved)}`);
  assert(saved.traits?.includes('psionic'), `trait choice was not persisted: ${JSON.stringify(saved.traits)}`);
  assert(saved.government === 'technocracy', `government was not persisted: ${String(saved.government)}`);
  assert(saved.worldview === 'enlightened', `worldview was not persisted: ${String(saved.worldview)}`);
  assert(saved.religion === 'void', `religion was not persisted: ${String(saved.religion)}`);
}

async function verifyFoundingProfile() {
  currentCase = 'founding-profile';
  const state = await page(`(() => {
    const game = window.__pax.game;
    const empire = game.empires[game.player];
    const fleet = game.fleets.find((entry) => entry.owner === game.player);
    return { profile: empire.profile ?? null, mods: empire.profileMods ?? null, ships: fleet?.ships ?? null };
  })()`);
  assert(state.profile, 'campaign empire has no founding profile');
  assert(state.profile.shipClass === 'frigate', `start hull is ${state.profile.shipClass}, expected frigate`);
  assert(state.profile.traits?.includes('psionic'), `traits are ${JSON.stringify(state.profile.traits)}, expected psionic`);
  assert(state.profile.government === 'technocracy', `government is ${state.profile.government}`);
  assert(state.profile.worldview === 'enlightened', `worldview is ${state.profile.worldview}`);
  assert(state.profile.religion === 'void', `religion is ${state.profile.religion}`);
  assert(state.ships?.frigate === 3, `start fleet has ${String(state.ships?.frigate)} frigates, expected 3`);
  assert(state.ships?.corvette === 1, `start fleet has ${String(state.ships?.corvette)} corvettes, expected 1 escort`);
  assert(state.mods, 'founding profile produced no empire multipliers');
  assert(state.mods.research > 1.2, `founding research multiplier is ${state.mods.research}, expected > 1.2`);
  console.log(
    `PASS founding-profile: frigate x3 + corvette escort, psionic, technocracy/enlightened/void, ` +
      `research x${state.mods.research.toFixed(2)}`,
  );
}

async function installProbe() {
  await page(`(() => {
    const canvas = document.querySelector('#galaxy');
    if (!canvas) throw new Error('galaxy canvas missing');
    if (!window.__inputSmoke) {
      const state = { downs: [], ups: [] };
      canvas.addEventListener('pointerdown', (ev) => {
        state.downs.push({ type: ev.pointerType, x: ev.clientX, y: ev.clientY, at: performance.now() });
      }, true);
      window.addEventListener('pointerup', (ev) => {
        state.ups.push({ type: ev.pointerType, x: ev.clientX, y: ev.clientY, at: performance.now() });
      }, true);
      window.__inputSmoke = state;
    }
    window.__inputSmoke.downs.length = 0;
    window.__inputSmoke.ups.length = 0;
    return true;
  })()`);
}

async function freezeCamera() {
  await page(`(() => {
    const galaxy = window.__pax.galaxy;
    galaxy.thetaT = galaxy.theta;
    galaxy.phiT = galaxy.phi;
    galaxy.distT = galaxy.dist;
    galaxy.idleSpin = 0;
    galaxy.tick(0.016);
    return true;
  })()`);
}

/** Visible, fleet-free systems whose centre is the bare canvas, not a panel. */
async function candidateSystems() {
  return page(`(() => {
    const pax = window.__pax;
    const game = pax.game;
    const canvas = document.querySelector('#galaxy');
    const width = innerWidth;
    const height = innerHeight;
    const list = [];
    for (const sys of game.systems) {
      const pos = pax.galaxy.screenPosition(sys.id);
      if (!pos) continue;
      if (pos.x < width * 0.16 || pos.x > width * 0.84) continue;
      if (pos.y < height * 0.16 || pos.y > height * 0.8) continue;
      const occupied = game.fleets.some(
        (fleet) => fleet.system === sys.id && Object.values(fleet.ships).some((count) => count > 0),
      );
      if (occupied) continue;
      const el = document.elementFromPoint(pos.x, pos.y);
      if (el !== canvas) continue;
      list.push({
        id: sys.id,
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        offset: Math.hypot(pos.x - width / 2, pos.y - height / 2) / width,
      });
    }
    list.sort((a, b) => b.offset - a.offset);
    return list.slice(0, 32);
  })()`);
}

function pairOf(list, skipId) {
  const pool = list.filter((entry) => entry.id !== skipId);
  let best = null;
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const distance = Math.hypot(pool[i].x - pool[j].x, pool[i].y - pool[j].y);
      if (!best || distance > best.distance) best = { a: pool[i], b: pool[j], distance };
    }
  }
  return best;
}

/** Zoom and orbit while the pointer is held; report how far the target moved. */
function moveCamera(systemId) {
  return pageAsync(`
    const galaxy = window.__pax.galaxy;
    const before = galaxy.screenPosition(${systemId});
    galaxy.distT = Math.max(90, galaxy.distT * 0.55);
    galaxy.dist = galaxy.distT;
    galaxy.thetaT += 0.24;
    galaxy.theta = galaxy.thetaT;
    // Project against the moved camera even if Chromium throttles rAF while a
    // synthetic touch is captured; one tick also refreshes matrixWorldInverse.
    // No waiting here: the tap must stay inside the engine's 450/500 ms window.
    galaxy.tick(0.016);
    const after = galaxy.screenPosition(${systemId});
    return {
      before,
      after,
      shift: Math.hypot(after.x - before.x, after.y - before.y),
    };
  `);
}

async function enableTouch() {
  if (!debuggerAttached) {
    win.webContents.debugger.attach('1.3');
    debuggerAttached = true;
  }
  await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 5,
  });
}

function dispatchTouch(type, points) {
  return win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', {
    type,
    touchPoints: points,
  });
}

async function downHitMouse() {
  currentCase = 'down-hit-mouse';
  await installProbe();
  await freezeCamera();
  const previous = await page('window.__pax.selection.system');
  const list = await candidateSystems();
  assert(list.length >= 2, `found only ${list.length} clickable systems without fleets for the mouse case`);
  const pair = pairOf(list, previous);
  assert(pair, 'no two visible systems were available for the mouse down-hit case');
  const targetSystem = pair.a;

  win.webContents.sendInputEvent({ type: 'mouseMove', x: targetSystem.x, y: targetSystem.y });
  win.webContents.sendInputEvent({
    type: 'mouseDown',
    x: targetSystem.x,
    y: targetSystem.y,
    button: 'left',
    clickCount: 1,
  });
  await sleep(45);
  const motion = await moveCamera(targetSystem.id);
  win.webContents.sendInputEvent({
    type: 'mouseUp',
    x: targetSystem.x,
    y: targetSystem.y,
    button: 'left',
    clickCount: 1,
  });
  await sleep(320);

  const state = await page(`({
    selection: window.__pax.selection,
    downs: window.__inputSmoke.downs,
    ups: window.__inputSmoke.ups,
  })`);
  const held = state.ups.length && state.downs.length ? state.ups[0].at - state.downs[0].at : Infinity;
  assert(
    motion.shift > 40 && Math.hypot(motion.after.x - targetSystem.x, motion.after.y - targetSystem.y) > 40,
    `camera moved only ${motion.shift.toFixed(1)} px; the test could not distinguish down-hit from release-hit`,
  );
  assert(held < 480, `the mouse was held for ${held.toFixed(0)} ms, beyond the 500 ms tap window`);
  assert(state.downs.length === 1, `expected one pointerdown, saw ${JSON.stringify(state.downs)}`);
  // Electron's synthesized mouse input can surface an empty pointerType; the
  // event still travelled the real mouse pipeline (touch is enabled later).
  assert(
    state.downs[0].type === 'mouse' || state.downs[0].type === '',
    `pointerdown was ${JSON.stringify(state.downs[0].type)}, expected mouse`,
  );
  assert(state.ups.length === 1, `expected one pointerup, saw ${JSON.stringify(state.ups)}`);
  assert(
    state.ups[0].type === 'mouse' || state.ups[0].type === '',
    `pointerup was ${JSON.stringify(state.ups[0].type)}, expected mouse`,
  );
  const probePoint = await page(`({
    target: window.__pax.galaxy.screenPosition(${targetSystem.id}),
    selected: window.__pax.galaxy.screenPosition(${String(state.selection.system)}),
  })`);
  assert(
    state.selection.system === targetSystem.id,
    `mouse down-hit regression: selected system ${String(state.selection.system)} but pointerdown hit system ${targetSystem.id}; ` +
      `down event ${JSON.stringify(state.downs[0])} vs target (${targetSystem.x}, ${targetSystem.y}); ` +
      `target now at ${JSON.stringify(probePoint.target)}, selected at ${JSON.stringify(probePoint.selected)}; ` +
      `the camera moved ${motion.shift.toFixed(1)} px before pointerup (previous selection ${String(previous)})`,
  );
  console.log(
    `PASS down-hit-mouse: system ${targetSystem.id} kept from pointerdown after ${held.toFixed(0)} ms, ` +
      `camera moved ${motion.shift.toFixed(1)} px, release point was ` +
      `${Math.round(Math.hypot(motion.after.x - targetSystem.x, motion.after.y - targetSystem.y))} px away from the star`,
  );
  return targetSystem.id;
}

/**
 * Arm a one-shot touch camera move that runs in the page immediately after the
 * app's own pointerdown handler, so no main-process round trip sits between
 * touchstart and touchend (the tap window is only 450 ms).
 */
async function armTouchCamera(systemId) {
  await page(`(() => {
    const galaxy = window.__pax.galaxy;
    window.__touchCamera = null;
    const onDown = (ev) => {
      if (ev.pointerType !== 'touch') return;
      window.removeEventListener('pointerdown', onDown, false);
      const before = galaxy.screenPosition(${systemId});
      galaxy.distT = Math.max(90, galaxy.distT * 0.55);
      galaxy.dist = galaxy.distT;
      galaxy.thetaT += 0.24;
      galaxy.theta = galaxy.thetaT;
      // Reposition only: a full composer render inside the pointerdown handler
      // stalls CDP touch dispatch for seconds on software GL.
      galaxy.placeCamera();
      const after = galaxy.screenPosition(${systemId});
      window.__touchCamera = { before, after, shift: Math.hypot(after.x - before.x, after.y - before.y) };
    };
    window.addEventListener('pointerdown', onDown, false);
    return true;
  })()`);
}

async function downHitTouch(previous) {
  currentCase = 'down-hit-touch';
  await installProbe();
  await freezeCamera();
  const list = await candidateSystems();
  assert(list.length >= 2, `found only ${list.length} clickable systems without fleets for the touch case`);
  const pair = pairOf(list, previous);
  assert(pair, 'no two visible systems were available for the touch down-hit case');
  const targetSystem = pair.b;

  await armTouchCamera(targetSystem.id);
  const startAt = Date.now();
  // Queue both halves back to back: the tap window is 450 ms and the CDP
  // round trip must not consume it. The page-side listener still moves the
  // camera during touchstart, before touchend is processed.
  const startCommand = dispatchTouch('touchStart', [
    { x: targetSystem.x, y: targetSystem.y, id: 1, radiusX: 3, radiusY: 3, force: 1 },
  ]);
  const endCommand = dispatchTouch('touchEnd', []);
  await Promise.all([startCommand, endCommand]);
  const endAt = Date.now();
  const doneAt = endAt;
  await sleep(320);

  const state = await page(`({
    selection: window.__pax.selection,
    downs: window.__inputSmoke.downs,
    ups: window.__inputSmoke.ups,
    camera: window.__touchCamera,
  })`);
  assert(state.camera, 'touchstart never reached the armed camera listener');
  const motion = state.camera;
  const held = state.ups.length && state.downs.length ? state.ups[0].at - state.downs[0].at : Infinity;
  assert(
    motion.shift > 40 && Math.hypot(motion.after.x - targetSystem.x, motion.after.y - targetSystem.y) > 40,
    `camera moved only ${motion.shift.toFixed(1)} px; the test could not distinguish down-hit from release-hit`,
  );
  assert(
    held < 440,
    `the touch was held for ${held.toFixed(0)} ms, beyond the 450 ms tap window ` +
      `(CDP touchstart ${endAt - startAt} ms, touchend ${doneAt - endAt} ms)`,
  );
  assert(state.downs.length >= 1, 'touchStart produced no pointerdown on the star map');
  assert(
    state.downs.some((entry) => entry.type === 'touch'),
    `touchStart produced pointer types ${JSON.stringify(state.downs.map((entry) => entry.type))}; expected touch`,
  );
  assert(
    state.ups.some((entry) => entry.type === 'touch'),
    `touchEnd produced pointer types ${JSON.stringify(state.ups.map((entry) => entry.type))}; expected touch`,
  );
  assert(
    state.selection.system === targetSystem.id,
    `touch down-hit regression: selected system ${String(state.selection.system)} but touchstart hit system ${targetSystem.id}; ` +
      `the camera moved ${motion.shift.toFixed(1)} px before touchend (previous selection ${String(previous)})`,
  );
  console.log(
    `PASS down-hit-touch: system ${targetSystem.id} kept from touchstart after ${held.toFixed(0)} ms, ` +
      `camera moved ${motion.shift.toFixed(1)} px, release point was ` +
      `${Math.round(Math.hypot(motion.after.x - targetSystem.x, motion.after.y - targetSystem.y))} px away from the star ` +
      `(CDP ${endAt - startAt}+${doneAt - endAt} ms)`,
  );
}

async function run() {
  watchdog = setTimeout(() => {
    finish(1, new Error(`hard timeout after 100s; current case: ${currentCase}`));
  }, 100_000);
  watchdog.unref?.();

  win = new BrowserWindow({
    width: 1280,
    height: 1000,
    useContentSize: true,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#05070b',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) {
      consoleErrors.push(message);
      console.log(`[renderer error] ${message}`);
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    finish(1, new Error(`renderer process gone: ${details.reason}`));
  });

  await win.loadURL(target);
  await waitFor(
    'game boot',
    `window.__pax && document.querySelector('[data-act="start"]') && window.__pax.selection`,
    20_000,
  );
  const viewport = await page('({ width: innerWidth, height: innerHeight })');
  console.log(`[input-smoke] Electron content viewport: ${viewport.width}x${viewport.height}`);

  await chooseFoundingProfile();
  await startCampaign();
  await verifyFoundingProfile();

  // Mouse first, while touch emulation is off; then enable touch and repeat
  // the same down-hit scenario through the DevTools touch pipeline.
  const mouseSystem = await downHitMouse();
  await enableTouch();
  await downHitTouch(mouseSystem);

  await sleep(200);
  assert(
    consoleErrors.length === 0,
    `renderer reported ${consoleErrors.length} error(s): ${consoleErrors.slice(0, 3).join(' | ')}`,
  );

  currentCase = 'complete';
  console.log(
    'PASS input-smoke: founding profile baked into the campaign, mouse and touch both resolve selection from the pointerdown hit',
  );
  finish(0);
}

app
  .whenReady()
  .then(run)
  .catch((error) => finish(1, error));
