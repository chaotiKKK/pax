#!/usr/bin/env python3
"""Validate the generated audio package without changing it."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

SR = 44_100
ROOT = Path(__file__).resolve().parents[2]
AUDIO = ROOT / "public" / "audio"
MANIFEST = AUDIO / "manifest.json"
FFMPEG = shutil.which("ffmpeg")


def decode_ogg(path: Path) -> np.ndarray:
    if not FFMPEG:
        raise RuntimeError("ffmpeg missing")
    raw = subprocess.run(
        [FFMPEG, "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        check=True,
        stdout=subprocess.PIPE,
    ).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2)


def wav_info(path: Path) -> tuple[int, int, int]:
    with wave.open(str(path), "rb") as w:
        return w.getframerate(), w.getnchannels(), w.getnframes()


def main() -> int:
    if not MANIFEST.exists():
        print("FAIL: manifest.json missing")
        return 1
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    errors: list[str] = []
    music_files: list[Path] = []
    sfx_files: list[Path] = []

    for key, track in data.get("music", {}).items():
        files = list((track.get("stems") or {}).values())
        if track.get("file"):
            files.append(track["file"])
        for rel in files:
            path = AUDIO / rel
            if not path.exists() or path.stat().st_size == 0:
                errors.append(f"music {key}: missing {rel}")
            else:
                music_files.append(path)

    for key, motif in data.get("motifs", {}).items():
        path = AUDIO / motif["file"]
        if not path.exists() or path.stat().st_size == 0:
            errors.append(f"motif {key}: missing {motif['file']}")
        else:
            music_files.append(path)

    for key, cue in data.get("sfx", {}).items():
        for rel in cue.get("files", []):
            path = AUDIO / rel
            if not path.exists() or path.stat().st_size == 0:
                errors.append(f"sfx {key}: missing {rel}")
                continue
            try:
                rate, channels, frames = wav_info(path)
            except wave.Error as exc:
                errors.append(f"sfx {key}: invalid WAV ({exc})")
                continue
            if rate != SR or channels != 1 or frames <= 0:
                errors.append(f"sfx {key}: unexpected format {rate}Hz/{channels}ch/{frames}f")
            sfx_files.append(path)

    if not FFMPEG:
        errors.append("ffmpeg missing; OGG files cannot be inspected")
    else:
        seams: list[tuple[float, str]] = []
        peaks: list[tuple[float, str]] = []
        for path in music_files:
            try:
                samples = decode_ogg(path)
            except subprocess.CalledProcessError:
                errors.append(f"music: cannot decode {path.name}")
                continue
            peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
            if peak > 1.0:
                errors.append(f"music: clipping {path.name} peak {peak:.3f}")
            if len(samples) > 2:
                seam = float(np.max(np.abs(samples[0] - samples[-1])))
                seams.append((seam, path.name))
            peaks.append((peak, path.name))
        seams.sort(reverse=True)
        peaks.sort(reverse=True)
        print("music files:", len(music_files))
        print("highest peaks:", ", ".join(f"{name} {value:.3f}" for value, name in peaks[:4]))
        print("largest loop seams:", ", ".join(f"{name} {value:.3f}" for value, name in seams[:4]))
        if any(value > 0.25 for value, _ in seams):
            errors.append("loop seam exceeds 0.25 on at least one music file")
        if any(value > 0.999 for value, _ in peaks):
            errors.append("music peak reaches full scale")

    total = sum(p.stat().st_size for p in AUDIO.rglob("*") if p.is_file())
    print(f"sfx files: {len(sfx_files)}")
    print(f"package: {total / 1024 / 1024:.2f} MiB")
    if total > 20 * 1024 * 1024:
        errors.append("audio package exceeds 20 MiB")

    if errors:
        for error in errors:
            print("FAIL:", error)
        return 1
    print("OK: manifest, formats, levels and package size are valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
