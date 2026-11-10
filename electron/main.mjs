// Desktop shell: starts the LAN relay (static files + WebSocket pairing) and
// opens the game in a Chromium window. Same code path as the browser build.
import { app, BrowserWindow, shell } from 'electron';
import { startRelay } from '../server/relay.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 7777;
let relay = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  function createWindow() {
    const win = new BrowserWindow({
      width: 1480,
      height: 900,
      minWidth: 1024,
      minHeight: 640,
      backgroundColor: '#05070b',
      autoHideMenuBar: true,
      title: 'PAX AETERNA — Cycles of the Void',
      icon: join(here, '../public/icon.png'),
      webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    win.loadURL(`http://127.0.0.1:${PORT}/`);
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
  }

  app.whenReady().then(() => {
    try {
      relay = startRelay({ port: PORT, staticDir: join(here, '../dist') });
    } catch (err) {
      console.error('LAN relay failed to start:', err);
    }
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    relay?.close();
    app.quit();
  });
}
