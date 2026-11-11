#!/usr/bin/env python3
"""Import selected Kenney sound packs (CC0) as game SFX variants.

Reads the OGG files directly from the Kenney zip archives (no manual
extraction needed), converts them to the project's SFX format
(44.1 kHz, 16-bit mono WAV, peak-normalised to <= 0.85), writes them as
``<cue>_kenney_<n>.wav`` into ``public/audio/sfx/`` and patches
``public/audio/manifest.json``:

- Battle cues (explosions, impacts, weapons) are *replaced* by the
  Kenney recordings, which sound far more organic than the synth stubs.
- UI/select cues keep their generated files and gain the Kenney sounds
  as additional random variants.

Source packs (CC0, https://kenney.nl/assets):
  Sci-Fi Sounds 1.0   (kenney_sci-fi-sounds.zip)
  Interface Sounds 1.0 (kenney_interface-sounds.zip)

Usage:
    python tools/audio/import_kenney.py [--sci ZIP] [--ui ZIP]

Defaults look for the archives in ``C:/Users/HP/Downloads``; override
with the CLI flags or the ``KENNEY_SCI_ZIP`` / ``KENNEY_UI_ZIP`` env
vars. Requires Python 3, NumPy and FFmpeg (same as generate.py/audit.py).

Run order after (re)generating the base package:
    python tools/audio/generate.py --sfx-only
    python tools/audio/import_kenney.py
    python tools/audio/audit.py
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import wave
import zipfile
from pathlib import Path

import numpy as np

SR = 44_100
PEAK = 0.85
ROOT = Path(__file__).resolve().parents[2]
AUDIO = ROOT / "public" / "audio"
SFX = AUDIO / "sfx"
MANIFEST = AUDIO / "manifest.json"
FFMPEG = shutil.which("ffmpeg")

DEFAULT_ZIPS = {
    "sci": Path(r"C:\Users\HP\Downloads\kenney_sci-fi-sounds.zip"),
    "ui": Path(r"C:\Users\HP\Downloads\kenney_interface-sounds.zip"),
}

# cue -> (mode, [ogg names inside the zips])
# mode "replace": manifest files become the Kenney variants only
# mode "append":  Kenney variants are added next to the generated files
MAPPING: dict[str, tuple[str, list[str]]] = {
    # --- battle: Kenney recordings replace the synth stubs entirely ---
    "explosion_small": ("replace", ["explosionCrunch_000.ogg", "explosionCrunch_001.ogg"]),
    "explosion_large": ("replace", ["explosionCrunch_003.ogg", "explosionCrunch_004.ogg",
                                     "lowFrequency_explosion_000.ogg", "lowFrequency_explosion_001.ogg"]),
    "impact_hull": ("replace", ["impactMetal_000.ogg", "impactMetal_001.ogg", "impactMetal_002.ogg",
                                "impactMetal_003.ogg", "impactMetal_004.ogg"]),
    "impact_shield": ("replace", ["forceField_000.ogg", "forceField_001.ogg", "forceField_002.ogg",
                                  "forceField_003.ogg", "forceField_004.ogg"]),
    "weapon_pulse": ("replace", ["laserSmall_000.ogg", "laserSmall_001.ogg", "laserSmall_002.ogg",
                                 "laserSmall_003.ogg", "laserSmall_004.ogg"]),
    "weapon_kinetic": ("replace", ["laserRetro_000.ogg", "laserRetro_001.ogg", "laserRetro_002.ogg",
                                   "laserRetro_003.ogg", "laserRetro_004.ogg"]),
    "weapon_missile": ("replace", ["laserLarge_000.ogg", "laserLarge_001.ogg", "laserLarge_002.ogg",
                                   "laserLarge_003.ogg", "laserLarge_004.ogg"]),
    # --- UI: Kenney variants are appended to the generated files ---
    "ui_click": ("append", ["click_001.ogg", "click_002.ogg", "click_003.ogg", "click_004.ogg", "click_005.ogg"]),
    "ui_open": ("append", ["open_001.ogg", "open_002.ogg", "open_003.ogg", "open_004.ogg"]),
    "ui_close": ("append", ["close_001.ogg", "close_002.ogg", "close_003.ogg", "close_004.ogg"]),
    "ui_confirm": ("append", ["confirmation_001.ogg", "confirmation_002.ogg",
                              "confirmation_003.ogg", "confirmation_004.ogg"]),
    "ui_deny": ("append", ["error_005.ogg", "error_006.ogg", "error_007.ogg", "error_008.ogg"]),
    "ui_toggle_on": ("append", ["toggle_001.ogg", "toggle_002.ogg", "toggle_003.ogg", "toggle_004.ogg"]),
    "ui_toggle_off": ("append", ["switch_001.ogg", "switch_002.ogg", "switch_003.ogg", "switch_004.ogg"]),
    "ui_tab": ("append", ["tick_001.ogg", "tick_002.ogg", "tick_004.ogg", "pluck_001.ogg", "pluck_002.ogg"]),
    "sys_select": ("append", ["select_001.ogg", "select_002.ogg", "select_007.ogg", "select_008.ogg"]),
    "planet_select": ("append", ["bong_001.ogg", "question_001.ogg", "question_002.ogg"]),
    "fleet_select": ("append", ["doorOpen_000.ogg", "doorClose_000.ogg", "doorOpen_001.ogg", "doorClose_001.ogg"]),
    "target_lock": ("append", ["glitch_001.ogg", "glitch_002.ogg", "glitch_003.ogg", "glitch_004.ogg"]),
    "insufficient": ("append", ["error_001.ogg", "error_002.ogg", "error_003.ogg", "error_004.ogg"]),
    "swatch": ("append", ["tick_001.ogg", "tick_002.ogg", "tick_004.ogg"]),
    "build_complete": ("append", ["confirmation_001.ogg", "confirmation_003.ogg"]),
    "research_complete": ("append", ["confirmation_002.ogg", "confirmation_004.ogg"]),
    "ship_complete": ("append", ["confirmation_001.ogg", "confirmation_004.ogg"]),
}


def decode_ogg(zf: zipfile.ZipFile, name: str) -> np.ndarray:
    """Decode one OGG from an open zip to mono 44.1 kHz float samples."""
    if not FFMPEG:
        raise RuntimeError("ffmpeg missing")
    inner = next((n for n in zf.namelist() if n.endswith("/" + name)), None)
    if inner is None:
        raise FileNotFoundError(f"{name} not found in {zf.filename}")
    raw = zf.read(inner)
    proc = subprocess.run(
        [FFMPEG, "-v", "error", "-i", "-", "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        input=raw, stdout=subprocess.PIPE, check=True,
    )
    return np.frombuffer(proc.stdout, dtype="<f4").astype(np.float64)


def write_mono(path: Path, samples: np.ndarray) -> None:
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
    if peak > PEAK:  # peak-normalise instead of clipping (some Kenney files overshoot 1.0)
        samples = samples * (PEAK / peak)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def resolve_zip(which: str, arg: str | None) -> Path:
    env = os.environ.get(f"KENNEY_{which.upper()}_ZIP")
    path = Path(arg or env or DEFAULT_ZIPS[which])
    if not path.exists():
        raise FileNotFoundError(f"Kenney {which} zip not found: {path} (pass --{which} or set KENNEY_{which.upper()}_ZIP)")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sci", help="path to kenney_sci-fi-sounds.zip")
    parser.add_argument("--ui", help="path to kenney_interface-sounds.zip")
    args = parser.parse_args()

    if not MANIFEST.exists():
        print("FAIL: manifest.json missing - run tools/audio/generate.py first")
        return 1
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    SFX.mkdir(parents=True, exist_ok=True)

    zips = {}
    try:
        for which, arg in (("sci", args.sci), ("ui", args.ui)):
            zips[which] = zipfile.ZipFile(resolve_zip(which, arg))
    except (FileNotFoundError, zipfile.BadZipFile) as exc:
        print("FAIL:", exc)
        return 1

    def find_ogg(name: str) -> tuple[zipfile.ZipFile, str]:
        for zf in zips.values():
            if any(n.endswith("/" + name) for n in zf.namelist()):
                return zf, name
        raise FileNotFoundError(f"{name} in neither zip")

    written = 0
    for cue, (mode, names) in MAPPING.items():
        defn = manifest.get("sfx", {}).get(cue)
        if defn is None:
            print(f"FAIL: cue {cue!r} not in manifest")
            return 1
        files: list[str] = []
        for i, name in enumerate(names, start=1):
            zf, ogg = find_ogg(name)
            samples = decode_ogg(zf, ogg)
            if len(samples) == 0:
                print(f"FAIL: {ogg} decoded to zero samples")
                return 1
            out_name = f"{cue}_kenney_{i}.wav"  # contains the cue name (smoke test convention)
            write_mono(SFX / out_name, samples)
            files.append(f"sfx/{out_name}")
            written += 1
        if mode == "replace":
            defn["files"] = files
        else:
            defn["files"] = list(dict.fromkeys(defn["files"] + files))

    # Remove generated SFX files that "replace" made unreferenced, so the
    # audio package stays within audit.py's 20 MiB budget.
    referenced = {
        rel
        for cue in manifest.get("sfx", {}).values()
        for rel in cue.get("files", [])
    }
    removed = 0
    for path in SFX.glob("*.wav"):
        if f"sfx/{path.name}" not in referenced:
            path.unlink()
            removed += 1
    if removed:
        print(f"removed {removed} unreferenced generated sfx files")

    manifest.setdefault("meta", {})["kenneySfx"] = (
        "Kenney Sci-Fi Sounds 1.0 + Interface Sounds 1.0 (CC0, kenney.nl) "
        "via tools/audio/import_kenney.py"
    )
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"kenney variants written: {written}")
    print(f"cues updated: {len(MAPPING)} (replaced: "
          f"{sum(1 for m, _ in MAPPING.values() if m == 'replace')}, "
          f"appended: {sum(1 for m, _ in MAPPING.values() if m == 'append')})")
    print("next: python tools/audio/audit.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
