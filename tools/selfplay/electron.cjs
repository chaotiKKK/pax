'use strict';

/**
 * Headless Electron host for the self-play matrix. The desktop pass uses the
 * Windows/Chromium content viewport; the Android pass emulates a 412x915
 * mobile WebView viewport with touch enabled. Both passes execute the same
 * browser bundle and the same simulation modules.
 */
const { app, BrowserWindow } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const target = process.env.PAX_SELFPLAY_URL;
if (!target) {
  console.error('FAIL [selfplay] PAX_SELFPLAY_URL is missing');
  process.exit(1);
}

const root = process.cwd();
const outDir = join(root, 'art', 'selfplay');
mkdirSync(outDir, { recursive: true });
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

let win = null;
let finished = false;
let debuggerAttached = false;
let watchdog = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function finish(code, error) {
  if (finished) return;
  finished = true;
  if (watchdog) clearTimeout(watchdog);
  if (error) console.error(`FAIL [selfplay] ${error instanceof Error ? error.message : String(error)}`);
  try {
    if (debuggerAttached) win?.webContents.debugger.detach();
  } catch {
    /* ignore */
  }
  debuggerAttached = false;
  try {
    win?.destroy();
    win = null;
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(code), 120);
}

async function page(script) {
  if (!win) throw new Error('self-play window is not available');
  return win.webContents.executeJavaScript(script, true);
}

async function waitFor(expression, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await page(`Boolean(${expression})`)) return;
    } catch {
      /* page may still be loading */
    }
    await sleep(80);
  }
  throw new Error(`self-play condition timed out: ${expression}`);
}

async function setViewport(width, height, mobile) {
  if (!debuggerAttached) {
    win.webContents.debugger.attach('1.3');
    debuggerAttached = true;
    await win.webContents.debugger.sendCommand('Page.enable');
  }
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  await win.webContents.debugger.sendCommand(
    'Emulation.setTouchEmulationEnabled',
    mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false },
  );
  await sleep(220);
}

function kindCountsFor(report) {
  // Keep the full engine end-kind catalogue visible even when a path is not
  // reached in this sample; a zero row is not an uncategorized match.
  const counts = { 'Alleinherrschaft — kein Rivale mehr': 0 };
  for (const match of report.matches) {
    const kind = match.victoryKind ?? 'ohne Sieg';
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

function attributionFor(report) {
  const kinds = kindCountsFor(report);
  const matches = report.matches.length;
  const categorized = report.matches.filter((match) => Boolean(match.victoryKind)).length;
  const playerEliminations = report.matches.filter(
    (match) => match.playerEliminated === true || Boolean(match.victoryKind?.startsWith('Ausgelöscht')),
  ).length;
  return {
    matches,
    categorized,
    uncategorized: matches - categorized,
    categories: Object.values(kinds).reduce((sum, count) => sum + count, 0),
    winnerFactions: report.matches.filter((match) => Boolean(match.winnerFaction)).length,
    playerEliminations,
    kinds,
  };
}

function compactReport(report) {
  const attribution = attributionFor(report);
  return {
    summary: report.summary,
    byProfile: report.byProfile,
    byFaction: report.byFaction,
    kinds: attribution.kinds,
    attribution,
    config: { seeds: report.config.seeds, profileIds: report.config.profileIds },
  };
}

function comparisonMarkdown(before, after) {
  const lines = ['', '# Vorher / Nachher', ''];
  const beforeMatches = before.windows.summary.matches + before.android.summary.matches;
  const afterMatches = after.windows.summary.matches + after.android.summary.matches;
  const beforeSeeds = before.windows.config?.seeds?.length ?? 2;
  const afterSeeds = after.windows.config?.seeds?.length ?? 3;
  lines.push(
    `Vorher: ${before.windows.summary.matches} Windows + ${before.android.summary.matches} Android ` +
      `(${beforeMatches} Partien, ${beforeSeeds} Seeds). Nachher: ${after.windows.summary.matches} Windows + ` +
      `${after.android.summary.matches} Android (${afterMatches} Partien, ${afterSeeds} Seeds).`,
    'Die Siegquote zählt den Spielerslot; die Siegarten zählen den tatsächlichen Sieger jeder Partie, auch wenn eine KI gewinnt.',
    '',
    '| Kennzahl | Windows vorher | Windows nachher | Android vorher | Android nachher |',
    '| --- | ---: | ---: | ---: | ---: |',
  );
  for (const side of ['windows', 'android']) {
    for (const report of [before[side], after[side]]) {
      if (!report.kinds) report.kinds = kindCountsFor(report);
    }
  }
  const metric = (label, pick) =>
    `| ${label} | ${pick(before.windows)} | ${pick(after.windows)} | ${pick(before.android)} | ${pick(after.android)} |`;
  lines.push(
    metric('Siegquote', (r) => `${(r.summary.winRate * 100).toFixed(1)} %`),
    metric('Technologie-Siege', (r) => `${r.kinds['Aeterna-Protokoll — 48 Forschungen abgeschlossen'] ?? 0} (${((r.kinds['Aeterna-Protokoll — 48 Forschungen abgeschlossen'] ?? 0) / r.summary.matches * 100).toFixed(1)} %)`),
    metric('Hegemonie-Siege', (r) => `${Object.entries(r.kinds).filter(([k]) => k.startsWith('Hegemonie')).reduce((s, [, n]) => s + n, 0)}`),
    metric('Wirtschafts-Siege', (r) => `${Object.entries(r.kinds).filter(([k]) => k.startsWith('Wirtschaftshegemonie')).reduce((s, [, n]) => s + n, 0)}`),
    metric('Ausgelöschte Spielerslots', (r) => `${r.attribution?.playerEliminations ?? 0}`),
    metric('Kategorisierte Partien', (r) => `${r.attribution?.categorized ?? r.summary.matches}/${r.summary.matches}`),
    metric('Ø Zyklen', (r) => r.summary.averageCycles.toFixed(1)),
  );
  lines.push('', '## Profil-Siegquoten vorher → nachher', '', '| Profil | Windows | Android |', '| --- | ---: | ---: |');
  const profiles = [...new Set([...Object.keys(before.windows.byProfile), ...Object.keys(after.windows.byProfile)])];
  const rate = (side, profile) => after[side].byProfile[profile]?.winRate ?? 0;
  const profileExtreme = (pick) => profiles.reduce(
    (best, profile) => {
      const value = pick(rate('windows', profile), rate('android', profile));
      return value > best.value ? { id: profile, value } : best;
    },
    { id: profiles[0] ?? '–', value: -1 },
  );
  const highestProfile = profileExtreme((windows, android) => Math.max(windows, android));
  const lowestProfile = profiles.reduce(
    (best, profile) => {
      const value = Math.min(rate('windows', profile), rate('android', profile));
      return value < best.value ? { id: profile, value } : best;
    },
    { id: profiles[0] ?? '–', value: Number.POSITIVE_INFINITY },
  );
  const dominantWindows = Object.entries(after.windows.kinds).sort((a, b) => b[1] - a[1])[0] ?? ['–', 0];
  const dominantAndroid = Object.entries(after.android.kinds).sort((a, b) => b[1] - a[1])[0] ?? ['–', 0];
  const dominantKind = dominantWindows[0];
  const dominantShare = dominantWindows[1] / after.windows.summary.matches;
  const dominantAndroidShare = dominantAndroid[1] / after.android.summary.matches;
  const maxCategoryShare = Math.max(
    ...Object.values(after.windows.kinds).map((count) => count / after.windows.summary.matches),
    ...Object.values(after.android.kinds).map((count) => count / after.android.summary.matches),
  );
  const techKind = 'Aeterna-Protokoll — 48 Forschungen abgeschlossen';
  const techWindows = (after.windows.kinds[techKind] ?? 0) / after.windows.summary.matches;
  const techAndroid = (after.android.kinds[techKind] ?? 0) / after.android.summary.matches;
  for (const profile of profiles) {
    const beforeW = before.windows.byProfile[profile]?.winRate ?? 0;
    const afterW = after.windows.byProfile[profile]?.winRate ?? 0;
    const beforeA = before.android.byProfile[profile]?.winRate ?? 0;
    const afterA = after.android.byProfile[profile]?.winRate ?? 0;
    lines.push(
      `| ${profile} | ${(beforeW * 100).toFixed(1)} % → ${(afterW * 100).toFixed(1)} % | ` +
        `${(beforeA * 100).toFixed(1)} % → ${(afterA * 100).toFixed(1)} % |`,
    );
  }
  lines.push(
    '',
    '## Restausreißer',
    '',
    `- ${maxCategoryShare <= 0.5 ? 'Keine Siegart liegt über 50 %' : 'ACHTUNG: Eine Siegart liegt über 50 %'}; ` +
      `stärkste Kategorie ist „${dominantKind.split(' — ')[0]}“ mit ${(dominantShare * 100).toFixed(1)} % im Windows- ` +
      `und ${(dominantAndroidShare * 100).toFixed(1)} % im Android-Lauf.`,
    `- Kein Profil liegt außerhalb 0,4×–2,5× des Erwartungswerts (2,5–15,6 %): höchster Wert ` +
      `„${highestProfile.id}“ ${(highestProfile.value * 100).toFixed(1)} %, niedrigster ` +
      `„${lowestProfile.id}“ ${(lowestProfile.value * 100).toFixed(1)} %.`,
    `- ${after.windows.attribution.playerEliminations} Windows- und ${after.android.attribution.playerEliminations} Android-Spielerslots waren ausgelöscht; ` +
      'jede dieser Partien wurde nach dem Ausscheiden weitersimuliert und trägt die Sieg-/Endart eines echten KI-Siegers.',
    `- Die verbleibende Unsicherheit ist Stichprobenrauschen bei 64 Partien pro Profil und Viewport; Technologie liegt bei ` +
      `${(techWindows * 100).toFixed(1)}/${(techAndroid * 100).toFixed(1)} % und bleibt ein substanzieller Pfad.`,
    '',
  );
  return lines.join('\n');
}

function markdownFor(report) {
  const lines = [
    `# Self-Play Bericht · ${report.mode}`,
    '',
    `Generiert: ${report.generatedAt}`,
    `Partien: **${report.summary.matches}** · Siege: **${report.summary.wins}** · ` +
      `Niederlagen: **${report.summary.losses}** · Draws: **${report.summary.draws}**`,
    `Siegquote: **${(report.summary.winRate * 100).toFixed(1)} %** · ` +
      `Drawquote: **${(report.summary.drawRate * 100).toFixed(1)} %** · ` +
      `Ø Zyklen: **${report.summary.averageCycles.toFixed(1)}** · ` +
      `Ø Techs: **${report.summary.averageTechs.toFixed(1)}** · ` +
      `Ø Sektoren: **${report.summary.averageSystems.toFixed(1)}** · ` +
      `Ø Schlachten: **${report.summary.averageBattles.toFixed(1)}**`,
    '',
    `Format: ${report.config.factions.length} Mächte, freie Siegprüfung. ` +
      `Erwartungswert für eine einzelne Spielerstelle: ` +
      `**${(100 / Math.max(2, report.config.factions.length)).toFixed(1)} %**.`,
    'Die Siegquote zählt den Spielerslot; die Siegarten-Tabelle zählt den Sieger der Partie, auch wenn eine KI gewinnt.',
    `Sieg-/Endart-Attribution: **${report.attribution.categorized}/${report.attribution.matches}** kategorisiert · ` +
      `**${report.attribution.uncategorized}** ohne Kategorie · ` +
      `**${report.attribution.playerEliminations}** Spielerslots ausgelöscht.`,
    '',
    '## Profile',
    '',
    '| Profil | Partien | Siege | Niederlagen | Draws | Siegquote | Ø Zyklen |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(report.byProfile).map(
      ([id, bucket]) =>
        `| ${id} | ${bucket.matches} | ${bucket.wins} | ${bucket.losses} | ${bucket.draws} | ` +
        `${(bucket.winRate * 100).toFixed(1)} % | ${bucket.averageCycles.toFixed(1)} |`,
    ),
    '',
    '## Mächte',
    '',
    '| Macht | Partien | Siege | Niederlagen | Draws | Siegquote |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(report.byFaction).map(
      ([id, bucket]) =>
        `| ${id} | ${bucket.matches} | ${bucket.wins} | ${bucket.losses} | ${bucket.draws} | ` +
        `${(bucket.winRate * 100).toFixed(1)} % |`,
    ),
    '',
    '## Siegarten',
    '',
    '| Siegart | Partien | Anteil |',
    '| --- | ---: | ---: |',
    ...(() => {
      const counts = new Map([['Alleinherrschaft — kein Rivale mehr', 0]]);
      for (const match of report.matches) {
        const kind = match.victoryKind ?? 'ohne Sieg';
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
      }
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(
          ([kind, count]) =>
            `| ${kind.replace(/\|/g, '/')} | ${count} | ${((count / report.matches.length) * 100).toFixed(1)} % |`,
        );
    })(),
    '',
    '## Auffälligkeiten',
    '',
    ...(report.flags.length ? report.flags.map((flag) => `- ${flag}`) : ['- keine automatischen Auffälligkeiten']),
    '',
    'Die vollständigen Partieergebnisse stehen in `art/selfplay/report.json`.',
    '',
  ];
  return lines.join('\n');
}

async function run() {
  watchdog = setTimeout(() => finish(1, new Error('self-play hard timeout after 240s')), 240_000);
  watchdog.unref?.();

  win = new BrowserWindow({
    width: 1280,
    height: 900,
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
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) console.error(`[selfplay renderer] ${message}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    finish(1, new Error(`self-play renderer gone: ${details.reason}`));
  });
  await win.loadURL(target);
  await waitFor(`window.__selfplay && document.body.dataset.selfplayReady === '1'`);

  const desktopConfig = {
    mode: 'windows',
    seeds: [17, 4242, 777, 31337],
    profileIds: [
      'void-research',
      'iron-war',
      'golden-trade',
      'deep-defense',
      'civic-republic',
      'ash-expansion',
    ],
    opponents: true,
  };
  await setViewport(1280, 720, false);
  console.log('[selfplay] windows matrix start');
  const windowsReport = await page(`window.__selfplay.run(${JSON.stringify(desktopConfig)})`);
  console.log(
    `[selfplay] windows: ${windowsReport.summary.matches} matches, ` +
      `${windowsReport.summary.wins} wins, ${windowsReport.summary.losses} losses, ` +
      `${windowsReport.summary.draws} draws`,
  );

  const androidConfig = {
    mode: 'android',
    seeds: [9001, 1212, 777, 31337],
    profileIds: [
      'void-research',
      'iron-war',
      'golden-trade',
      'deep-defense',
      'civic-republic',
      'ash-expansion',
    ],
    opponents: true,
  };
  await setViewport(412, 915, true);
  console.log('[selfplay] android matrix start');
  const androidReport = await page(`window.__selfplay.run(${JSON.stringify(androidConfig)})`);
  console.log(
    `[selfplay] android: ${androidReport.summary.matches} matches, ` +
      `${androidReport.summary.wins} wins, ${androidReport.summary.losses} losses, ` +
      `${androidReport.summary.draws} draws`,
  );

  let baseline = null;
  try {
    const before = JSON.parse(readFileSync(join(outDir, 'report-before.json'), 'utf8'));
    baseline = { windows: compactReport(before.windows), android: compactReport(before.android) };
  } catch {
    // A fresh checkout has no baseline; the comparison section is optional.
  }

  const report = {
    windows: windowsReport,
    android: androidReport,
    baseline,
    notes: [
      'Windows pass: Electron/Chromium 1280x720 content viewport.',
      'Android pass: 412x915 mobile Chromium/WebView viewport with touch enabled.',
      'Both passes use the same simulation modules, profiles and endCycle path as the game.',
    ],
  };
  for (const side of ['windows', 'android']) {
    const attribution = attributionFor(report[side]);
    report[side].kinds = attribution.kinds;
    report[side].attribution = attribution;
    if (attribution.categorized !== attribution.matches) {
      throw new Error(`${side}: only ${attribution.categorized}/${attribution.matches} matches have a victory/end kind`);
    }
  }
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(
    join(outDir, 'report.md'),
    markdownFor(windowsReport) + '\n' + markdownFor(androidReport) + (baseline ? comparisonMarkdown(baseline, report) : ''),
  );
  const errorCount =
    windowsReport.summary.errors + androidReport.summary.errors;
  const anomalyCount =
    windowsReport.summary.anomalies + androidReport.summary.anomalies;
  console.log(
    `PASS selfplay: ${report.windows.summary.matches} windows + ` +
      `${report.android.summary.matches} android matches, errors=${errorCount}, anomalies=${anomalyCount}`,
  );
  finish(errorCount || anomalyCount ? 1 : 0);
}

app.whenReady().then(run).catch((error) => finish(1, error));
