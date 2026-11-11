#!/usr/bin/env node
/**
 * Audio smoke test orchestrator.
 *
 * Starts a throw-away Vite dev server, launches the real app in Electron with
 * a temporary Chromium profile, and lets tools/audio/smoke-electron.cjs drive
 * actual mouse input against it. No browser automation dependency is needed:
 * Electron already ships Chromium for this project.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const runner = join(here, 'smoke-electron.cjs');
const require = createRequire(import.meta.url);
const electron = require('electron');
const TIMEOUT_MS = 120_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  const port = address && typeof address === 'object' ? address.port : null;
  await new Promise((resolve) => probe.close(resolve));
  assert(port, 'could not reserve a loopback port for the audio smoke test');
  return port;
}

function terminate(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      terminate(child);
      reject(new Error(`Electron audio smoke test timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    timer.unref?.();
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

let server = null;
let child = null;
let closing = false;

async function shutdown(code) {
  if (closing) return;
  closing = true;
  terminate(child);
  if (server) await server.close();
  process.exitCode = code;
}

process.once('SIGINT', () => {
  void shutdown(130).finally(() => process.exit(130));
});
process.once('SIGTERM', () => {
  void shutdown(143).finally(() => process.exit(143));
});

try {
  assert(typeof electron === 'string' && electron.length > 0, 'Electron executable not found');
  const port = await freePort();
  server = await createServer({
    root,
    configFile: join(root, 'vite.config.ts'),
    logLevel: 'error',
    clearScreen: false,
    server: { host: '127.0.0.1', port, strictPort: true },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const actualPort = address && typeof address === 'object' ? address.port : port;
  const url = `http://127.0.0.1:${actualPort}/`;
  console.log(`[audio-smoke] dev server: ${url}`);

  child = spawn(electron, [runner], {
    cwd: root,
    env: {
      ...process.env,
      PAX_SMOKE_URL: url,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  const code = await waitForExit(child);
  if (code !== 0) {
    console.error(`FAIL [audio-smoke] browser run exited with code ${code}`);
    await shutdown(code);
  } else {
    await shutdown(0);
  }
} catch (error) {
  console.error(`FAIL [audio-smoke] ${error instanceof Error ? error.message : String(error)}`);
  await shutdown(1);
}
