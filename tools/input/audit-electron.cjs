'use strict';

/**
 * Real-Electron UI audit for the empire editor.
 *
 * 1. Emulates 1280x720, 1920x1080 and a short 1024x420 content viewport.
 * 2. Captures the title editor and the in-game identity dialog at three scroll
 *    positions per surface.
 * 3. Checks every interactive control for clipping, occlusion, overlap and
 *    horizontal overflow.
 * 4. Sets every editor field, destroys the renderer, opens a fresh window and
 *    verifies localStorage plus the campaign's profile, fleet and modifiers.
 */

const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const target = process.env.PAX_SMOKE_URL;
if (!target) {
  console.error('FAIL [setup] PAX_SMOKE_URL is missing');
  process.exit(1);
}

const root = process.cwd();
const outDir = join(root, 'art', 'ui-audit');
mkdirSync(outDir, { recursive: true });

const profileDir = mkdtempSync(join(tmpdir(), 'pax-aeterna-ui-audit-'));
app.setPath('userData', profileDir);
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

const SIZES = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1024x420', width: 1024, height: 420 },
];

const IDENTITY_KEY = 'pax-aeterna-identity';
const CHOSEN = {
  name: 'Aeterna Pruefreich',
  motto: 'Der Bund ueberlebt.',
  shipClass: 'destroyer',
  traits: ['psionic', 'artificers'],
  government: 'technocracy',
  worldview: 'militarist',
  religion: 'machine',
  primary: '#62d2c4',
  secondary: '#2c2740',
  accent: '#d8c7ff',
  crest: 4,
  pattern: 2,
  style: 'sacral',
  tech: 'void',
};

let win = null;
let finished = false;
let currentCase = 'setup';
let watchdog = null;
let debuggerAttached = false;
let activeViewport = null;
const consoleErrors = [];
const layoutIssues = [];
const report = { sizes: [], persistence: null };

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
  try {
    if (debuggerAttached) win?.webContents.debugger.detach();
  } catch {
    /* window may already be gone */
  }
  debuggerAttached = false;
  try {
    win?.destroy();
    win = null;
  } catch {
    /* window already gone */
  }
  try {
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  } catch {
    /* report is best effort */
  }
  setTimeout(() => {
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* disposable Chromium profile */
    }
    process.exitCode = code;
    process.exit(code);
  }, 150);
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

async function waitFor(label, expression, timeoutMs = 12_000) {
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

async function ensureDebugger() {
  if (!debuggerAttached) {
    win.webContents.debugger.attach('1.3');
    debuggerAttached = true;
    await win.webContents.debugger.sendCommand('Page.enable');
  }
}

async function send(command, params = {}) {
  await ensureDebugger();
  return win.webContents.debugger.sendCommand(command, params);
}

async function setViewport(width, height) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  });
  await sleep(220);
  const viewport = await page('({ width: innerWidth, height: innerHeight })');
  assert(
    viewport.width === width && viewport.height === height,
    `emulated viewport is ${viewport.width}x${viewport.height}, expected ${width}x${height}`,
  );
  activeViewport = { width, height };
}

async function shot(name) {
  const viewport = await page('({ width: innerWidth, height: innerHeight })');
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const file = join(outDir, `${name}.png`);
  const buffer = Buffer.from(result.data, 'base64');
  writeFileSync(file, buffer);
  const pngWidth = buffer.readUInt32BE(16);
  const pngHeight = buffer.readUInt32BE(20);
  assert(
    pngWidth === viewport.width && pngHeight === viewport.height,
    `screenshot ${name} is ${pngWidth}x${pngHeight}, expected ${viewport.width}x${viewport.height}`,
  );
  console.log(`[ui-audit] shot ${name} (${pngWidth}x${pngHeight})`);
}

async function click(selector, fractionX = 0.5, fractionY = 0.5) {
  const quoted = JSON.stringify(selector);
  const rect = await page(`(() => {
    const el = document.querySelector(${quoted});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
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
    `UI target ${selector} is outside the ${rect.viewportWidth}x${rect.viewportHeight} viewport at (${x}, ${y})`,
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
}

async function typeInto(selector, text) {
  await click(selector, 0.5, 0.5);
  await page(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    el.focus();
    el.select();
    return true;
  })()`);
  win.webContents.insertText(text);
  await sleep(220);
}

async function checkControls(scopeSelector, scrollSelector) {
  return pageAsync(`
    const scope = document.querySelector(${JSON.stringify(scopeSelector)});
    const scroll = document.querySelector(${JSON.stringify(scrollSelector)});
    if (!scope || !scroll) return { error: 'missing scope or scroller', count: 0, issues: [] };
    const elements = [...new Set([...scope.querySelectorAll('[data-ie], input')])];
    const issues = [];
    for (const el of elements) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      // Timers still run while Chromium throttles frames for a hidden window.
      await new Promise((resolve) => setTimeout(resolve, 20));
      const r = el.getBoundingClientRect();
      const s = scroll.getBoundingClientRect();
      const label = el.dataset.ie || el.getAttribute('name') || el.tagName;
      if (r.width < 4 || r.height < 4) {
        issues.push({ kind: 'zero-size', label, width: r.width, height: r.height });
      }
      if (r.left < s.left - 1 || r.right > s.right + 1 || r.top < s.top - 1 || r.bottom > s.bottom + 1) {
        issues.push({
          kind: 'outside-scroller',
          label,
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          scroller: { left: s.left, top: s.top, right: s.right, bottom: s.bottom },
        });
      }
      const x = Math.max(s.left + 2, Math.min(innerWidth - 2, r.left + r.width / 2));
      const y = Math.max(s.top + 2, Math.min(innerHeight - 2, r.top + r.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit))) {
        issues.push({
          kind: 'occluded',
          label,
          hit: hit ? hit.tagName + (hit.className && typeof hit.className === 'string' ? '.' + hit.className.split(/\\s+/)[0] : '') : null,
        });
      }
    }
    return { count: elements.length, issues };
  `);
}

async function measureScope(scopeSelector, scrollSelector) {
  return page(`(() => {
    const scope = document.querySelector(${JSON.stringify(scopeSelector)});
    const scroll = document.querySelector(${JSON.stringify(scrollSelector)});
    if (!scope || !scroll) return { error: 'missing scope or scroller' };
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const controls = [...new Set([...scope.querySelectorAll('[data-ie], input')])];
    const boxes = controls.map((el) => ({
      label: el.dataset.ie || el.getAttribute('name') || el.tagName,
      ...rect(el),
    }));
    const overlaps = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) overlaps.push({ a: a.label, b: b.label, area: Math.round(w * h) });
      }
    }
    const labels = [...scope.querySelectorAll('.ie-label')].map((el) => {
      const r = rect(el);
      return {
        text: el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 40),
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        ...r,
      };
    });
    const labelOverlaps = [];
    for (const label of labels) {
      for (const box of boxes) {
        const w = Math.min(label.right, box.right) - Math.max(label.left, box.left);
        const h = Math.min(label.bottom, box.bottom) - Math.max(label.top, box.top);
        if (w > 1 && h > 1) labelOverlaps.push({ label: label.text, control: box.label, area: Math.round(w * h) });
      }
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scope: { ...rect(scope), clientWidth: scope.clientWidth, scrollWidth: scope.scrollWidth },
      scroller: {
        ...rect(scroll),
        clientWidth: scroll.clientWidth,
        clientHeight: scroll.clientHeight,
        scrollWidth: scroll.scrollWidth,
        scrollHeight: scroll.scrollHeight,
        overflowX: getComputedStyle(scroll).overflowX,
        overflowY: getComputedStyle(scroll).overflowY,
      },
      controlCount: controls.length,
      horizontalOverflow: {
        document: document.documentElement.scrollWidth - innerWidth,
        scope: scope.scrollWidth - scope.clientWidth,
        scroller: scroll.scrollWidth - scroll.clientWidth,
        controls: controls.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.left < -1 || r.right > innerWidth + 1;
        }).length,
      },
      overlaps: overlaps.slice(0, 24),
      labels: labels.filter((label) => label.scrollWidth > label.clientWidth + 1),
      labelOverlaps: labelOverlaps.slice(0, 24),
    };
  })()`);
}

function collectLayoutIssues(label, metrics, checks) {
  if (metrics.error) {
    layoutIssues.push(`${label}: ${metrics.error}`);
    return;
  }
  if (metrics.horizontalOverflow.document > 1) {
    layoutIssues.push(`${label}: document overflows horizontally by ${metrics.horizontalOverflow.document}px`);
  }
  if (metrics.horizontalOverflow.scope > 1) {
    layoutIssues.push(`${label}: editor overflows horizontally by ${metrics.horizontalOverflow.scope}px`);
  }
  if (metrics.horizontalOverflow.scroller > 1) {
    layoutIssues.push(`${label}: scroll container overflows horizontally by ${metrics.horizontalOverflow.scroller}px`);
  }
  if (metrics.horizontalOverflow.controls > 0) {
    layoutIssues.push(`${label}: ${metrics.horizontalOverflow.controls} controls outside the viewport width`);
  }
  if (metrics.overlaps.length) {
    layoutIssues.push(`${label}: ${metrics.overlaps.length} overlapping control pair(s): ${JSON.stringify(metrics.overlaps.slice(0, 4))}`);
  }
  if (metrics.labels.length) {
    layoutIssues.push(
      `${label}: ${metrics.labels.length} clipped label(s): ` +
        JSON.stringify(metrics.labels.map((entry) => `${entry.text} ${entry.clientWidth}/${entry.scrollWidth}`).slice(0, 6)),
    );
  }
  if (metrics.labelOverlaps.length) {
    layoutIssues.push(`${label}: label/control overlap: ${JSON.stringify(metrics.labelOverlaps.slice(0, 4))}`);
  }
  for (const issue of checks.issues ?? []) {
    layoutIssues.push(`${label}: ${issue.kind} ${issue.label} ${JSON.stringify(issue).slice(0, 220)}`);
  }
  console.log(
    `[ui-audit] ${label}: controls=${metrics.controlCount}, ` +
      `scroller=${Math.round(metrics.scroller.clientWidth)}x${Math.round(metrics.scroller.clientHeight)} ` +
      `content=${Math.round(metrics.scroller.scrollWidth)}x${Math.round(metrics.scroller.scrollHeight)}, ` +
      `issues=${layoutIssues.length}`,
  );
}

async function scrollTitle(part) {
  await page(`(() => {
    const scroll = document.querySelector('.overlay-title');
    const editor = document.querySelector('.identity-editor');
    const doctrine = document.querySelector('.identity-editor .ie-section-title');
    if (${JSON.stringify(part)} === 'top') {
      scroll.scrollTop += editor.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 10;
    } else if (${JSON.stringify(part)} === 'bottom') {
      scroll.scrollTop = scroll.scrollHeight;
    } else {
      scroll.scrollTop += doctrine.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 10;
    }
    return true;
  })()`);
  await sleep(180);
}

async function scrollModal(part) {
  await page(`(() => {
    const scroll = document.querySelector('.identity-modal-body');
    const doctrine = document.querySelector('.identity-modal-body .ie-section-title');
    if (${JSON.stringify(part)} === 'top') scroll.scrollTop = 0;
    else if (${JSON.stringify(part)} === 'bottom') scroll.scrollTop = scroll.scrollHeight;
    else if (doctrine) scroll.scrollTop += doctrine.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 10;
    return true;
  })()`);
  await sleep(180);
}

async function auditTitle(size) {
  const label = `${size.name} title`;
  console.log(`[ui-audit] start ${label}`);
  await setViewport(size.width, size.height);
  const metrics = await measureScope('.identity-editor', '.overlay-title');
  const checks = await checkControls('.identity-editor', '.overlay-title');
  collectLayoutIssues(label, metrics, checks);
  report.sizes.push({ surface: 'title', size: size.name, metrics, checks: checks.issues ?? [] });
  for (const part of ['top', 'doctrine', 'bottom']) {
    await scrollTitle(part);
    await shot(`title-${size.name}-${part}`);
  }
  await page(`(() => { document.querySelector('.overlay-title').scrollTop = 0; return true; })()`);
}

async function openIdentityModal() {
  await click('[data-act="identity"]', 0.5, 0.5);
  await waitFor('identity modal', `document.querySelector('.identity-modal-body')`, 8_000);
  await sleep(160);
}

async function closeIdentityModal() {
  await click('.identity-modal [data-act="close-overlay"]', 0.5, 0.5);
  await waitFor('identity modal closed', `!document.querySelector('.identity-modal')`, 5_000);
}

async function auditModal(size) {
  const label = `${size.name} modal`;
  await setViewport(size.width, size.height);
  await openIdentityModal();
  const metrics = await measureScope('.identity-editor', '.identity-modal-body');
  const checks = await checkControls('.identity-editor', '.identity-modal-body');
  collectLayoutIssues(label, metrics, checks);

  const modal = await page(`(() => {
    const modal = document.querySelector('.identity-modal');
    const body = document.querySelector('.identity-modal-body');
    const head = document.querySelector('.identity-modal .modal-head');
    if (!modal || !body) return null;
    const r = modal.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    const h = head ? head.getBoundingClientRect() : null;
    return {
      modal: { width: r.width, height: r.height, top: r.top, left: r.left, bottom: r.bottom },
      body: {
        width: b.width,
        height: b.height,
        clientHeight: body.clientHeight,
        scrollHeight: body.scrollHeight,
        overflowY: getComputedStyle(body).overflowY,
        flex: getComputedStyle(body).flex,
        minHeight: getComputedStyle(body).minHeight,
      },
      headVisible: !!h && h.top >= r.top - 1 && h.bottom <= r.top + 60,
    };
  })()`);
  assert(modal, 'identity modal measurements unavailable');
  if (modal.modal.height > size.height + 1) {
    layoutIssues.push(`${label}: dialog is ${Math.round(modal.modal.height)}px high, viewport is ${size.height}px`);
  }
  if (modal.modal.width > size.width + 1) {
    layoutIssues.push(`${label}: dialog is ${Math.round(modal.modal.width)}px wide, viewport is ${size.width}px`);
  }
  if (!modal.headVisible) layoutIssues.push(`${label}: dialog header is clipped`);
  if (modal.body.scrollHeight > modal.body.clientHeight + 1 && !['auto', 'scroll'].includes(modal.body.overflowY)) {
    layoutIssues.push(`${label}: dialog body is clipped with overflow-y ${modal.body.overflowY}`);
  }
  report.sizes.push({ surface: 'modal', size: size.name, metrics, modal, checks: checks.issues ?? [] });

  for (const part of ['top', 'doctrine', 'bottom']) {
    await scrollModal(part);
    await shot(`modal-${size.name}-${part}`);
  }
  await closeIdentityModal();
}

async function readStoredIdentity() {
  return page(`localStorage.getItem(${JSON.stringify(IDENTITY_KEY)})`);
}

async function readEditorDom() {
  return page(`(() => {
    const value = (selector) => document.querySelector(selector)?.value ?? null;
    const active = (selector) => [...document.querySelectorAll(selector)].filter((el) => el.classList.contains('is-on')).map((el) => el.dataset.v);
    return {
      name: value('[data-ie="name"]'),
      motto: value('[data-ie="motto"]'),
      colors: {
        primary: value('[data-ie="color"][data-key="primary"]'),
        secondary: value('[data-ie="color"][data-key="secondary"]'),
        accent: value('[data-ie="color"][data-key="accent"]'),
      },
      active: {
        crest: active('.ie-crest'),
        pattern: active('.ie-pat'),
        style: active('.ie-style'),
        tech: active('.ie-tech'),
        ship: active('[data-ie="ship"]'),
        traits: active('[data-ie="trait"]'),
        government: active('[data-ie="government"]'),
        worldview: active('[data-ie="worldview"]'),
        religion: active('[data-ie="religion"]'),
      },
      banner: document.querySelector('.ie-flag svg')?.outerHTML ?? null,
    };
  })()`);
}

async function setProfileThroughEditor() {
  await typeInto('[data-ie="name"]', CHOSEN.name);
  await typeInto('[data-ie="motto"]', CHOSEN.motto);
  await click(`[data-ie="swatch"][data-key="primary"][data-v="${CHOSEN.primary}"]`);
  await click(`[data-ie="swatch"][data-key="secondary"][data-v="${CHOSEN.secondary}"]`);
  await click(`[data-ie="swatch"][data-key="accent"][data-v="${CHOSEN.accent}"]`);
  await click(`[data-ie="crest"][data-v="${CHOSEN.crest}"]`);
  await click(`[data-ie="pattern"][data-v="${CHOSEN.pattern}"]`);
  await click(`[data-ie="style"][data-v="${CHOSEN.style}"]`);
  await click(`[data-ie="tech"][data-v="${CHOSEN.tech}"]`);
  await click(`[data-ie="ship"][data-v="${CHOSEN.shipClass}"]`);
  for (const trait of CHOSEN.traits) await click(`[data-ie="trait"][data-v="${trait}"]`);
  await click(`[data-ie="government"][data-v="${CHOSEN.government}"]`);
  await click(`[data-ie="worldview"][data-v="${CHOSEN.worldview}"]`);
  await click(`[data-ie="religion"][data-v="${CHOSEN.religion}"]`);
  await sleep(250);
}

async function newWindow(width, height) {
  if (win) {
    try {
      if (debuggerAttached) win.webContents.debugger.detach();
    } catch {
      /* ignore */
    }
    debuggerAttached = false;
    win.destroy();
    win = null;
    await sleep(220);
  }
  win = new BrowserWindow({
    width: 1300,
    height: 760,
    useContentSize: true,
    show: true,
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
  await waitFor('app boot', `window.__pax && document.querySelector('[data-act="start"]')`, 20_000);
  await setViewport(width, height);
  return win.webContents.getOSProcessId();
}

function assertProfileMods(actual) {
  const expected = {
    attack: 1.04 * 1.09,
    hull: 1.1,
    income: 0.97 * 0.97 * 1.06,
    research: 1.1 * 1.1 * 0.97 * 1.03,
    influence: 0.97,
  };
  for (const key of Object.keys(expected)) {
    assert(
      Math.abs(actual[key] - expected[key]) < 1e-9,
      `profile ${key} modifier is ${actual[key]}, expected ${expected[key]}`,
    );
  }
}

async function auditPersistence() {
  currentCase = 'persistence';
  const rendererBefore = await newWindow(1280, 720);
  await setProfileThroughEditor();
  const storedBefore = await readStoredIdentity();
  assert(storedBefore, 'identity was not written to localStorage');
  const parsedBefore = JSON.parse(storedBefore);
  for (const key of ['name', 'motto', 'shipClass', 'government', 'worldview', 'religion']) {
    assert(parsedBefore[key] === CHOSEN[key], `stored ${key} is ${JSON.stringify(parsedBefore[key])}, expected ${JSON.stringify(CHOSEN[key])}`);
  }
  assert(
    parsedBefore.traits.length === 2 && CHOSEN.traits.every((id) => parsedBefore.traits.includes(id)),
    `stored traits are ${JSON.stringify(parsedBefore.traits)}`,
  );
  for (const key of ['primary', 'secondary', 'accent', 'crest', 'pattern', 'style', 'tech']) {
    assert(parsedBefore[key] === CHOSEN[key], `stored ${key} is ${JSON.stringify(parsedBefore[key])}`);
  }
  const domBefore = await readEditorDom();
  assert(domBefore.banner, 'banner SVG missing before restart');

  const rendererAfter = await newWindow(1280, 720);
  const storedAfter = await readStoredIdentity();
  assert(storedAfter === storedBefore, 'stored identity changed across the renderer restart');
  const domAfter = await readEditorDom();
  assert(domAfter.name === CHOSEN.name, `name after restart is ${JSON.stringify(domAfter.name)}`);
  assert(domAfter.motto === CHOSEN.motto, `motto after restart is ${JSON.stringify(domAfter.motto)}`);
  for (const key of ['primary', 'secondary', 'accent']) {
    assert(domAfter.colors[key] === CHOSEN[key], `${key} after restart is ${domAfter.colors[key]}`);
  }
  assert(domAfter.active.ship.includes(CHOSEN.shipClass), `ship after restart is ${JSON.stringify(domAfter.active.ship)}`);
  assert(
    CHOSEN.traits.every((id) => domAfter.active.traits.includes(id)) && domAfter.active.traits.length === 2,
    `traits after restart are ${JSON.stringify(domAfter.active.traits)}`,
  );
  assert(domAfter.active.government.includes(CHOSEN.government), 'government after restart is wrong');
  assert(domAfter.active.worldview.includes(CHOSEN.worldview), 'worldview after restart is wrong');
  assert(domAfter.active.religion.includes(CHOSEN.religion), 'religion after restart is wrong');
  assert(domAfter.active.crest.includes(String(CHOSEN.crest)), 'crest after restart is wrong');
  assert(domAfter.active.pattern.includes(String(CHOSEN.pattern)), 'banner pattern after restart is wrong');
  assert(domAfter.active.style.includes(CHOSEN.style), 'architecture style after restart is wrong');
  assert(domAfter.active.tech.includes(CHOSEN.tech), 'house doctrine after restart is wrong');
  assert(
    JSON.stringify(domAfter.active) === JSON.stringify(domBefore.active),
    `editor selections changed across restart: ${JSON.stringify(domBefore.active)} -> ${JSON.stringify(domAfter.active)}`,
  );
  assert(domAfter.banner === domBefore.banner, 'banner markup changed across the renderer restart');
  assert(rendererBefore !== rendererAfter, `renderer process id did not change across restart (${rendererAfter})`);

  // Visual proof of the persisted, non-default editor at a full desktop size.
  await setViewport(1920, 1080);
  await scrollTitle('top');
  await shot('persisted-1920x1080');
  await setViewport(1280, 720);

  await page(`(() => {
    const input = document.querySelector('#seed-input');
    if (input) input.value = '424242';
    return true;
  })()`);
  await click('[data-act="start"]');
  await waitFor('campaign after restart', `window.__pax.game?.systems?.length > 0 && window.__pax.selection?.system !== null`, 20_000);
  await sleep(500);

  const campaign = await page(`(() => {
    const game = window.__pax.game;
    const empire = game.empires[game.player];
    const fleet = game.fleets.find((entry) => entry.owner === game.player);
    return {
      profile: empire.profile ?? null,
      mods: empire.profileMods ?? null,
      ships: fleet?.ships ?? null,
      player: game.player,
    };
  })()`);
  assert(campaign.profile, 'campaign has no profile');
  for (const key of ['shipClass', 'government', 'worldview', 'religion']) {
    assert(campaign.profile[key] === CHOSEN[key], `campaign profile ${key} is ${campaign.profile[key]}`);
  }
  assert(
    CHOSEN.traits.every((id) => campaign.profile.traits.includes(id)) && campaign.profile.traits.length === 2,
    `campaign traits are ${JSON.stringify(campaign.profile.traits)}`,
  );
  assertProfileMods(campaign.mods);
  assert(campaign.ships[CHOSEN.shipClass] === 2, `start fleet ${CHOSEN.shipClass} is ${campaign.ships[CHOSEN.shipClass]}, expected 2`);
  assert(campaign.ships.scout === 1, `start fleet scouts is ${campaign.ships.scout}`);
  assert(campaign.ships.ark === 1, `start fleet arks is ${campaign.ships.ark}`);
  for (const cls of ['corvette', 'raider', 'frigate', 'destroyer', 'cruiser', 'battleship']) {
    if (cls !== CHOSEN.shipClass) {
      assert(campaign.ships[cls] === 0, `start fleet unexpectedly has ${campaign.ships[cls]} ${cls}`);
    }
  }

  await click('.tab[data-tab="empire"]', 0.5, 0.5);
  await waitFor('empire overview', `document.querySelector('.panel-body')?.textContent.includes('Reichsprofil')`, 8_000);
  const hud = await page(`(() => {
    const text = (document.querySelector('.panel-body')?.innerText ?? '').replace(/\\s+/g, ' ').trim();
    return { text, motto: document.querySelector('.page-motto')?.textContent ?? document.querySelector('.ie-motto')?.textContent ?? null };
  })()`);
  const hudLower = hud.text.toLowerCase();
  for (const needle of [
    'reichsprofil',
    'schiffstyp',
    'regierung',
    'weltanschauung',
    'religion',
    'technokratie',
    'militaristisch',
    'maschinenglaube',
    'psionisches erbe',
    'werftgenies',
    CHOSEN.motto.toLowerCase(),
    // 139 % is faction research (1.15) multiplied by the profile's 1.2089.
    '113 %',
    '110 %',
    '139 %',
  ]) {
    assert(hudLower.includes(needle), `empire overview lacks ${JSON.stringify(needle)}; text=${hud.text.slice(0, 700)}`);
  }
  await shot('empire-1280x720');
  await page(`(() => {
    const body = document.querySelector('.panel-body');
    const titles = [...document.querySelectorAll('.panel-body .block-title')];
    const target = titles.find((el) => el.textContent.toLowerCase().includes('reichsprofil'));
    if (target) body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top - 12;
    return true;
  })()`);
  await sleep(250);
  await shot('empire-profile-1280x720');

  report.persistence = {
    rendererBefore,
    rendererAfter,
    storedBefore,
    storedAfter,
    domBefore,
    domAfter,
    campaign,
    hud: hud.text,
  };
  console.log(
    `PASS persistence: renderer ${rendererBefore} -> ${rendererAfter}, ` +
      `${Object.keys(CHOSEN).length} fields byte-identical, fleet ${CHOSEN.shipClass}x2, HUD modifiers correct`,
  );
}

async function run() {
  watchdog = setTimeout(() => {
    finish(1, new Error(`hard timeout after 160s; current case: ${currentCase}`));
  }, 160_000);
  watchdog.unref?.();

  await newWindow(1280, 720);
  const viewport = await page('({ width: innerWidth, height: innerHeight })');
  console.log(`[ui-audit] Electron content viewport: ${viewport.width}x${viewport.height}`);

  for (const size of SIZES) {
    currentCase = `layout ${size.name}`;
    await auditTitle(size);
  }

  currentCase = 'campaign for modal';
  await setViewport(1280, 720);
  await page(`(() => {
    const input = document.querySelector('#seed-input');
    if (input) input.value = '424242';
    return true;
  })()`);
  await click('[data-act="start"]');
  await waitFor('campaign boot', `window.__pax.game?.systems?.length > 0 && window.__pax.selection?.system !== null`, 20_000);
  await sleep(500);

  for (const size of SIZES) {
    currentCase = `modal ${size.name}`;
    await auditModal(size);
  }

  currentCase = 'persistence';
  await auditPersistence();

  assert(consoleErrors.length === 0, `renderer reported errors: ${consoleErrors.slice(0, 3).join(' | ')}`);
  assert(layoutIssues.length === 0, `${layoutIssues.length} layout issue(s): ${layoutIssues.slice(0, 6).join(' | ')}`);

  currentCase = 'complete';
  console.log(`PASS ui-audit: ${SIZES.length} viewports, ${report.sizes.length} surfaces, screenshots in art/ui-audit`);
  finish(0);
}

app
  .whenReady()
  .then(run)
  .catch((error) => finish(1, error));
