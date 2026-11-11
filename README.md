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
| `npm run audio:smoke` | Sieben Audio-Integrationstests im echten Electron-Chromium ausführen |
| `npm run input:smoke` | Down-Hit-Regression der Sternenkarte für Maus und Touch ausführen |
| `npm run ui:audit` | Layout- und Persistenz-Audit des Reichs-Editors mit Electron-Screenshots |
| `npm run lan` | LAN-Relay + ausgelieferte Spieldateien auf Port 7777 |
| `npm run selfplay` | Balance-Matrix für Windows und Android-Viewport spielen |
| `npm run win` | Windows-App im Electron-Fenster starten |
| `npm run dist:win` | Portable Windows-App nach `release/win-unpacked/` bauen |
| `npm run android:sync` | Web-Build in das Android-Projekt kopieren |
| `npm run android:apk` | Debug-APK über Gradle bauen |

Voraussetzungen: Node 20+. Für Android: JDK 21 und Android SDK — JDK 25 ist mit dem Android-Gradle-Plugin 8.7 nicht kompatibel. Für die Rümpfe: Blender 5.x.

---

## Self-Play-Test

`npm run selfplay` startet einen unsichtbaren Electron-Host mit Vite und spielt die echte Simulation —
dieselben `createGame()`- und `endCycle()`-Pfade wie im Spiel, keine Attrappe. Die Matrix umfasst
**384 Windows-Partien** (4 Seeds × 16 Mächte × 6 Profile) und **384 Android-Partien** im
412×915-Mobile-Viewport mit Touch-Emulation (4 Seeds × 16 Mächte × 6 Profile). Jedes Reich erhält
ein Startprofil; die Gegnerprofile rotieren deterministisch, damit Rasse, Forschung und Taktik
kombiniert werden. Die Partien sind auf 240 Zyklen begrenzt.

Die Testseite aktiviert zwei ausschließlich für Self-Play gedachte Hooks: `aiPlayer` lässt die
Reichs-KI auch den Spielerslot führen, `allVictories` prüft den Sieg für alle lebenden Mächte statt
nur für den Spieler. Der normale Einzelspielerpfad bleibt unverändert. Jede Partie bekommt einen
geseedeten Zufallsstrom, damit Fehler reproduzierbar sind.

Ergebnisse:

- `art/selfplay/report.json` — vollständige Partien, Profile, Mächte, Siegarten, Siegerfraktion und Messwerte
- `art/selfplay/report.md` — lesbare Zusammenfassung für Windows und Android inklusive Vorher/Nachher-Vergleich und Restausreißern

Ein 16-Mächte-FFA hat einen Erwartungswert von 6,3 % pro Spielerstelle; der Bericht markiert
Abweichungen, Siegart-Monokulturen, die vollständige Sieg-/Endart-Attribution, Laufzeitfehler und
Zustandsanomalien. Der Android-Pass prüft
den WebView-/Touch-Pfad, nicht die Installation einer APK auf einem physischen Gerät.

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
| Sieg | 7 Sektoren, 48 Technologien, 5 Kolonien + 115 Energie + Wirtschaftsstufe 4 oder alle Rivalen brechen |

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
`android/app/build/outputs/apk/debug/app-debug.apk` (18.623.375 Bytes ≈ 18,6 MB) und lässt sich per `adb install` oder
Dateitransfer auf einem Android-Gerät ab 7.0 installieren.

Das WebView-Spiel läuft unter `http://localhost` (Schema `http`), damit WebSockets ins LAN erlaubt sind.
Für den Beitritt zu einem Host auf dem PC die LAN-Adresse des Hosts im Beitrittsdialog eintragen.

---

## Asset-Pipeline (Blender 5.2)

```bash
npm run assets           # tools/blender/run_assets.py
```

Erzeugt dreizehn eigene GLBs unter `public/assets/models/` – eine Silhouette pro Rumpfklasse –
und Studiorenders in `art/renders/`. Die Kontaktübersicht `art/renders/fleet-contact.png` zeigt
alle dreizehn Rümpfe nebeneinander.
Die BattleView lädt für Scout, Raider, Korvette, Fregatte, Zerstörer, Kreuzer, Träger, Linienschiff,
Schlachtschiff, Titan, Bollwerk, Lanzenträger und Arche jeweils ein eigenes Modell; das Material
`Accent` wird zur Laufzeit auf die Fraktionsfarbe umgefärbt.

Die BattleView zeichnet eine orthografische 3/4-Kamera, eine gemeinsame Kiel-Ebene und eine adaptive
Schlachtlinie. Jede Klasse hat in `src/data.ts` eine eigene `battleLength`; die Raider bleiben dadurch
neben Titan und Bollwerk klar klein, ohne dass die Kamera die Größenverhältnisse perspektivisch verzerrt.
`art/renders/battle-13-classes.png` zeigt alle dreizehn Klassen im Gefecht, die beiden Detailbilder
`battle-13-detail-a.png` und `battle-13-detail-b.png` zeigen sie in größerem Maßstab. Reproduzierbar
mit laufendem Vite-Server:

```bash
npx electron tools/renders/capture-battle.cjs
```

---

## Audio

Die Musik und alle Effekte sind gebündelte Assets im 16-Bit-Chiptune-Stil. Es gibt vier
Fundamentthemen mit je drei synchronen Stems (ruhig/angespannt/Perkussion) plus einem gemeinsamen
`ambience`-Stem aus dem mitgelieferten `music/deep-sub-bass-drones.mp3` (213,12 s, 48 kHz, Stereo).
Dieselbe MP3 läuft zusätzlich als `ambience`-Layer (Pegel 0.35) unter der Titelmusik
(`title.ogg` + MP3): Sie startet erst nach der ersten Nutzerinteraktion
(Autoplay-Policy), respektiert Musik-Lautstärke und Mute-Schalter und wird beim
Kampagnenstart sauber in die Ingame-Musik übergeblendet (nur eine Musikgruppe
aktiv, kein doppeltes Abspielen). Dazu 16 kurze Fraktionsmotive, Gefechts-,
Sieg- und Niederlage-Musik sowie rund 50 UI-, Karten-,
Wirtschafts-, Diplomatie- und Waffen-SFX. Der Mixer besitzt getrennte Musik-, SFX- und UI-Busse,
einen Master-Limiter, Musik-Ducking und lokale Lautstärkeregler im Handbuch.

```bash
npm run audio:generate   # public/audio aus tools/audio/generate.py neu erzeugen
npm run audio:audit      # Manifest, Formate, Pegel, Loop-Nähte und Paketgröße prüfen
npm run audio:smoke      # Identität, Tension, Bau-/Forschungs-/Kriegs-Cues, Battle-Cinematic (13 Rumpfklassen, 13 Signaturen) und Ducking prüfen
```

Der Smoke-Test startet einen temporären Vite-Server und ein unsichtbares Electron-Fenster. Er nutzt
echte Maus-Events und den echten Audio-Kontext, benötigt aber keine zusätzliche Browser-Automation.

Der Input-Smoke-Test nutzt denselben Aufbau. Er wählt im Identitätseditor Schiffstyp,
Rassenfähigkeit, Regierung, Weltanschauung und Religion, prüft deren Übernahme in Startflotte und
Reichsmodifikatoren und sichert danach den Down-Hit der Sternenkarte: Zwischen Pointerdown und
Pointerup wird die Kamera bewegt, einmal mit echter Maus und einmal mit DevTools-Touch-Events. Die
Auswahl muss in beiden Fällen das System unter dem Down-Punkt bleiben, nie das System unter dem
Release-Punkt.

`npm run ui:audit` prüft den Editor bei 1280×720, 1920×1080 und 1024×420: alle Bedienelemente
müssen erreichbar, unverdeckt und ohne Textüberlauf sein; der Dialog darf das Fenster nicht
überschreiten. Zusätzlich setzt der Audit das komplette Profil, startet den Renderer über ein neues
Electron-Fenster neu und vergleicht localStorage sowie Startflotte und Reichsboni. Screenshots und
Messwerte landen unter `art/ui-audit/`.

Die Audiodateien liegen unter `public/audio/`; der Produktionsbuild kopiert sie unverändert nach
`dist/audio/`. Der Generator benötigt Python 3, NumPy und FFmpeg und behält das MP3 als unveränderte
Ambience-Quelle im Manifest. Bei fehlenden Assets bleibt das
Spiel bedienbar und nutzt einen leisen prozeduralen Fallback. Eine nicht ausgelieferte Hörprobe
liegt unter `art/audio-preview.html` und ist nach `npm run dev` unter
`/art/audio-preview.html` erreichbar.

## Speichern & Laden

Der komplette Spielzustand ist reines JSON und wird in `localStorage` gespeichert (keine neuen
Abhängigkeiten, kein Server nötig). Im HUD-Button **💾** (Topbar) öffnet sich der Dialog
mit Autospeicher und drei Slots. Jeder belegte Slot zeigt seine Metadaten:
Fraktion, Zyklus, Seed, Gesamt-Systeme (64) und eigene Sektoren, Kolonien sowie
Speicherdatum/-zeit; leere Slots sind als „leer“ markiert. Laden, Überschreiben/
Speichern, Löschen, Datei-Export
(`pax-aeterna-save-<Seed>-Zyklus<N>.json`) und validiertem Datei-Import. Nach jedem
Zyklus wird im Solo- und Host-Modus automatisch gespeichert (Gäste speichern nicht;
der Host trägt den Spielstand). Tastatur: **F5** = schnell in Slot 1 speichern,
**F9** = schnell aus Slot 1 laden. Auf dem Titelbildschirm erscheint ein
**„Weiterspielen“**-Button mit den Autospeicher-Metadaten (Zyklus, Seed, Systeme,
Datum), sobald ein Autospeicher existiert. Importe werden
strukturell geprüft (Version, 64 Systeme, Seed, Spieler) und im LAN nur im Solo-Modus
übernommen. Limit: 8 MiB pro Spielstand.

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
  save.ts          Speichern/Laden: Autosave, 3 Slots, Export/Import, Validierung
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

Die Self-Play-Matrix hat die alte Siegstruktur korrigiert: Hegemonie verlangt jetzt 7 statt 22
Sektoren, eine echte Wirtschafts-Siegprüfung (5 Kolonien, 115 Energie und Wirtschaftsstufe 4) wurde
ergänzt, und die Technologiekosten wurden so entschleunigt, dass alle drei Pfade im 240-Zyklen-Fenster
erreichbar bleiben. Einfluss wächst weiter mit der Reichsgröße (`2,2 + Sektoren × 0,45` pro Zyklus),
eine Kolonie kostet 25 Einfluss.

## Qualitätsstand

Geprüft: `npm run typecheck` und `npm run build` fehlerfrei; Solo-Partie mit 16 Mächten und 8
Forschungspfaden; LAN-Partie mit zwei getrennten Browsersitzungen (Host + Gast), Fraktionswahl,
Bereitschaft, Befehlsübertragung und Zyklus-Sync (Host Zyklus 02 → Gast Zyklus 02); Windows-Build als
`Pax Aeterna.exe`; Relay liefert Build-Dateien und Health-Endpunkt.

Bekannte Grenzen: kein Internet-Mehrspieler (nur LAN), Balance auf kurze bis
mittlere Partien ausgelegt. Das Android-APK benötigt einen lokalen Gradle-Build mit passendem JDK.

## Reichsidentität

Der Editor ist an zwei Stellen erreichbar: im Titelbild unter der Machtwahl und während einer Partie über das ◈-Symbol in der Kopfleiste (sowie über **Identität bearbeiten** im Register *Reich*). Er definiert den Reichsnamen, drei Farben (Primär, Sekundär, Akzent — je acht kuratierte Vorgaben oder freie Farbwahl), sechs Embleme, fünf Bannermuster sowie fünf Architekturstile: Imperialer Klassizismus, Biomorpher Organismus, Brutalistischer Block, Nomadische Ringe und Sakrales Maßwerk. Die Technikausrichtung („Hauslehre“) wählt einen der acht Forschungspfade oder Ausgeglichen.

Alles wirkt sofort: Banner und Bauwesen-Vorschau im Editor, danach Flottenakzent, Wappen, Reichsname im HUD, Startknopf und die Baukarten — die Stile ändern Form (Ecken, Abschrägungen, Spitzbogen), Materialwirkung (Farbverläufe, Raster) und die Zeichensprache der Gebäude, nicht bloß deren Text. Die Hauslehre markiert den gewählten Forschungszweig. Die Wahl liegt lokal im Browser-Speicher, wird nicht in LAN-Snapshots übertragen und ist rein kosmetisch — Simulation und Balance bleiben unberührt.
