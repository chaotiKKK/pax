'use strict';

const { app, BrowserWindow } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const target = process.env.PAX_SMOKE_URL;
if (!target) {
  console.error('FAIL [setup] PAX_SMOKE_URL is missing');
  process.exit(1);
}

const profileDir = mkdtempSync(join(tmpdir(), 'pax-aeterna-audio-smoke-'));
app.setPath('userData', profileDir);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.disableHardwareAcceleration();
// finish() destroys the window and then exits with the test result code. Keep
// Electron from quitting on window-all-closed before that timer runs.
app.on('window-all-closed', () => {});

let win = null;
let finished = false;
let currentCase = 'setup';
let watchdog = null;
const consoleMessages = [];
const audioRequests = new Map();
const audioFailures = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fmt(value) {
  return Number(value).toFixed(3);
}

function finish(code, error) {
  if (finished) return;
  finished = true;
  if (watchdog) clearTimeout(watchdog);
  if (error) {
    console.error(`FAIL [${currentCase}] ${error instanceof Error ? error.message : String(error)}`);
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
      /* Chromium may still hold a cache file on Windows; the temp profile is disposable. */
    }
    // app.exit() can surface as exit code 0 for Electron GUI processes on
    // Windows. The smoke command must be able to fail the shell, so terminate
    // the main process explicitly after the window and temporary profile are gone.
    process.exitCode = code;
    process.exit(code);
  }, 120);
}

async function page(script) {
  if (!win) throw new Error('browser window is not available');
  try {
    return await win.webContents.executeJavaScript(script, true);
  } catch (error) {
    throw new Error(
      `page evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
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
  await sleep(180);
  return { x, y, label: rect.label };
}

async function installAudioProbe() {
  await page(`(() => {
    const audio = window.__pax.audio;
    if (!window.__audioSmoke) {
      const state = { installed: false, calls: [], rates: [] };
      const originalPlay = audio.play.bind(audio);
      audio.play = (cue, opts = {}) => {
        state.calls.push({
          cue,
          pan: typeof opts.pan === 'number' ? opts.pan : null,
          pitch: typeof opts.pitch === 'number' ? opts.pitch : null,
          at: performance.now(),
        });
        return originalPlay(cue, opts);
      };
      const ctx = audio.ctx;
      const originalCreateSource = ctx.createBufferSource.bind(ctx);
      ctx.createBufferSource = (...args) => {
        const source = originalCreateSource(...args);
        const originalStart = source.start.bind(source);
        source.start = (...startArgs) => {
          state.rates.push({ rate: source.playbackRate.value, at: performance.now() });
          return originalStart(...startArgs);
        };
        return source;
      };
      state.installed = true;
      window.__audioSmoke = state;
    }
    window.__audioSmoke.calls.length = 0;
    window.__audioSmoke.rates.length = 0;
    return true;
  })()`);
}

async function unlockAndWaitForAudio() {
  // A click on the heading is a real user gesture but not an interactive control:
  // it starts the AudioContext without producing a test cue.
  await click('.title-hero h1', 0.5, 0.5);
  await waitFor(
    'AudioContext and audio manifest',
    `window.__pax?.audio?.ctx?.state === 'running' &&
     !!window.__pax.audio.manifest &&
     window.__pax.audio.group?.screen === 'title'`,
    15_000,
  );
}

async function identityCues() {
  currentCase = 'identity-cues';
  await installAudioProbe();

  await click('button.ie-swatch[data-key="primary"][data-v="#e0566b"]', 0.08, 0.5);
  await waitFor('first swatch cue', 'window.__audioSmoke.calls.length >= 1', 3_000);
  await click('button.ie-swatch[data-key="accent"][data-v="#d8c7ff"]', 0.92, 0.5);
  await waitFor('second swatch cue', 'window.__audioSmoke.calls.length >= 2', 3_000);
  await click('button.ie-crest[data-v="2"]', 0.5, 0.5);
  await waitFor('crest cue', 'window.__audioSmoke.calls.length >= 3', 3_000);

  await waitFor(
    'identity cue buffers reached the real AudioContext',
    'window.__audioSmoke.rates.length >= 3',
    8_000,
  );
  const beforeStart = await page(`(() => {
    const audio = window.__pax.audio;
    const defs = {};
    for (const key of ['swatch', 'crest', 'apply']) {
      const def = audio.manifest?.sfx?.[key];
      defs[key] = def ? { bus: def.bus, files: def.files, gainDb: def.gainDb } : null;
    }
    return {
      calls: window.__audioSmoke.calls.map((entry) => ({
        cue: entry.cue,
        pan: entry.pan,
        pitch: entry.pitch,
      })),
      rates: window.__audioSmoke.rates.map((entry) => entry.rate),
      defs,
      context: audio.ctx?.state ?? null,
    };
  })()`);

  const cues = beforeStart.calls.map((entry) => entry.cue);
  assert(
    !cues.includes('ui_click'),
    `identity controls played the generic ui_click; cues were ${JSON.stringify(cues)}`,
  );
  const swatches = beforeStart.calls.filter((entry) => entry.cue === 'swatch');
  assert(
    swatches.length === 2,
    `expected two swatch cues from the two swatch clicks, got ${JSON.stringify(cues)}`,
  );
  assert(
    swatches[0].pan !== null && swatches[0].pan < -0.3,
    `left-edge swatch had no leftward pan; expected < -0.3, got ${String(swatches[0].pan)}`,
  );
  assert(
    swatches[1].pan !== null && swatches[1].pan > 0.3,
    `right-edge swatch had no rightward pan; expected > 0.3, got ${String(swatches[1].pan)}`,
  );
  assert(
    beforeStart.calls.filter((entry) => entry.cue === 'crest').length === 1,
    `expected exactly one crest cue, got ${JSON.stringify(cues)}`,
  );
  assert(
    beforeStart.rates.length >= 3,
    `identity cues did not start three real audio sources; saw ${beforeStart.rates.length}`,
  );
  for (const rate of beforeStart.rates) {
    assert(
      rate >= 0.93 && rate <= 1.07,
      `identity pitch fell outside the engine's 0.94..1.06 variation range: ${rate}`,
    );
  }
  const distinctRates = new Set(beforeStart.rates.map((rate) => rate.toFixed(4)));
  assert(
    distinctRates.size >= 2,
    `identity cues produced no pitch variation; playback rates were ${JSON.stringify(beforeStart.rates)}`,
  );
  for (const key of ['swatch', 'crest', 'apply']) {
    const def = beforeStart.defs[key];
    assert(def, `missing manifest cue group: ${key}`);
    assert(def.bus === 'ui', `${key} should use the ui bus, got ${def.bus}`);
    assert(def.files?.length > 0, `${key} manifest group has no audio files`);
    assert(
      def.files.every((file) => file.includes(`/${key}`) || file.includes(`${key}.`)),
      `${key} manifest group does not point at its own cue file: ${JSON.stringify(def.files)}`,
    );
  }

  await click('[data-act="start"]', 0.5, 0.5);
  await waitFor('campaign start after identity click', 'window.__pax.game?.player', 12_000);
  await waitFor(
    'apply cue from campaign start',
    'window.__audioSmoke.calls.some((entry) => entry.cue === "apply")',
    3_000,
  );
  const afterStart = await page(`({
    cues: window.__audioSmoke.calls.map((entry) => entry.cue),
    context: window.__pax.audio.ctx?.state ?? null,
    player: window.__pax.game?.player ?? null,
  })`);
  assert(
    !afterStart.cues.includes('ui_click'),
    `campaign-start identity control played ui_click; cues were ${JSON.stringify(afterStart.cues)}`,
  );
  assert(
    afterStart.cues.includes('swatch') &&
      afterStart.cues.includes('crest') &&
      afterStart.cues.includes('apply'),
    `expected swatch, crest and apply after identity interactions, got ${JSON.stringify(afterStart.cues)}`,
  );
  assert(afterStart.context === 'running', `AudioContext is ${afterStart.context} during identity test`);
  assert(afterStart.player, 'campaign did not start; apply cue cannot be considered verified');

  console.log(
    `PASS identity-cues: swatch(pan ${fmt(swatches[0].pan)}/${fmt(swatches[1].pan)}) + crest + apply, ` +
      `ui_click=0, pitch rates ${beforeStart.rates.map((rate) => rate.toFixed(4)).join('/')}`,
  );
}

async function initialTensionMix() {
  currentCase = 'initial-tension-mix';
  const setup = await pageAsync(`
    const pax = window.__pax;
    const audio = pax.audio;
    const game = pax.game;
    if (!game) throw new Error('no active game after campaign start');
    audio.enterTitle();
    const titleDeadline = performance.now() + 8000;
    while (performance.now() < titleDeadline && audio.group?.screen !== 'title') {
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    if (audio.group?.screen !== 'title') {
      throw new Error('title music did not start before the tension map boot');
    }
    window.__titleMix = {
      screen: audio.group.screen,
      key: audio.group.key,
      layers: [...audio.group.layers.keys()],
      ambience: audio.group.layers.get('ambience')?.gain.value ?? null,
      main: audio.group.layers.get('main')?.gain.value ?? null,
      musicBus: audio.musicBus?.gain.value ?? null,
      master: audio.master?.gain.value ?? null,
    };
    const warKey = Object.keys(game.states).find(
      (key) => key.split('|').includes(game.player) && game.states[key] === 'peace',
    );
    if (!warKey) throw new Error('no player peace state available to turn into a war');
    const ownSystem = game.systems.find((system) => system.owner === game.player);
    const enemyFleet = game.fleets.find((fleet) => fleet.owner !== game.player);
    if (!ownSystem) throw new Error('player owns no system for the enemy-home tension case');
    if (!enemyFleet) throw new Error('no enemy fleet available for the enemy-home tension case');
    const oldSystem = enemyFleet.system;
    game.states[warKey] = 'war';
    enemyFleet.system = ownSystem.id;
    window.__audioSmokeState = { warKey, enemyFleetId: enemyFleet.id, oldSystem };
    pax.bootWorld(game);
    return { warKey, ownSystem: ownSystem.id, enemyFleet: enemyFleet.id, oldSystem };
  `);

  await waitFor(
    'map music with ambience, tension and percussion stems',
    `window.__pax.audio.group?.screen === 'map' &&
     window.__pax.audio.group.layers.has('ambience') &&
     window.__pax.audio.group.layers.has('tension') &&
     window.__pax.audio.group.layers.has('perc')`,
    15_000,
  );
  // Die Tension-/Perc-Stems werden in startGroup auf 0.72/0.78 gerampt
  // (1.4 s). Warten, bis die Rampe abgeschlossen ist, statt fest zu schlafen —
  // AudioParam.value zeigt sonst einen Zwischenwert mitten in der Fade.
  await waitFor(
    'map stem gains settled after ramp',
    `(() => { const g = window.__pax.audio.group; const t = g?.layers?.get('tension')?.gain.value ?? 0; const p = g?.layers?.get('perc')?.gain.value ?? 0; return Math.abs(t - 0.72) <= 0.03 && Math.abs(p - 0.78) <= 0.03; })()`,
    15_000,
  );
  const mix = await page(`(() => {
    const audio = window.__pax.audio;
    const group = audio.group;
    const layer = (name) => group?.layers?.get(name)?.gain.value ?? null;
    const ambienceBuffer = audio.buffers?.get('music/deep-sub-bass-drones.mp3');
    return {
      screen: group?.screen ?? null,
      key: group?.key ?? null,
      base: layer('base'),
      ambience: layer('ambience'),
      ambienceDuration: ambienceBuffer?.duration ?? null,
      tension: layer('tension'),
      perc: layer('perc'),
      mapTension: audio.mapTension,
      lastMapTension: audio.lastMapTension,
    };
  })()`);
  assert(mix.screen === 'map', `tension map music is ${mix.screen}, expected map`);
  assert(
    mix.tension !== null && Math.abs(mix.tension - 0.72) <= 0.03,
    `initial tension stem should be 0.72 ±0.03, got ${mix.tension}; mapTension=${mix.mapTension}, layers=${JSON.stringify(mix)}`,
  );
  assert(
    mix.perc !== null && Math.abs(mix.perc - 0.78) <= 0.03,
    `initial percussion stem should be 0.78 ±0.03, got ${mix.perc}; mapTension=${mix.mapTension}, layers=${JSON.stringify(mix)}`,
  );
  assert(
    mix.ambience !== null && Math.abs(mix.ambience - 0.35) <= 0.03,
    `supplied MP3 ambience stem should be 0.35 ±0.03, got ${mix.ambience}; layers=${JSON.stringify(mix)}`,
  );
  assert(
    mix.ambienceDuration !== null && Math.abs(mix.ambienceDuration - 213.12) <= 0.1,
    `supplied MP3 ambience did not decode to 213.12s; got ${mix.ambienceDuration}; layers=${JSON.stringify(mix)}`,
  );
  assert(mix.mapTension >= 0.99, `sync did not detect the pre-existing war/enemy fleet; mapTension=${mix.mapTension}`);
  const titleMix = await page(`window.__titleMix ?? null`);
  assert(titleMix?.screen === 'title' && titleMix.layers?.includes('ambience') && titleMix.layers?.includes('main'),
    `title music must carry MP3 ambience + main stems; got ${JSON.stringify(titleMix)}`);
  assert(titleMix.ambience !== null && Math.abs(titleMix.ambience - 0.35) <= 0.03,
    `title MP3 ambience stem should be 0.35 ±0.03, got ${titleMix.ambience}`);
  assert(mix.screen === 'map' && mix.key !== 'title', 'title group must be replaced by the map group (no double playback)');
  console.log(`PASS title-music: layers=${titleMix.layers.join('/')} ambience=${fmt(titleMix.ambience)} main=${fmt(titleMix.main)} musicBus=${fmt(titleMix.musicBus)} master=${fmt(titleMix.master)} -> map key=${mix.key} (single group)`);
  console.log(
    `PASS initial-tension-mix: war ${setup.warKey}, enemy fleet ${setup.enemyFleet} in system ${setup.ownSystem}, ` +
      `layers base=${fmt(mix.base)} ambience=${fmt(mix.ambience)}(${fmt(mix.ambienceDuration)}s) tension=${fmt(mix.tension)} perc=${fmt(mix.perc)}, mapTension=${fmt(mix.mapTension)}`,
  );
}

async function cycleLogCues() {
  currentCase = 'cycle-log-cues';
  const cycle = await pageAsync(`
    const pax = window.__pax;
    const audio = pax.audio;
    const game = pax.game;
    const saved = window.__audioSmokeState;
    if (!game) throw new Error('no active game for the cycle log test');
    if (saved?.warKey) game.states[saved.warKey] = 'peace';
    const enemyFleet = game.fleets.find((fleet) => fleet.id === saved?.enemyFleetId);
    if (enemyFleet && typeof saved?.oldSystem === 'number') enemyFleet.system = saved.oldSystem;
    for (const key of Object.keys(game.states)) {
      if (key.split('|').includes(game.player)) game.states[key] = 'peace';
    }
    const planets = game.systems.flatMap((system) => system.planets);
    const capital = game.empires[game.player].capital;
    const planet = planets.find((candidate) => candidate.id === capital && candidate.owner === game.player)
      ?? planets.find((candidate) => candidate.owner === game.player);
    if (!planet) throw new Error('player owns no planet for the cycle log test');
    const mineBefore = planet.buildings.mine;
    const knownLogs = new Set(game.log.map((entry) => entry.text));
    const cycleBefore = game.cycle;
    planet.queue = { kind: 'building', id: 'mine' };
    planet.progress = 99;
    window.__audioSmoke.calls.length = 0;
    window.__audioSmoke.rates.length = 0;
    await pax.handleEndCycle();
    await new Promise((resolve) => setTimeout(resolve, 140));
    const fresh = game.log.filter((entry) => !knownLogs.has(entry.text));
    const completion = fresh.find(
      (entry) => entry.kind === 'good' && entry.text.includes(planet.name) && entry.text.includes('fertiggestellt'),
    );
    return {
      cycleBefore,
      cycleAfter: game.cycle,
      planet: planet.name,
      mineBefore,
      mineAfter: planet.buildings.mine,
      queue: planet.queue,
      completion: completion?.text ?? null,
      freshLogs: fresh.slice(-6),
      cues: window.__audioSmoke.calls.map((entry) => entry.cue),
      victory: game.victory,
    };
  `);

  assert(
    cycle.mineAfter === cycle.mineBefore + 1 && cycle.queue === null,
    `cycle setup did not complete the mine on ${cycle.planet}: count ${cycle.mineBefore}->${cycle.mineAfter}, queue=${JSON.stringify(cycle.queue)}`,
  );
  assert(
    cycle.completion,
    `cycle log lacked a "fertiggestellt" entry for ${cycle.planet}; fresh logs: ${JSON.stringify(cycle.freshLogs)}`,
  );
  assert(
    cycle.cues.includes('build_complete'),
    `cycle-log completion did not play build_complete; cues were ${JSON.stringify(cycle.cues)}`,
  );
  assert(
    cycle.cues.includes('cycle_sweep') && cycle.cues.includes('cycle_stamp'),
    `cycle cues missing; expected cycle_sweep and cycle_stamp, got ${JSON.stringify(cycle.cues)}`,
  );
  console.log(
    `PASS cycle-log-cues: ${cycle.planet} mine ${cycle.mineBefore}->${cycle.mineAfter}, ` +
      `cycle ${cycle.cycleBefore}->${cycle.cycleAfter}, cues ${cycle.cues.join('/')}`,
  );
}

async function researchLogCues() {
  currentCase = 'research-log-cues';
  const cycle = await pageAsync(`
    const pax = window.__pax;
    const game = pax.game;
    if (!game) throw new Error('no active game for the research log test');
    for (const key of Object.keys(game.states)) game.states[key] = 'peace';
    const planets = game.systems.flatMap((system) => system.planets);
    for (const planet of planets) {
      planet.queue = null;
      planet.progress = 0;
    }
    // Keep AI colony ships from adding an unrelated build_complete cue.
    for (const fleet of game.fleets) {
      fleet.ships.ark = 0;
      fleet.hp.ark = 0;
    }
    const capitalPlanet = planets.find(
      (planet) => planet.id === game.empires[game.player].capital && planet.owner === game.player,
    ) ?? planets.find((planet) => planet.owner === game.player);
    if (!capitalPlanet) throw new Error('player owns no planet for the research log test');
    // Make the research income deterministic without touching the audio path.
    capitalPlanet.buildings.lab = Math.max(2, Number(capitalPlanet.buildings.lab) || 0);
    const empire = game.empires[game.player];
    for (const branch of Object.keys(empire.active)) empire.active[branch] = null;
    const branch = 'civic';
    const techId = 'civic1';
    empire.active[branch] = techId;
    empire.progress[branch] = 1e9;
    const techsBefore = empire.techs.length;
    const cycleBefore = game.cycle;
    const knownLogs = new Set(game.log.map((entry) => entry.text));
    window.__audioSmoke.calls.length = 0;
    window.__audioSmoke.rates.length = 0;
    await pax.handleEndCycle();
    await new Promise((resolve) => setTimeout(resolve, 160));
    const fresh = game.log.filter((entry) => !knownLogs.has(entry.text));
    const scienceLog = fresh.find((entry) => entry.kind === 'science' && entry.text.includes('schließt'));
    return {
      branch,
      techId,
      techsBefore,
      techsAfter: empire.techs.length,
      activeAfter: empire.active[branch],
      cycleBefore,
      cycleAfter: game.cycle,
      scienceLog: scienceLog?.text ?? null,
      scienceLogs: fresh.filter((entry) => entry.kind === 'science').map((entry) => entry.text),
      cues: window.__audioSmoke.calls.map((entry) => entry.cue),
      victory: game.victory,
    };
  `);
  const def = await page(`(() => {
    const entry = window.__pax.audio.manifest?.sfx?.research_complete;
    return entry ? { bus: entry.bus, files: entry.files } : null;
  })()`);

  assert(
    cycle.scienceLog,
    `research-log-cues: no science log was produced; tech ${cycle.techId} did not complete (techs ${cycle.techsBefore}->${cycle.techsAfter}, active=${cycle.activeAfter}); science logs: ${JSON.stringify(cycle.scienceLogs)}`,
  );
  assert(
    cycle.techsAfter > cycle.techsBefore,
    `research-log-cues: science log appeared without a completed tech; techs ${cycle.techsBefore}->${cycle.techsAfter}`,
  );
  assert(
    def?.bus === 'sfx' && def.files?.some((file) => file.includes('research_complete')),
    `research-log-cues: expected research_complete in cue group sfx (sfx/research_complete.wav), got ${JSON.stringify(def)}`,
  );
  assert(
    cycle.cues.includes('research_complete'),
    `research-log-cues: research completion ${JSON.stringify(cycle.scienceLog)} did not trigger research_complete; expected research_complete in group sfx (sfx/research_complete.wav); observed cues ${JSON.stringify(cycle.cues)}`,
  );
  assert(
    !cycle.cues.includes('diplo_war'),
    `research-log-cues: research completion incorrectly played the war cue diplo_war; observed cues ${JSON.stringify(cycle.cues)}`,
  );
  assert(
    !cycle.cues.includes('build_complete'),
    `research-log-cues: research completion incorrectly played build_complete; observed cues ${JSON.stringify(cycle.cues)}`,
  );
  assert(
    !cycle.cues.includes('ui_click'),
    `research-log-cues: research completion incorrectly played the generic ui_click; observed cues ${JSON.stringify(cycle.cues)}`,
  );
  console.log(
    `PASS research-log-cues: ${cycle.techId} completed (techs ${cycle.techsBefore}->${cycle.techsAfter}), ` +
      `cycle ${cycle.cycleBefore}->${cycle.cycleAfter}, cues ${cycle.cues.join('/')}`,
  );
}

async function warLogCues() {
  currentCase = 'war-log-cues';
  const cycle = await pageAsync(`
    const pax = window.__pax;
    const game = pax.game;
    if (!game) throw new Error('no active game for the war log test');
    const ids = Object.keys(game.empires).filter((id) => id !== game.player && game.empires[id].alive);
    const systemsOf = (id) => game.systems.filter((system) => system.owner === id).length;
    const fleetsOf = (id) => game.fleets.filter((fleet) => fleet.owner === id).length;
    let pair = null;
    for (const aggressor of ids) {
      for (const target of ids) {
        if (aggressor === target || systemsOf(target) <= 0) continue;
        if (systemsOf(aggressor) + fleetsOf(aggressor) > systemsOf(target) * 1.25) {
          pair = { aggressor, target };
          break;
        }
      }
      if (pair) break;
    }
    if (!pair) {
      throw new Error('no AI aggressor/target pair satisfies the deterministic war setup');
    }
    for (const key of Object.keys(game.states)) game.states[key] = 'peace';
    for (const key of Object.keys(game.relations)) game.relations[key] = 0;
    const relationKey = [pair.aggressor, pair.target].sort().join('|');
    game.relations[relationKey] = -80;
    const cycleBefore = 22;
    game.cycle = cycleBefore;
    // Keep every empire out of research completion so this cycle can only
    // produce the war-log cue under test, not a research cue by accident.
    const highTech = 'civic12';
    for (const empire of Object.values(game.empires)) {
      for (const branch of Object.keys(empire.active)) {
        empire.active[branch] = highTech;
        empire.progress[branch] = -1e9;
      }
    }
    for (const planet of game.systems.flatMap((system) => system.planets)) {
      planet.queue = null;
      planet.progress = 0;
    }
    // Keep AI colony ships from adding an unrelated build_complete cue.
    for (const fleet of game.fleets) {
      fleet.ships.ark = 0;
      fleet.hp.ark = 0;
    }
    const knownLogs = new Set(game.log.map((entry) => entry.text));
    window.__audioSmoke.calls.length = 0;
    window.__audioSmoke.rates.length = 0;
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    try {
      await pax.handleEndCycle();
    } finally {
      Math.random = originalRandom;
    }
    await new Promise((resolve) => setTimeout(resolve, 160));
    const fresh = game.log.filter((entry) => !knownLogs.has(entry.text));
    const warLog = fresh.find((entry) => entry.kind === 'war' && entry.text.includes('erklärt'));
    return {
      pair,
      relationKey,
      cycleBefore,
      cycleAfter: game.cycle,
      warLog: warLog?.text ?? null,
      warLogs: fresh.filter((entry) => entry.kind === 'war').map((entry) => entry.text),
      calls: window.__audioSmoke.calls.map((entry) => entry.cue),
      victory: game.victory,
    };
  `);
  const def = await page(`(() => {
    const entry = window.__pax.audio.manifest?.sfx?.diplo_war;
    return entry ? { bus: entry.bus, files: entry.files } : null;
  })()`);

  assert(
    cycle.warLog,
    `war-log-cues: no AI war declaration log was produced for ${cycle.pair.aggressor} -> ${cycle.pair.target}; observed war logs ${JSON.stringify(cycle.warLogs)}`,
  );
  assert(
    def?.bus === 'sfx' && def.files?.some((file) => file.includes('diplo_war')),
    `war-log-cues: expected diplo_war in cue group sfx (sfx/diplo_war.wav), got ${JSON.stringify(def)}`,
  );
  assert(
    cycle.calls.includes('diplo_war'),
    `war-log-cues: war log ${JSON.stringify(cycle.warLog)} did not trigger diplo_war; expected diplo_war in group sfx (sfx/diplo_war.wav); observed cues ${JSON.stringify(cycle.calls)}`,
  );
  assert(
    !cycle.calls.includes('research_complete'),
    `war-log-cues: war log incorrectly played the research cue research_complete; observed cues ${JSON.stringify(cycle.calls)}`,
  );
  assert(
    !cycle.calls.includes('build_complete'),
    `war-log-cues: war log incorrectly played build_complete; observed cues ${JSON.stringify(cycle.calls)}`,
  );
  assert(
    !cycle.calls.includes('ui_click'),
    `war-log-cues: war log incorrectly played the generic ui_click; observed cues ${JSON.stringify(cycle.calls)}`,
  );
  console.log(
    `PASS war-log-cues: ${cycle.warLog}, cues ${cycle.calls.join('/')}`,
  );
}

async function runBattleCinematic(outcome) {
  const setup = await pageAsync(`
    const pax = window.__pax;
    const game = pax.game;
    if (!game) throw new Error('no active game for battle cinematic test');
    const player = game.player;
    const playerFleet = game.fleets.find((fleet) => fleet.owner === player);
    if (!playerFleet) throw new Error('player has no fleet for battle cinematic test');
    const enemyFleet = game.fleets.find(
      (fleet) => fleet.owner !== player && game.empires[fleet.owner]?.alive,
    );
    if (!enemyFleet) throw new Error('no AI fleet available for battle cinematic test');
    const shipClasses = pax.shipClasses;
    if (!Array.isArray(shipClasses) || shipClasses.length !== Object.keys(playerFleet.ships).length) {
      throw new Error('ship class metadata is unavailable for battle cinematic test');
    }
    const allClasses = shipClasses.map((entry) => entry.id);
    // Custom designs intentionally share their base GLB hull; uniqueness is
    // enforced through the per-class visual signature in BattleView, not
    // through distinct GLB files.
    const hullFor = Object.fromEntries(shipClasses.map((entry) => [entry.id, entry.hull]));
    const capitalPlanetId = game.empires[player].capital;
    const capitalSystem = game.systems.find((system) =>
      system.planets.some((planet) => planet.id === capitalPlanetId),
    );
    const capitalSystemId = capitalSystem ? capitalSystem.id : null;
    const target =
      game.systems.find(
        (system) => system.id !== capitalSystemId && system.planets.every((planet) => planet.owner === null),
      ) ?? game.systems.find((system) => system.owner === player && system.id !== capitalSystemId);
    if (!target) throw new Error('no target system available for battle cinematic test');
    // Keep the battle in an unowned frontier system when possible. This avoids
    // a loss in the fixture capturing the player's only colony.
    target.owner = player;

    const zeroFleet = (fleet) => {
      for (const cls of Object.keys(fleet.ships)) {
        fleet.ships[cls] = 0;
        fleet.hp[cls] = 0;
      }
      fleet.path = [];
      fleet.step = 0;
      fleet.wait = 0;
    };
    for (const fleet of game.fleets) {
      if (fleet !== playerFleet && fleet !== enemyFleet && fleet.system === target.id) {
        zeroFleet(fleet);
      }
    }
    const setSquad = (fleet, classes) => {
      zeroFleet(fleet);
      fleet.system = target.id;
      fleet.path = [target.id];
      fleet.step = 0;
      fleet.wait = 1;
      for (const cls of classes) {
        const hull = hullFor[cls];
        if (!Number.isFinite(hull)) throw new Error('missing hull data for ship class ' + cls);
        fleet.ships[cls] = 1;
        fleet.hp[cls] = hull;
      }
    };
    const wanted = ${JSON.stringify(outcome)};
    if (wanted === 'win') {
      // All 13 classes render on the player's side; the enemy uses the
      // previously omitted battleship itself, not a visual fallback.
      setSquad(playerFleet, allClasses);
      setSquad(enemyFleet, ['battleship']);
    } else {
      // The frigate drives the losing side while the enemy renders all 13
      // classes, so both previously omitted classes are exercised visually.
      setSquad(playerFleet, ['frigate']);
      setSquad(enemyFleet, allClasses);
    }
    for (const fleet of game.fleets) {
      if (fleet === playerFleet || fleet === enemyFleet) continue;
      fleet.ships.ark = 0;
      fleet.hp.ark = 0;
    }
    for (const key of Object.keys(game.states)) game.states[key] = 'peace';
    for (const key of Object.keys(game.relations)) game.relations[key] = 0;
    const warKey = [player, enemyFleet.owner].sort().join('|');
    game.states[warKey] = 'war';
    game.relations[warKey] = -80;
    game.cycle = 4;
    game.victory = null;
    // No science, build or ark events may add unrelated cues to this battle.
    const highTech = 'civic12';
    for (const empire of Object.values(game.empires)) {
      for (const branch of Object.keys(empire.active)) {
        empire.active[branch] = highTech;
        empire.progress[branch] = -1e9;
      }
    }
    for (const planet of game.systems.flatMap((system) => system.planets)) {
      planet.queue = null;
      planet.progress = 0;
      planet.siege = 0;
    }
    const knownLogs = new Set(game.log.map((entry) => entry.text));
    window.__audioSmoke.calls.length = 0;
    window.__audioSmoke.rates.length = 0;
    window.__battleRun = { done: false, error: null, knownLogs };
    const cyclePromise = pax.handleEndCycle();
    cyclePromise.then(
      () => {
        window.__battleRun.done = true;
      },
      (error) => {
        window.__battleRun.error = error instanceof Error ? error.message : String(error);
        window.__battleRun.done = true;
      },
    );
    return {
      outcome: wanted,
      player,
      enemy: enemyFleet.owner,
      target: target.name,
      targetId: target.id,
      playerFleet: playerFleet.id,
      enemyFleet: enemyFleet.id,
      playerShips: Object.assign({}, playerFleet.ships),
      enemyShips: Object.assign({}, enemyFleet.ships),
      allClasses,
    };
  `);

  await waitFor(
    'battle result button (' + outcome + ')',
    `(() => {
      const el = document.querySelector('.battle-result [data-act="battle-continue"]');
      return !!el && el.getBoundingClientRect().width > 0;
    })()`,
    20_000,
  );
  // Activate the real result button through its click handler. A pointer
  // gesture would also trigger the app's generic pointerdown ui_click, which
  // this case explicitly needs to keep out of the measured battle cues.
  const clicked = await page(`(() => {
    const el = document.querySelector('.battle-result [data-act="battle-continue"]');
    if (!el) return false;
    el.click();
    return true;
  })()`);
  assert(clicked, `battle-cinematic-cues: result button for the ${outcome} battle disappeared before activation`);
  await waitFor('battle cycle completion (' + outcome + ')', `window.__battleRun?.done === true`, 10_000);

  const run = await page(`(() => {
    const state = window.__battleRun;
    return {
      done: state.done,
      error: state.error,
      cues: window.__audioSmoke.calls.map((entry) => entry.cue),
      rates: window.__audioSmoke.rates.map((entry) => entry.rate),
      signatures: window.__pax.battleSignatures ?? null,
      freshLogs: window.__pax.game.log
        .filter((entry) => !state.knownLogs.has(entry.text))
        .slice(-8),
      visual: (() => {
        const root = document.querySelector('.battle-overlay');
        const markers = root
          ? [...root.querySelectorAll('.battle-visual-registry [data-ship-class]')]
          : [];
        return {
          classes: [...new Set(markers.map((el) => el.dataset.shipClass).filter(Boolean))],
          groups: markers.length,
          signatures: [...new Set(markers.map((el) => el.dataset.shipSignature).filter(Boolean))],
          signatureByClass: Object.fromEntries(
            markers
              .map((el) => [el.dataset.shipClass, el.dataset.shipSignature])
              .filter(([cls, signature]) => cls && signature),
          ),
          signatureAttribute: root?.dataset.shipSignatures ?? null,
          attribute: root?.dataset.shipClasses ?? null,
          attributeGroups: root?.dataset.shipGroups ?? null,
        };
      })(),
    };
  })()`);
  assert(!run.error, `battle-cinematic-cues: ${outcome} cycle rejected: ${run.error}`);
  return { ...setup, ...run };
}

async function battleCinematicCues() {
  currentCase = 'battle-cinematic-cues';
  await installAudioProbe();
  // The app intentionally pauses its render loop while document.hidden. A
  // zero-opacity, non-activating window makes Chromium treat the page as
  // visible so requestAnimationFrame advances the cinematic, without showing
  // a window to the user.
  win.setOpacity(0);
  win.showInactive();
  await waitFor(
    'battle cinematic viewport visibility',
    `document.hidden === false && document.visibilityState === 'visible'`,
    5_000,
  );

  try {
    const winRun = await runBattleCinematic('win');
    const lossRun = await runBattleCinematic('loss');
    const runs = [winRun, lossRun];
    const expectedClasses = winRun.allClasses;
    for (const run of runs) {
      const visual = run.visual;
      assert(
        visual.groups >= expectedClasses.length,
        `battle-cinematic-cues: ${run.outcome} battle rendered only ${visual.groups} visual markers; expected at least ${expectedClasses.length}`,
      );
      assert(
        visual.classes.length === expectedClasses.length,
        `battle-cinematic-cues: ${run.outcome} battle rendered ${visual.classes.length}/${expectedClasses.length} distinct ship classes; expected ${JSON.stringify(expectedClasses)}, observed ${JSON.stringify(visual.classes)}`,
      );
      for (const cls of expectedClasses) {
        assert(
          visual.classes.includes(cls),
          `battle-cinematic-cues: ${run.outcome} battle did not render ship class ${cls} in the BattleView DOM; expected all ${expectedClasses.length} classes ${JSON.stringify(expectedClasses)}, observed ${JSON.stringify(visual.classes)} (markers=${visual.groups})`,
        );
      }
      for (const cls of ['battleship', 'frigate']) {
        assert(
          visual.classes.includes(cls),
          `battle-cinematic-cues: ${run.outcome} battle omitted the previously missing ${cls} class; observed ${JSON.stringify(visual.classes)}`,
        );
      }      assert(
        visual.attribute?.split(' ').length === expectedClasses.length,
        `battle-cinematic-cues: ${run.outcome} battle data-ship-classes does not list all classes; got ${JSON.stringify(visual.attribute)}`,
      );
      const signatures = run.signatures;
      assert(
        signatures && Object.keys(signatures).length === expectedClasses.length,
        `battle-cinematic-cues: ${run.outcome} battle exposed ${signatures ? Object.keys(signatures).length : 0} signatures; expected ${expectedClasses.length}: ${JSON.stringify(signatures)}`,
      );
      const signatureEntries = Object.entries(signatures);
      const signatureOwner = new Map();
      const signatureCollisions = [];
      for (const [cls, signature] of signatureEntries) {
        if (signatureOwner.has(signature)) {
          signatureCollisions.push([signatureOwner.get(signature), cls, signature]);
        } else {
          signatureOwner.set(signature, cls);
        }
      }
      assert(
        signatureCollisions.length === 0,
        `battle-cinematic-cues: ${run.outcome} battle visual signatures collapsed: ${JSON.stringify(signatureCollisions)}; mapping ${JSON.stringify(signatures)}`,
      );
      assert(
        visual.signatures.length === expectedClasses.length,
        `battle-cinematic-cues: ${run.outcome} battle DOM exposed ${visual.signatures.length}/${expectedClasses.length} distinct visual signatures; expected ${JSON.stringify(Object.values(signatures))}, observed ${JSON.stringify(visual.signatures)}`,
      );
      for (const cls of expectedClasses) {
        assert(
          signatures[cls] && visual.signatureByClass[cls] === signatures[cls],
          `battle-cinematic-cues: ${run.outcome} battle signature for ${cls} is missing or differs in the DOM; app=${JSON.stringify(signatures[cls])}, DOM=${JSON.stringify(visual.signatureByClass[cls])}`,
        );
      }
      assert(
        visual.signatureAttribute?.split(',').length === expectedClasses.length,
        `battle-cinematic-cues: ${run.outcome} battle data-ship-signatures does not list all signatures; got ${JSON.stringify(visual.signatureAttribute)}`,
      );
    }

    const defs = await page(`(() => {
      const sfx = window.__pax.audio.manifest?.sfx ?? {};
      const out = {};
      for (const key of Object.keys(sfx)) {
        if (
          key === 'battle_alarm' ||
          key.startsWith('weapon_') ||
          key.startsWith('impact_') ||
          key === 'ui_confirm' ||
          key === 'battle_retreat'
        ) {
          out[key] = { bus: sfx[key].bus, files: sfx[key].files };
        }
      }
      return out;
    })()`);

    for (const run of runs) {
      const cues = run.cues;
      const label = run.outcome;
      assert(
        cues.filter((cue) => cue === 'battle_alarm').length === 1,
        `battle-cinematic-cues: ${label} battle expected exactly one battle_alarm in group sfx (sfx/battle_alarm.wav); observed cues ${JSON.stringify(cues)}`,
      );
      const alarmDef = defs.battle_alarm;
      assert(
        alarmDef?.bus === 'sfx' && alarmDef.files?.some((file) => file.includes('battle_alarm')),
        `battle-cinematic-cues: expected battle_alarm in group sfx (sfx/battle_alarm.wav), got ${JSON.stringify(alarmDef)}`,
      );

      const weapons = [...new Set(cues.filter((cue) => cue.startsWith('weapon_')))];
      assert(
        weapons.length > 0,
        `battle-cinematic-cues: ${label} battle did not trigger any weapon cue; expected at least one of weapon_pulse/weapon_kinetic/weapon_missile in group sfx; observed cues ${JSON.stringify(cues)}`,
      );
      for (const cue of weapons) {
        const def = defs[cue];
        assert(
          def?.bus === 'sfx' && def.files?.some((file) => file.includes('weapon_')),
          `battle-cinematic-cues: ${label} battle expected ${cue} in group sfx, got ${JSON.stringify(def)}`,
        );
      }

      const impacts = [...new Set(cues.filter((cue) => cue.startsWith('impact_')))];
      assert(
        impacts.length > 0,
        `battle-cinematic-cues: ${label} battle did not trigger any impact cue; expected impact_shield/impact_hull in group sfx; observed cues ${JSON.stringify(cues)}`,
      );
      for (const cue of impacts) {
        const def = defs[cue];
        assert(
          def?.bus === 'sfx' && def.files?.some((file) => file.includes('impact_')),
          `battle-cinematic-cues: ${label} battle expected ${cue} in group sfx, got ${JSON.stringify(def)}`,
        );
      }

      const expectedResult = label === 'win' ? 'ui_confirm' : 'battle_retreat';
      const wrongResult = label === 'win' ? 'battle_retreat' : 'ui_confirm';
      assert(
        cues.filter((cue) => cue === expectedResult).length === 1,
        `battle-cinematic-cues: ${label} battle expected exactly one ${expectedResult} in ${expectedResult === 'ui_confirm' ? 'group ui (sfx/ui_confirm.wav)' : 'group sfx (sfx/battle_retreat.wav)'}; observed cues ${JSON.stringify(cues)}`,
      );
      assert(
        !cues.includes(wrongResult),
        `battle-cinematic-cues: ${label} battle incorrectly played ${wrongResult}; observed cues ${JSON.stringify(cues)}`,
      );
      const resultDef = defs[expectedResult];
      const resultBus = expectedResult === 'ui_confirm' ? 'ui' : 'sfx';
      assert(
        resultDef?.bus === resultBus && resultDef.files?.some((file) => file.includes(expectedResult)),
        `battle-cinematic-cues: expected ${expectedResult} in group ${resultBus}, got ${JSON.stringify(resultDef)}`,
      );

      for (const wrong of ['ui_click', 'research_complete', 'build_complete']) {
        assert(
          !cues.includes(wrong),
          `battle-cinematic-cues: ${label} battle incorrectly played ${wrong}; observed cues ${JSON.stringify(cues)}`,
        );
      }
    }

    const winWeapons = [...new Set(winRun.cues.filter((cue) => cue.startsWith('weapon_')))].join('/');
    const lossWeapons = [...new Set(lossRun.cues.filter((cue) => cue.startsWith('weapon_')))].join('/');
    const winImpacts = [...new Set(winRun.cues.filter((cue) => cue.startsWith('impact_')))].join('/');
    const lossImpacts = [...new Set(lossRun.cues.filter((cue) => cue.startsWith('impact_')))].join('/');
    console.log(
      `PASS battle-cinematic-cues: win(${winRun.cues.filter((cue) => ['battle_alarm'].includes(cue) || cue.startsWith('weapon_') || cue.startsWith('impact_') || cue === 'ui_confirm').join('/')}) ` +
        `loss(${lossRun.cues.filter((cue) => ['battle_alarm'].includes(cue) || cue.startsWith('weapon_') || cue.startsWith('impact_') || cue === 'battle_retreat').join('/')}) ` +
        `visuals ${winRun.visual.classes.length}/${winRun.allClasses.length} (battleship+frigate), ` +
        `signatures ${new Set(Object.values(winRun.signatures)).size}/${winRun.allClasses.length} unique, ` +
        `weapons ${winWeapons}|${lossWeapons}, impacts ${winImpacts}|${lossImpacts}, ui_click=0`,
    );
  } finally {
    if (win) {
      win.hide();
      win.setOpacity(1);
      await sleep(120);
    }
  }
}

async function explosionDucking() {
  currentCase = 'explosion-duck-recovery';
  await waitFor(
    'music bus recovery before explosion test',
    `window.__pax.audio.group?.screen === 'map' &&
     window.__pax.audio.ctx?.state === 'running' &&
     window.__pax.audio.musicDuck.gain.value >= 0.98`,
    8_000,
  );
  const before = await page(`(() => {
    const audio = window.__pax.audio;
    return {
      gain: audio.musicDuck.gain.value,
      screen: audio.group?.screen ?? null,
      context: audio.ctx?.state ?? null,
    };
  })()`);
  assert(
    before.gain >= 0.98,
    `music bus did not settle at 1.0 before the explosion; gain=${fmt(before.gain)}`,
  );
  await page(`(() => {
    window.__audioSmoke.calls.length = 0;
    window.__pax.audio.battleExplosion('large', 0.15);
    return true;
  })()`);
  await sleep(180);
  const during = await page(`(() => ({
    gain: window.__pax.audio.musicDuck.gain.value,
    cues: window.__audioSmoke.calls.map((entry) => entry.cue),
    context: window.__pax.audio.ctx?.state ?? null,
  }))()`);
  await sleep(1_250);
  const after = await page(`(() => ({
    gain: window.__pax.audio.musicDuck.gain.value,
    screen: window.__pax.audio.group?.screen ?? null,
    context: window.__pax.audio.ctx?.state ?? null,
  }))()`);

  assert(
    during.cues.includes('explosion_large'),
    `large explosion did not play its explosion_large cue; cues were ${JSON.stringify(during.cues)}`,
  );
  assert(
    during.context === 'running' && after.context === 'running',
    `AudioContext was not running during the duck test (${during.context} -> ${after.context})`,
  );
  assert(
    during.gain <= 0.55 && during.gain >= 0.25,
    `large explosion did not audibly duck the music bus; expected ~0.38 after 180ms, got ${fmt(during.gain)}`,
  );
  assert(
    after.gain >= 0.98 && Math.abs(after.gain - before.gain) <= 0.03,
    `music bus did not recover to its pre-explosion level; before=${fmt(before.gain)}, after=${fmt(after.gain)}`,
  );
  assert(after.screen === 'map', `music screen changed during explosion test; now ${after.screen}`);
  console.log(
    `PASS explosion-duck-recovery: musicDuck ${fmt(before.gain)} -> ${fmt(during.gain)} at 180ms -> ${fmt(after.gain)} after recovery`,
  );
}

async function verifyAudioNetwork() {
  currentCase = 'audio-network';
  await sleep(250);
  const failed = [...audioRequests.entries()].filter(([, status]) => status < 200 || status >= 300);
  assert(
    failed.length === 0,
    `audio requests failed: ${failed.map(([url, status]) => `${status} ${url}`).join(', ')}`,
  );
  assert(
    audioFailures.size === 0,
    `audio request errors: ${[...audioFailures.entries()].map(([url, error]) => `${error} ${url}`).join(', ')}`,
  );
  const urls = [...audioRequests.keys()];
  for (const suffix of [
    '/audio/manifest.json',
    '/audio/sfx/swatch.wav',
    '/audio/sfx/crest.wav',
    '/audio/sfx/apply.wav',
    '/audio/sfx/build_complete.wav',
    '/audio/sfx/research_complete.wav',
    '/audio/sfx/diplo_war.wav',
    '/audio/sfx/battle_alarm.wav',
    '/audio/sfx/weapon_',
    '/audio/sfx/impact_',
    '/audio/sfx/ui_confirm.wav',
    '/audio/sfx/battle_retreat.wav',
    '/audio/sfx/explosion_large_',
    '-tension.ogg',
    '-perc.ogg',
  ]) {
    assert(
      urls.some((url) => url.includes(suffix)),
      `audio asset was never requested by the running game: ${suffix}`,
    );
  }
  const consoleErrors = consoleMessages.filter((entry) => entry.level === 'error');
  assert(
    consoleErrors.length === 0,
    `renderer console has errors: ${consoleErrors.map((entry) => entry.message).join(' | ')}`,
  );
  console.log(
    `PASS audio-network: ${urls.length} audio requests, all HTTP 2xx; renderer console has no errors`,
  );
}

async function run() {
  watchdog = setTimeout(() => {
    finish(1, new Error(`hard timeout after 90s; current case: ${currentCase}`));
  }, 90_000);
  watchdog.unref?.();

  win = new BrowserWindow({
    width: 1280,
    height: 1400,
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
    if (level >= 2) {
      const entry = { level: level >= 3 ? 'error' : 'warning', message };
      consoleMessages.push(entry);
      console.log(`[renderer ${entry.level}] ${message}`);
    }
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    finish(1, new Error(`renderer process gone: ${details.reason}`));
  });
  win.webContents.session.webRequest.onCompleted({ urls: ['*://*/*'] }, (details) => {
    if (details.url.includes('/audio/')) audioRequests.set(details.url, details.statusCode);
  });
  win.webContents.session.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, (details) => {
    if (details.url.includes('/audio/')) audioFailures.set(details.url, details.error);
  });

  await win.loadURL(target);
  await waitFor(
    'game boot',
    `window.__pax &&
     document.querySelector('[data-act="start"]') &&
     document.querySelector('button.ie-swatch')`,
    20_000,
  );
  const viewport = await page('({ width: innerWidth, height: innerHeight })');
  console.log(`[audio-smoke] Electron content viewport: ${viewport.width}x${viewport.height}`);

  await unlockAndWaitForAudio();
  await identityCues();
  await initialTensionMix();
  await cycleLogCues();
  await researchLogCues();
  await warLogCues();
  await battleCinematicCues();
  await explosionDucking();
  await verifyAudioNetwork();

  currentCase = 'complete';
  console.log('PASS audio-smoke: all seven real-browser audio cases passed');
  finish(0);
}

app
  .whenReady()
  .then(run)
  .catch((error) => finish(1, error));
