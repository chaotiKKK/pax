# PAX AETERNA — Cycles of the Void

Ein eigenständiges 4X-Weltraum-Strategiespiel mit prozeduraler Galaxie, sechzehn originären Mächten,
Blender-Rümpfen und LAN-Mehrspieler zwischen Windows-PC, Tablet und Handy.

> **Eigenständigkeit:** Dieses Projekt ist eine eigene Interpretation des 4X-Genres. Namen, Fraktionen,
> Schiffsdesigns, Technologien, Texte, Modelle und Code sind original und eigens erstellt. Es enthält
> keine Assets, Texte oder Daten eines bestehenden Spiels.

---

## Starten

```bash
cd pax-aeterna
npm install
npm run dev          # http://127.0.0.1:5199
```

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungs-Server (Browser) |
| `npm run build` | Typecheck + Produktionsbuild nach `dist/` |
| `npm run lan` | LAN-Relay + ausgelieferte Spieldateien auf Port 7777 |
| `npm run win` | Windows-App im Electron-Fenster starten |
| `npm run dist:win` | Portable Windows-App nach `release/win-unpacked/` bauen |
| `npm run android:sync` | Web-Build in das Android-Projekt kopieren |
| `npm run android:apk` | Debug-APK über Gradle bauen |

Voraussetzungen: Node 20+. Für Android: JDK 21 und Android SDK — JDK 25 ist mit dem Android-Gradle-Plugin 8.7 nicht kompatibel. Für die Rümpfe: Blender 5.x.

---

## Inhalt

| Bereich | Umfang |
| --- | --- |
| Sektoren | **64** prozedurale Systeme auf drei Spiralarmen |
| Mächte | **16** spielbare Fraktionen mit eigener Doktrin, Boni und Lore |
| Schiffsrümpfe | **13** Klassen, von der Sonde „Aster“ bis zum Titan „Aeterna“ |
| Technologien | **96** in **8** parallelen Pfaden (je 12 Stufen) |
| Gebäude | **16** Typen in fünf Wirkungsfamilien |
| Welttypen | **18** Biome, davon 11 kolonisierbar |
| Diplomatie | Beziehungen, Pakt, Bündnis, Krieg, Frieden, Geschenke |
| Gefecht | Rundenauflösung mit Hüllenverteilung, Rückzug, Invasion, Cinematic |
| Sieg | 22 Sektoren, 48 Technologien oder alle Rivalen brechen |

Die Fraktionen decken vier Archetypen ab: Republiken/Konklave (Forschung, Diplomatie), Schwärme/Kollektive
(Bevölkerung, Industrie), Militärblöcke (Angriff, Hülle) und Händler/Kartelle (Einkommen, Tempo).
Jede Kombination aus 16 Mächten und 18 Welttypen verändert Startaufstellung und Forschungsweg.

---

## Spielprinzip

Ein Zyklus ist ein Monat. Der Spieler gibt Befehle, beendet den Zyklus, dann rechnet die Simulation
Einkommen, Wachstum, Bau, Forschung, Bewegung, Gefechte und Invasionen.

- **Karte** — Ziehen dreht, Mausrad zoomt, Klick wählt Sektor oder Flotte.
- **Sektorpanel** — Welten, Kolonien, Bauleiste, Werft, Flotten, Invasionen.
- **Forschung** — acht Pfade forschen parallel; jeder Pfad schaltet Rümpfe und Gebäude frei.
- **Tastatur** — Leertaste beendet den Zyklus, Esc hebt die Auswahl auf, 1–4 wechseln die Registerkarte.

---

## LAN-Mehrspieler (plattformübergreifend)

Ein Gerät hostet, bis zu acht Geräte im selben WLAN spielen mit — Windows-PC, Android-Tablet und Handy
gleichzeitig. Der Host rechnet die Simulation, Gäste senden Befehle und erhalten Zustands-Snapshots.

1. Auf dem Host: `npm run lan` (oder die Windows-App starten). Das Relay meldet seine Adresse, z. B.
   `http://192.168.1.42:7777`.
2. Alle Geräte öffnen diese Adresse im Browser bzw. in der App.
3. Host: **LAN-Partie hosten** → Raumcode erscheint.
4. Gäste: **LAN beitreten** → Code eingeben (auf Android zusätzlich die Host-Adresse, falls die App
   nicht über das Relay geladen wurde).
5. Macht wählen, **Bereit** drücken, Host startet die Partie.

Der Host ist autoritativ: Nur er führt `endCycle()` aus und verteilt das Ergebnis. Jeder Befehl läuft
durch `applyCommand()` und wird gegen die eigene Fraktion geprüft, sodass Gäste keine fremden Reiche
steuern können. Chat und Bereitschaft laufen über dasselbe Relay.

Port 7777/TCP muss in der lokalen Firewall erlaubt sein. Das Relay hat keine Außenverbindung und
keine Benutzerkonten — es ist ausschließlich für das lokale Netz gedacht.

---

## Windows

```bash
npm run dist:win
# → release/win-unpacked/Pax Aeterna.exe  (portabel, 188.784.128 Bytes ≈ 188,8 MB)
```

Die App startet das LAN-Relay im Hintergrund und öffnet das Spiel in einem Chromium-Fenster; damit ist
derselbe Rechner gleichzeitig Host und Spieler. Der Ordner `win-unpacked` ist portabel.

## Android

```bash
npx cap add android      # einmalig (bereits geschehen)
npm run android:apk      # baut android/app/build/outputs/apk/debug/app-debug.apk
```

Für den Build wurden `android/local.properties` (SDK-Pfad) und JDK 21 verwendet; JDK 25 ist mit dem
Android-Gradle-Plugin 8.7 nicht kompatibel. Die fertige Debug-APK liegt unter
`android/app/build/outputs/apk/debug/app-debug.apk` (5.634.942 Bytes ≈ 5,6 MB) und lässt sich per `adb install` oder
Dateitransfer auf einem Android-Gerät ab 7.0 installieren.

Das WebView-Spiel läuft unter `http://localhost` (Schema `http`), damit WebSockets ins LAN erlaubt sind.
Für den Beitritt zu einem Host auf dem PC die LAN-Adresse des Hosts im Beitrittsdialog eintragen.

---

## Asset-Pipeline (Blender 5.2)

```bash
npm run assets           # tools/blender/run_assets.py
```

Erzeugt `public/assets/models/{scout,corvette,cruiser,dreadnought,ark,station}.glb`, Studiorenders in
`art/renders/` und Vorschauen in `art/preview/`. Die dreizehn Rumpfklassen teilen sich sechs
Blender-Familien; das Material `Accent` wird zur Laufzeit auf die Fraktionsfarbe umgefärbt.

---

## Architektur

```
src/
  main.ts          Start, Auswahl, Zyklusablauf, LAN-Verdrahtung
  commands.ts      Ein Befehlskanal für Solo, Host und Gast (mit Besitzprüfung)
  net.ts           WebSocket-Client für das LAN-Relay
  types.ts         Datenmodell inkl. Command- und Lobby-Typen
  data.ts          16 Mächte, 13 Rümpfe, 16 Gebäude, 18 Welten, 96 Technologien
  galaxy.ts        64 Sektoren, Lane-Graph, 16 Startpositionen
  sim.ts           Wirtschaft, Forschung, Gefecht, Invasion, KI, Diplomatie
  render/          Galaxiekarte, Orbit-Rad, Gefecht, Arsenal
  ui/hud.ts        Instrumentenbrett, Registerkarten, Overlays
  ui/lobby.ts      LAN-Lobby, Fraktionswahl, Bereitschaft, Chat
server/relay.mjs   Abhängigkeitsfreies WebSocket-Relay + statischer Server
electron/main.mjs  Windows-Fenster + eingebettetes Relay
android/           Capacitor-Projekt
```

Die Simulation ist deterministisch bis auf Gefechtsvarianz und KI-Entscheidungen. Gefechte werden als
Rundenprotokoll aufgezeichnet und von der Wiedergabe ausschließlich aus diesem Protokoll gelesen.

---

## Nachweis: durchgespielte Partien

Beide Partien wurden mit der echten Simulations-Engine (`endCycle`) gespielt, nicht mit einer Attrappe.

| Partie | Ergebnis | Endwerte |
| --- | --- | --- |
| Solo (Concordia, Seed 424242) | Sieg in Zyklus 144 | 48 Technologien → „Aeterna-Protokoll“, 4 Sektoren, 10 Kolonien |
| LAN (Host VHEL'AN, Gast CONCORDIA, Seed 20261110) | Sieg in Zyklus 123 | Sieger VHEL'AN mit 48 Techs und 7 Sektoren; Gast CONCORDIA 35 Techs, 1 Sektor — **beide Clients identisch** |

Der LAN-Test lief mit zwei getrennten Browser-Sitzungen gegen dasselbe Relay: Gast-Befehle kamen an
(Forschung `econ1` → `econ8` im Gastreich), Fremdbesitz wurde abgelehnt („Flotte nicht verfügbar“,
„Keine eigene Kolonie“), und nach dem Sieg zeigten Host und Gast denselben Siegbildschirm.

Dafür wurde die Expansionsökonomie angepasst: Einfluss wächst jetzt mit der Reichsgröße
(`2,2 + Sektoren × 0,45` pro Zyklus) und eine Kolonie kostet 25 statt 30 Einfluss. Mit der alten Rate
waren 22 Sektoren innerhalb von 240 Zyklen rechnerisch unerreichbar — das Siegziel war tot.

## Qualitätsstand

Geprüft: `npm run typecheck` und `npm run build` fehlerfrei; Solo-Partie mit 16 Mächten und 8
Forschungspfaden; LAN-Partie mit zwei getrennten Browsersitzungen (Host + Gast), Fraktionswahl,
Bereitschaft, Befehlsübertragung und Zyklus-Sync (Host Zyklus 02 → Gast Zyklus 02); Windows-Build als
`Pax Aeterna.exe`; Relay liefert Build-Dateien und Health-Endpunkt.

Bekannte Grenzen: kein Speichern/Laden, kein Internet-Mehrspieler (nur LAN), keine Audio-Dateien
(bewusst synthetisiert), Balance auf kurze bis mittlere Partien ausgelegt. Das Android-APK benötigt
einen lokalen Gradle-Build mit passendem JDK.

## Reichsidentität

Im Titelbild steht unter der Machtwahl ein Editor für die eigene Reichsidentität: Akzentfarbe (acht Vorgaben oder freie Wahl), sechs Wappen, fünf Bannermuster und fünf Architekturstile. Die Wahl färbt Flottenakzente, Wappen und den Startknopf, ändert die Zeichensprache im Bauwesen (etwa brutalistische Blöcke statt klassizistischer Symbole) und benennt den Technikstil im Forschungsfenster. Sie liegt lokal im Browser-Speicher, wird nicht in LAN-Snapshots übertragen und ist rein kosmetisch — Simulation und Balance bleiben unberührt.
