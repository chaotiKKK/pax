#!/usr/bin/env python3
"""Generate PAX AETERNA's original 16-bit-inspired music and SFX.

The generated music and SFX in public/audio come from this file; the supplied
MP3 drone in music/deep-sub-bass-drones.mp3 is preserved as the ambience
layer of the title music and of every map foundation theme. Running it again recreates byte-identical generated PCM before OGG
encoding.

Usage:
    python tools/audio/generate.py            # generate all assets
    python tools/audio/generate.py --sfx-only # iterate on sound effects

Sound effects then gain Kenney CC0 recordings (see import_kenney.py):
    python tools/audio/import_kenney.py
    python tools/audio/audit.py
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 44_100
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "audio"
MUSIC = OUT / "music"
SFX = OUT / "sfx"
AMBIENCE = "music/deep-sub-bass-drones.mp3"
AMBIENCE_PATH = MUSIC / "deep-sub-bass-drones.mp3"
FFMPEG = shutil.which("ffmpeg")

# ---------------------------------------------------------------------------
# tiny synthesis toolkit
# ---------------------------------------------------------------------------


def hz(midi: float) -> float:
    return 440.0 * (2.0 ** ((midi - 69.0) / 12.0))


def phase(kind: str, freq: float, n: int, duty: float = 0.5) -> np.ndarray:
    t = np.arange(n, dtype=np.float64) / SR
    p = (freq * t) % 1.0
    if kind == "pulse":
        return np.where(p < duty, 1.0, -1.0)
    if kind == "triangle":
        return 1.0 - 4.0 * np.abs(p - 0.5)
    if kind == "saw":
        return 2.0 * p - 1.0
    return np.sin(2.0 * np.pi * p)


def env(n: int, attack: float = 0.008, release: float = 0.08, decay: float = 0.0) -> np.ndarray:
    a = max(1, min(n // 2, int(attack * SR)))
    r = max(1, min(n - a, int(release * SR)))
    e = np.ones(n, dtype=np.float64)
    e[:a] = np.linspace(0.0, 1.0, a, endpoint=False)
    if decay > 0.0:
        e[a : n - r] *= np.exp(-np.linspace(0.0, decay, max(1, n - r - a)))
    e[n - r :] *= np.linspace(1.0, 0.0, r)
    return e


def note(
    midi: float,
    dur: float,
    kind: str = "pulse",
    duty: float = 0.25,
    gain: float = 1.0,
    attack: float = 0.006,
    release: float = 0.06,
    vibrato: float = 0.0,
) -> np.ndarray:
    n = max(4, int(dur * SR))
    t = np.arange(n) / SR
    f = hz(midi)
    if vibrato:
        f *= 1.0 + vibrato * np.sin(2.0 * np.pi * 5.2 * t)
    p = (f * t) % 1.0
    if kind == "pulse":
        w = np.where(p < duty, 1.0, -1.0)
    elif kind == "triangle":
        w = 1.0 - 4.0 * np.abs(p - 0.5)
    elif kind == "saw":
        w = 2.0 * p - 1.0
    else:
        w = np.sin(2.0 * np.pi * p)
    return w * env(n, attack, release) * gain


def noise(dur: float, decay: float = 4.0, smooth: int = 1, seed: int = 0) -> np.ndarray:
    n = max(4, int(dur * SR))
    rng = np.random.default_rng(seed)
    w = rng.uniform(-1.0, 1.0, n)
    if smooth > 1:
        w = np.convolve(w, np.ones(smooth) / smooth, mode="same")
    return w * np.exp(-np.linspace(0.0, decay, n))


def sweep(
    f0: float,
    f1: float,
    dur: float,
    kind: str = "sine",
    gain: float = 1.0,
    attack: float = 0.005,
    release: float = 0.08,
    duty: float = 0.5,
) -> np.ndarray:
    n = max(4, int(dur * SR))
    t = np.arange(n) / SR
    f = np.linspace(f0, f1, n)
    p = (np.cumsum(f) / SR) % 1.0
    if kind == "pulse":
        w = np.where(p < duty, 1.0, -1.0)
    elif kind == "triangle":
        w = 1.0 - 4.0 * np.abs(p - 0.5)
    else:
        w = np.sin(2.0 * np.pi * p)
    return w * env(n, attack, release) * gain


def soft(x: np.ndarray) -> np.ndarray:
    return np.tanh(x * 1.25) / math.tanh(1.25)


def add(buf: np.ndarray, start: float, sig: np.ndarray, gain: float = 1.0, pan: float = 0.0) -> None:
    if len(sig) == 0:
        return
    n = len(buf)
    i = int(round(start * SR)) % n
    end = i + len(sig)
    p = max(-1.0, min(1.0, pan))
    left = math.cos((p + 1.0) * math.pi / 4.0) * gain
    right = math.sin((p + 1.0) * math.pi / 4.0) * gain
    s = sig * 0.5
    if end <= n:
        buf[i:end, 0] += s * left
        buf[i:end, 1] += s * right
    else:
        first = n - i
        buf[i:, 0] += s[:first] * left
        buf[i:, 1] += s[:first] * right
        rest = len(sig) - first
        buf[:rest, 0] += s[first:] * left
        buf[:rest, 1] += s[first:] * right


def echo(buf: np.ndarray, delay: float, feedback: float = 0.25, mix: float = 0.18) -> None:
    d = max(1, int(delay * SR))
    tap = np.roll(buf, d, axis=0) * mix
    tap += np.roll(tap, d, axis=0) * feedback
    buf += tap


def norm_peak(buf: np.ndarray, peak: float = 0.89) -> np.ndarray:
    top = float(np.max(np.abs(buf))) if len(buf) else 1.0
    return buf * (peak / max(1e-9, top))


def write_stereo(path: Path, buf: np.ndarray, peak: float | None = 0.89) -> None:
    data = buf if peak is None else norm_peak(buf, peak)
    data = np.clip(data, -1.0, 1.0)
    pcm = (data * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def write_mono(path: Path, buf: np.ndarray, peak: float = 0.70) -> None:
    data = np.clip(norm_peak(buf, peak), -1.0, 1.0)
    pcm = (data * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def encode_ogg(wav_path: Path, ogg_path: Path) -> None:
    if not FFMPEG:
        raise SystemExit("ffmpeg is required to encode OGG assets")
    subprocess.run(
        [
            FFMPEG,
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(wav_path),
            "-c:a",
            "libvorbis",
            "-q:a",
            "4",
            "-ar",
            str(SR),
            "-ac",
            "2",
            str(ogg_path),
        ],
        check=True,
    )


# ---------------------------------------------------------------------------
# music material
# ---------------------------------------------------------------------------

QUALITY = {
    "min": (0, 3, 7),
    "maj": (0, 4, 7),
    "sus": (0, 5, 7),
    "dim": (0, 3, 6),
}

THEMES: dict[str, dict] = {
    "civic": {
        "bpm": 92,
        "bars": 16,
        "roots": [50, 55, 48, 57],
        "qualities": ["min", "maj", "maj", "min"],
        "scale": [0, 2, 3, 5, 7, 9, 10],
        "lead": [(0, 7, 1.4), (1.5, 9, 0.7), (2.25, 10, 1.2), (4, 7, 0.8), (4.75, 5, 1.4), (6.5, 3, 0.7), (7, 5, 1.4), (8.5, 7, 0.7), (9.25, 10, 1.2), (11, 12, 0.8), (11.75, 10, 1.2), (13, 7, 1.2), (14.25, 5, 1.4)],
        "duty": 0.25,
        "battle": False,
    },
    "hive": {
        "bpm": 84,
        "bars": 16,
        "roots": [45, 46, 45, 43],
        "qualities": ["min", "maj", "min", "maj"],
        "scale": [0, 1, 3, 5, 7, 8, 10],
        "lead": [(0, 7, 2.0), (2.5, 8, 0.8), (3.5, 10, 0.8), (4.5, 7, 1.4), (6.25, 5, 1.2), (8, 3, 1.6), (10, 7, 1.2), (11.5, 10, 0.7), (12.5, 12, 1.5), (14.25, 10, 0.7), (15, 7, 1.4)],
        "duty": 0.125,
        "battle": False,
    },
    "dominion": {
        "bpm": 112,
        "bars": 16,
        "roots": [40, 36, 43, 38],
        "qualities": ["min", "maj", "maj", "maj"],
        "scale": [0, 2, 3, 5, 7, 8, 10],
        "lead": [(0, 0, 0.7), (0.75, 0, 0.45), (1.25, 3, 0.45), (2, 5, 0.9), (3, 7, 0.7), (4, 0, 0.45), (4.5, 3, 0.45), (5, 5, 0.9), (6, 8, 0.7), (7, 7, 0.9), (8.5, 5, 0.7), (9.5, 3, 0.7), (10, 0, 1.2), (12, 3, 0.7), (13, 5, 0.7), (14, 7, 1.4)],
        "duty": 0.5,
        "battle": False,
    },
    "bazaar": {
        "bpm": 104,
        "bars": 16,
        "roots": [43, 48, 45, 50],
        "qualities": ["maj", "maj", "min", "maj"],
        "scale": [0, 2, 4, 6, 7, 9, 11],
        "lead": [(0, 7, 0.6), (0.75, 9, 0.6), (1.5, 11, 0.6), (2.5, 12, 1.0), (4, 9, 0.6), (4.75, 7, 0.6), (5.5, 6, 0.6), (6.5, 4, 1.2), (8, 7, 0.6), (9, 11, 0.6), (10, 14, 1.0), (11.5, 12, 0.6), (12.5, 11, 0.6), (13.5, 9, 0.8), (14.5, 7, 1.2)],
        "duty": 0.125,
        "battle": False,
    },
}

FOUNDATION_TITLE = {
    "civic": "Civic Horizon",
    "hive": "Hive Chorus",
    "dominion": "Iron Dominion",
    "bazaar": "Glass Bazaar",
}

FACTION_THEME = {
    "concord": "civic",
    "ashani": "civic",
    "drell": "civic",
    "tessen": "civic",
    "quorum": "civic",
    "lumen": "civic",
    "vhel": "hive",
    "myrr": "hive",
    "korrath": "dominion",
    "vaal": "dominion",
    "hollis": "dominion",
    "sable": "dominion",
    "verrick": "dominion",
    "sylith": "bazaar",
    "oryx": "bazaar",
    "nyx": "bazaar",
}


def scale_note(root: int, scale: list[int], degree: int) -> int:
    octave, idx = divmod(degree, len(scale))
    return root + 12 * octave + scale[idx]


def chord_notes(root: int, quality: str, octave: int = 1) -> list[int]:
    return [root + 12 * octave + x for x in QUALITY[quality]]


def render_map_stem(theme_id: str, stem: str) -> np.ndarray:
    t = THEMES[theme_id]
    bpm = t["bpm"]
    bars = t["bars"]
    beat = 60.0 / bpm
    duration = bars * 4 * beat
    n = int(duration * SR)
    buf = np.zeros((n, 2), dtype=np.float64)
    roots, quals = t["roots"], t["qualities"]
    scale = t["scale"]

    for bar in range(bars):
        start = bar * 4 * beat
        root = roots[bar % 4]
        qual = quals[bar % 4]
        chord = chord_notes(root, qual)

        if stem == "base":
            # Warm pad; two detuned triangles per chord tone.
            for j, midi in enumerate(chord):
                for detune, pan in ((-0.004, -0.32), (0.004, 0.32)):
                    sig = note(midi, 4.0 * beat, "triangle", gain=0.050, attack=0.32, release=0.55)
                    add(buf, start + j * 0.004, sig, 1.0, pan)
                add(buf, start, note(midi - 12, 4.0 * beat, "sine", gain=0.018, attack=0.4, release=0.5), 1.0, 0.0)
            # Bass on the eighth-note grid.
            for step in range(8):
                midi = root - 12 + (7 if step in (2, 5) else 0)
                add(buf, start + step * 0.5 * beat, note(midi, 0.42 * beat, "triangle", gain=0.16, release=0.05), 1.0, 0.0)
            # Arpeggio; the foundation's color.
            arp = [0, 2, 1, 2, 0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 1]
            for step, ai in enumerate(arp):
                midi = chord[ai % len(chord)] + 12
                add(buf, start + step * 0.25 * beat, note(midi, 0.19 * beat, "pulse", t["duty"], gain=0.036, release=0.03), 1.0, -0.15 + 0.3 * (step % 2))
            # Light hats keep the base alive before the percussion layer enters.
            for step in range(8):
                add(buf, start + step * 0.5 * beat, noise(0.035, 7.0, 2, seed=bar * 19 + step), 0.020, 0.25)

        elif stem == "tension":
            # A high, slowly breathing signal and a low drone. It stays out of
            # the way until the director raises this stem.
            high = scale_note(root, scale, 7) + 12
            add(buf, start, note(high, 4.0 * beat, "pulse", 0.125, gain=0.030, attack=0.5, release=0.7, vibrato=0.002), 1.0, 0.48)
            add(buf, start, note(root - 12, 4.0 * beat, "sine", gain=0.035, attack=0.4, release=0.8), 1.0, 0.0)
            if bar % 4 in (2, 3):
                add(buf, start + 2 * beat, note(high + 1, 2.0 * beat, "triangle", gain=0.022, attack=0.5, release=0.6), 1.0, -0.45)
            if bar % 4 == 3:
                add(buf, start, noise(4.0 * beat, 1.4, 18, seed=bar + 400), 0.016, 0.0)

        else:  # perc
            for step in range(8):
                at = start + step * 0.5 * beat
                if step in (0, 4):
                    add(buf, at, sweep(86, 42, 0.16, "sine", 0.26, release=0.02), 1.0, 0.0)
                if step in (2, 6):
                    add(buf, at, noise(0.13, 6.5, 3, seed=bar * 23 + step), 0.13, -0.08)
                add(buf, at, noise(0.035, 9.0, 2, seed=bar * 31 + step + 7), 0.035, 0.3)

    echo(buf, beat * 0.75, 0.22, 0.11)
    return buf


def render_theme_stems(theme_id: str) -> dict[str, np.ndarray]:
    stems = {s: render_map_stem(theme_id, s) for s in ("base", "tension", "perc")}
    combined = stems["base"] + stems["tension"] + stems["perc"]
    top = float(np.max(np.abs(combined)))
    individual = max(float(np.max(np.abs(v))) for v in stems.values())
    gain = 0.78 / max(1e-9, top, individual)
    return {k: v * gain for k, v in stems.items()}


def render_title() -> np.ndarray:
    # Slow, spacious, 12 bars. No drums; a lone signal over a wide pad.
    bpm = 78
    bars = 12
    beat = 60.0 / bpm
    n = int(bars * 4 * beat * SR)
    buf = np.zeros((n, 2), dtype=np.float64)
    roots = [38, 34, 41, 36]
    quals = ["min", "maj", "maj", "maj"]
    scale = [0, 2, 3, 5, 7, 9, 10]
    for bar in range(bars):
        start = bar * 4 * beat
        root = roots[bar % 4]
        chord = chord_notes(root, quals[bar % 4])
        for j, midi in enumerate(chord):
            for detune, pan in ((-0.004, -0.42), (0.004, 0.42)):
                add(buf, start, note(midi, 4.0 * beat, "triangle", 0.5, 0.065, 0.45, 0.75), 1.0, pan)
            add(buf, start, note(midi - 12, 4.0 * beat, "sine", 0.5, 0.022, 0.6, 0.8), 1.0, 0.0)
        for step in range(4):
            add(buf, start + step * beat, note(root - 12, 0.8 * beat, "triangle", gain=0.10, attack=0.02, release=0.3), 1.0, 0.0)
        if bar % 4 in (0, 2):
            for i, deg in enumerate([7, 9, 10, 7]):
                add(buf, start + (1.0 + i * 0.7) * beat, note(scale_note(root, scale, deg) + 12, 1.0 * beat, "pulse", 0.125, 0.040, 0.02, 0.5), 1.0, -0.35 + i * 0.22)
        if bar % 4 == 3:
            add(buf, start, noise(4.0 * beat, 2.0, 22, seed=bar + 900), 0.010, 0.0)
    echo(buf, beat, 0.26, 0.16)
    return buf


def render_battle_stem(stem: str) -> np.ndarray:
    bpm = 128
    bars = 16
    beat = 60.0 / bpm
    n = int(bars * 4 * beat * SR)
    buf = np.zeros((n, 2), dtype=np.float64)
    roots = [40, 36, 43, 47]
    quals = ["min", "maj", "maj", "min"]
    scale = [0, 2, 3, 5, 7, 8, 10]
    for bar in range(bars):
        start = bar * 4 * beat
        root = roots[bar % 4]
        chord = chord_notes(root, quals[bar % 4])
        if stem == "base":
            for step in range(16):
                add(buf, start + step * 0.25 * beat, note(root - 12 + (7 if step % 4 == 2 else 0), 0.20 * beat, "saw", gain=0.10, release=0.02), 1.0, 0.0)
            for step in range(8):
                at = start + step * 0.5 * beat
                if step in (0, 4):
                    add(buf, at, sweep(95, 42, 0.13, "sine", 0.5), 1.0, 0.0)
                if step in (2, 6):
                    add(buf, at, noise(0.12, 7.0, 2, seed=bar * 37 + step), 0.11, -0.1)
                add(buf, at, noise(0.028, 10.0, 2, seed=bar * 41 + step), 0.04, 0.3)
        else:
            for i, deg in enumerate([0, 0, 3, 5, 7, 5, 3, 0, 0, 3, 5, 8, 7, 5, 3, 2]):
                add(buf, start + i * 0.25 * beat, note(scale_note(root, scale, deg) + 12, 0.20 * beat, "pulse", 0.5, 0.052, 0.003, 0.04), 1.0, 0.25)
            for i in range(4):
                add(buf, start + i * beat, note(chord[2] + 12, 0.9 * beat, "saw", 0.5, 0.018, 0.03, 0.25), 1.0, -0.35)
            for step in (3, 7):
                add(buf, start + step * 0.5 * beat, noise(0.16, 5.0, 1, seed=bar * 61 + step), 0.075, -0.25)
            if bar % 4 == 3:
                add(buf, start + 3.5 * beat, sweep(380, 80, 0.4, "saw", 0.06), 1.0, 0.0)
    echo(buf, beat * 0.5, 0.18, 0.08)
    return buf


def render_battle_stems() -> dict[str, np.ndarray]:
    stems = {"base": render_battle_stem("base"), "assault": render_battle_stem("assault")}
    combined = stems["base"] + stems["assault"]
    top = float(np.max(np.abs(combined)))
    individual = max(float(np.max(np.abs(v))) for v in stems.values())
    gain = 0.78 / max(1e-9, top, individual)
    return {k: v * gain for k, v in stems.items()}


def render_stinger(victory: bool) -> np.ndarray:
    bpm = 108
    bars = 8
    beat = 60.0 / bpm
    n = int(bars * 4 * beat * SR)
    buf = np.zeros((n, 2), dtype=np.float64)
    if victory:
        roots = [50, 55, 47, 45]  # D G B A
        quals = ["maj", "maj", "min", "maj"]
        scale = [0, 2, 4, 5, 7, 9, 11]
        lead = [(0, 0, 2), (2, 4, 2), (4, 7, 2), (6, 9, 2), (8, 12, 4), (12, 9, 2), (14, 7, 2), (16, 4, 4), (20, 7, 2), (22, 9, 2), (24, 12, 8), (32, 7, 4)]
    else:
        roots = [38, 34, 43, 45]  # D Bb G A
        quals = ["min", "maj", "min", "min"]
        scale = [0, 2, 3, 5, 7, 8, 10]
        lead = [(0, 7, 2), (2, 5, 2), (4, 3, 2), (6, 2, 2), (8, 0, 4), (12, -2, 2), (14, -3, 2), (16, -5, 4), (20, 0, 2), (22, 3, 2), (24, 7, 4), (28, 5, 2), (30, 3, 4)]
    for bar in range(bars):
        start = bar * 4 * beat
        root = roots[bar % 4]
        chord = chord_notes(root, quals[bar % 4])
        for midi in chord:
            add(buf, start, note(midi, 4.0 * beat, "triangle", 0.5, 0.06, 0.25, 0.5), 1.0, -0.2)
            add(buf, start, note(midi, 4.0 * beat, "triangle", 0.5, 0.06, 0.25, 0.5), 1.0, 0.2)
        for step in range(8):
            add(buf, start + step * 0.5 * beat, note(root - 12 + (7 if step in (3, 6) else 0), 0.4 * beat, "triangle", gain=0.13, release=0.04), 1.0, 0.0)
        for i in range(4):
            add(buf, start + i * beat, noise(0.06, 8.0, 2, seed=bar * 17 + i), 0.04, 0.2)
    for at, deg, dur in lead:
        midi = scale_note(50 if victory else 38, scale, deg) + 12
        add(buf, at * beat, note(midi, dur * beat, "pulse", 0.25, 0.09, 0.01, 0.12), 1.0, 0.3)
    echo(buf, beat * 0.5, 0.3, 0.18)
    return buf


def render_motif(faction: str) -> np.ndarray:
    theme_id = FACTION_THEME[faction]
    t = THEMES[theme_id]
    rng = np.random.default_rng(sum(ord(c) for c in faction) * 7919)
    bpm = t["bpm"]
    beat = 60.0 / bpm
    bars = 4
    n = int(bars * 4 * beat * SR)
    buf = np.zeros((n, 2), dtype=np.float64)
    root = t["roots"][0]
    qual = t["qualities"][0]
    scale = t["scale"]
    # Each faction gets a contour and a timbre of its own. The contour is
    # deterministic, so the same motif always returns.
    contour = [rng.integers(0, len(scale)) for _ in range(12)]
    contour[0] = 7
    contour[-1] = 0
    start = 0.0
    for i, deg in enumerate(contour):
        dur = 0.5 if i % 3 else 0.75
        midi = scale_note(root, scale, int(deg)) + 12
        duty = [0.125, 0.25, 0.5][sum(ord(c) for c in faction) % 3]
        add(buf, start * beat, note(midi, dur * beat, "pulse", duty, 0.09, 0.008, 0.10), 1.0, -0.25 + (i % 3) * 0.25)
        start += dur
        if start >= 15.0:
            break
    for bar in range(4):
        at = bar * 4 * beat
        for midi in chord_notes(root, qual):
            add(buf, at, note(midi, 4.0 * beat, "triangle", 0.5, 0.035, 0.3, 0.5), 1.0, -0.2)
            add(buf, at, note(midi, 4.0 * beat, "triangle", 0.5, 0.035, 0.3, 0.5), 1.0, 0.2)
        for step in range(8):
            add(buf, at + step * 0.5 * beat, note(root - 12 + (7 if step in (3, 6) else 0), 0.42 * beat, "triangle", gain=0.12, release=0.04), 1.0, 0.0)
        for step in (0, 4):
            add(buf, at + step * 0.5 * beat, noise(0.03, 9.0, 2, seed=bar * 13 + step), 0.022, 0.25)
    echo(buf, beat * 0.75, 0.18, 0.12)
    return buf


def generate_music(sfx_only: bool = False) -> dict:
    manifest: dict = {"version": 1, "music": {}, "motifs": {}, "sfx": {}}
    MUSIC.mkdir(parents=True, exist_ok=True)
    SFX.mkdir(parents=True, exist_ok=True)
    if sfx_only:
        return manifest

    def emit(name: str, buf: np.ndarray, target: float | None = 0.86) -> str:
        wav = MUSIC / f"{name}.wav"
        ogg = MUSIC / f"{name}.ogg"
        write_stereo(wav, buf, target)
        encode_ogg(wav, ogg)
        wav.unlink(missing_ok=True)
        return f"music/{name}.ogg"

    if not AMBIENCE_PATH.exists() or AMBIENCE_PATH.stat().st_size == 0:
        raise SystemExit(f"missing map ambience file: {AMBIENCE_PATH}")

    title = render_title()
    manifest["music"]["title"] = {
        "name": "Deep Sub-Bass Drones",
        "bpm": 78,
        "bars": 12,
        "loop": True,
        "gainDb": -1.0,
        "stems": {"main": emit("title", title), "ambience": AMBIENCE},
    }
    for theme_id, title_name in FOUNDATION_TITLE.items():
        stems = render_theme_stems(theme_id)
        files = {"ambience": AMBIENCE}
        for stem, buf in stems.items():
            files[stem] = emit(f"foundation-{theme_id}-{stem}", buf, None)
        manifest["music"][theme_id] = {
            "name": title_name,
            "bpm": THEMES[theme_id]["bpm"],
            "bars": THEMES[theme_id]["bars"],
            "loop": True,
            "gainDb": 0.0,
            "stems": files,
        }

    battle = render_battle_stems()
    manifest["music"]["battle"] = {
        "name": "Engagement",
        "bpm": 128,
        "bars": 16,
        "loop": True,
        "gainDb": 0.0,
        "stems": {k: emit(f"battle-{k}", v, None) for k, v in battle.items()},
    }
    for kind, victory in (("victory", True), ("defeat", False)):
        manifest["music"][kind] = {
            "file": emit(kind, render_stinger(victory), 0.86),
            "bpm": 108,
            "bars": 8,
            "loop": False,
            "gainDb": -1.0,
        }
    for faction, theme_id in FACTION_THEME.items():
        manifest["motifs"][faction] = {
            "file": emit(f"motif-{faction}", render_motif(faction), 0.82),
            "bpm": THEMES[theme_id]["bpm"],
            "bars": 4,
            "loop": False,
            "gainDb": -2.0,
            "theme": theme_id,
        }
    return manifest


# ---------------------------------------------------------------------------
# sound effects
# ---------------------------------------------------------------------------


def mix(*parts: np.ndarray) -> np.ndarray:
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[: len(p)] += p
    return out


def clank(v: int = 0) -> np.ndarray:
    rng = np.random.default_rng(1200 + v)
    base = sweep(420 + v * 70, 180, 0.18, "saw", 0.16, release=0.03)
    hit = noise(0.12, 8.0, 3, seed=90 + v) * 0.3
    return mix(base, hit)


def click(v: int = 0) -> np.ndarray:
    return mix(
        sweep(1900 + v * 90, 850, 0.045, "pulse", 0.18, release=0.01, duty=0.25),
        noise(0.025, 12.0, 1, seed=10 + v) * 0.05,
    )


def chime(notes: list[int], gap: float = 0.10, dur: float = 0.55, gain: float = 0.18, kind: str = "triangle") -> np.ndarray:
    total = int((gap * (len(notes) - 1) + dur) * SR)
    out = np.zeros(total)
    for i, midi in enumerate(notes):
        at = int(i * gap * SR)
        s = note(midi, dur, kind, 0.5, gain, 0.005, dur * 0.8)
        out[at : at + len(s)] += s[: total - at]
    return out


def impact(kind: str, v: int = 0) -> np.ndarray:
    if kind == "shield":
        return mix(
            sweep(1100 + v * 120, 420, 0.32, "sine", 0.22, release=0.25),
            noise(0.28, 5.0, 6, seed=70 + v) * 0.18,
        )
    return mix(
        sweep(180 + v * 20, 55, 0.32, "sine", 0.28, release=0.2),
        noise(0.32, 4.0, 5, seed=80 + v) * 0.25,
    )


def explosion(v: int = 0) -> np.ndarray:
    return mix(
        noise(1.5, 2.7, 14, seed=200 + v) * 0.45,
        sweep(110, 28, 1.2, "sine", 0.34, release=0.8),
        noise(0.5, 5.0, 2, seed=210 + v) * 0.18,
    )


def sfx_defs() -> dict[str, tuple[callable, int, str, float, int]]:
    return {
        # UI
        "ui_click": (lambda v: click(v), 2, "ui", -14.0, 28),
        "ui_tab": (lambda v: chime([74 + v, 79], 0.06, 0.25, 0.10, "pulse"), 1, "ui", -13.0, 40),
        "ui_open": (lambda v: sweep(320, 900, 0.26, "triangle", 0.12), 1, "ui", -12.0, 0),
        "ui_close": (lambda v: sweep(760, 260, 0.22, "triangle", 0.11), 1, "ui", -12.0, 0),
        "ui_confirm": (lambda v: chime([67, 74, 79], 0.08, 0.48, 0.14, "triangle"), 1, "ui", -11.0, 0),
        "ui_deny": (lambda v: mix(sweep(160, 120, 0.18, "saw", 0.10), sweep(240, 170, 0.18, "pulse", 0.06)), 1, "ui", -11.0, 0),
        "ui_toggle_on": (lambda v: chime([72, 79], 0.07, 0.34, 0.12), 1, "ui", -12.0, 0),
        "ui_toggle_off": (lambda v: chime([79, 72], 0.07, 0.34, 0.11), 1, "ui", -12.0, 0),
        # map / cycle
        "sys_select": (lambda v: mix(note(84, 0.55, "sine", 0.5, 0.13, 0.005, 0.5), note(91, 0.35, "triangle", 0.5, 0.05, 0.005, 0.3)), 1, "sfx", -11.0, 0),
        "planet_select": (lambda v: chime([81, 88], 0.05, 0.42, 0.12, "sine"), 1, "sfx", -11.0, 0),
        "fleet_select": (lambda v: mix(clank(v), note(52, 0.25, "triangle", 0.5, 0.1)), 1, "sfx", -10.0, 0),
        "target_lock": (lambda v: chime([76, 76, 88], 0.10, 0.20, 0.10, "pulse"), 1, "sfx", -9.0, 0),
        "move_order": (lambda v: mix(sweep(220, 1100, 0.55, "triangle", 0.11), noise(0.45, 3.0, 8, seed=300 + v) * 0.08), 1, "sfx", -10.0, 0),
        "cycle_sweep": (lambda v: mix(sweep(90, 1400, 1.35, "sine", 0.13, 0.02, 0.35), noise(1.35, 2.0, 16, seed=310 + v) * 0.12), 1, "sfx", -9.0, 0),
        "cycle_stamp": (lambda v: mix(sweep(100, 34, 0.55, "sine", 0.28, 0.002, 0.35), noise(0.32, 4.2, 4, seed=320 + v) * 0.16), 1, "sfx", -6.0, 0),
        # economy / research
        "build_queue": (lambda v: mix(clank(v), chime([64, 71], 0.06, 0.22, 0.09)), 1, "sfx", -9.0, 0),
        "build_complete": (lambda v: chime([64, 67, 71, 76], 0.06, 0.65, 0.12, "triangle"), 1, "sfx", -8.0, 0),
        "ship_queue": (lambda v: mix(clank(v + 2), sweep(140, 80, 0.35, "saw", 0.10)), 1, "sfx", -9.0, 0),
        "ship_complete": (lambda v: chime([59, 64, 67, 71], 0.07, 0.75, 0.13, "pulse"), 1, "sfx", -8.0, 0),
        "research_start": (lambda v: sweep(420, 760, 0.35, "pulse", 0.09, duty=0.25), 1, "sfx", -10.0, 0),
        "research_complete": (lambda v: chime([67, 74, 79, 86], 0.07, 0.7, 0.12, "pulse"), 1, "sfx", -8.0, 0),
        "colonize": (lambda v: mix(sweep(90, 40, 0.7, "sine", 0.25), chime([64, 71, 76], 0.09, 0.8, 0.10), noise(0.7, 2.5, 10, seed=330 + v) * 0.10), 1, "sfx", -8.0, 0),
        "insufficient": (lambda v: mix(sweep(130, 100, 0.20, "saw", 0.09), sweep(130, 100, 0.20, "saw", 0.09)), 1, "sfx", -11.0, 0),
        # diplomacy
        "diplo_gift": (lambda v: chime([79, 84, 91], 0.06, 0.55, 0.11, "sine"), 1, "sfx", -9.0, 0),
        "diplo_pact": (lambda v: chime([69, 74], 0.10, 0.55, 0.11, "triangle"), 1, "sfx", -9.0, 0),
        "diplo_alliance": (lambda v: chime([64, 69, 72, 76], 0.08, 0.85, 0.12, "triangle"), 1, "sfx", -8.0, 0),
        "diplo_war": (lambda v: mix(sweep(180, 55, 0.6, "saw", 0.16), sweep(270, 60, 0.6, "saw", 0.10), noise(0.6, 3.0, 5, seed=340 + v) * 0.18), 1, "sfx", -7.0, 0),
        "diplo_peace": (lambda v: chime([62, 67, 74], 0.11, 0.85, 0.10, "sine"), 1, "sfx", -9.0, 0),
        "diplo_reject": (lambda v: mix(sweep(190, 110, 0.35, "saw", 0.10), sweep(95, 70, 0.35, "sine", 0.12)), 1, "sfx", -9.0, 0),
        # battle
        "battle_alarm": (lambda v: mix(sweep(300, 700, 0.55, "pulse", 0.12, duty=0.5), sweep(300, 700, 0.55, "pulse", 0.12, duty=0.5)), 1, "sfx", -7.0, 0),
        "battle_retreat": (lambda v: mix(sweep(620, 120, 1.1, "triangle", 0.13), noise(1.0, 2.5, 12, seed=350 + v) * 0.12), 1, "sfx", -8.0, 0),
        "weapon_pulse": (lambda v: sweep(1500 + v * 260, 240, 0.22, "pulse", 0.15, release=0.10, duty=0.25), 2, "sfx", -8.0, 65),
        "weapon_kinetic": (lambda v: mix(sweep(190, 45, 0.24, "sine", 0.25), noise(0.16, 7.0, 2, seed=360 + v) * 0.18), 2, "sfx", -6.0, 70),
        "weapon_missile": (lambda v: mix(sweep(300, 1600, 0.35, "sine", 0.08), noise(0.35, 2.0, 4, seed=370 + v) * 0.10, sweep(100, 30, 0.7, "sine", 0.18)), 2, "sfx", -6.0, 90),
        "impact_shield": (lambda v: impact("shield", v), 2, "sfx", -7.0, 55),
        "impact_hull": (lambda v: impact("hull", v), 2, "sfx", -5.0, 55),
        "explosion_small": (lambda v: explosion(v) * 0.65, 2, "sfx", -5.0, 120),
        "explosion_large": (lambda v: explosion(v), 2, "sfx", -3.0, 180),
        # LAN
        "lan_join": (lambda v: chime([72, 79, 84], 0.08, 0.55, 0.11), 1, "ui", -10.0, 0),
        "lan_ready": (lambda v: chime([76, 83], 0.08, 0.45, 0.11), 1, "ui", -10.0, 0),
        "chat_in": (lambda v: chime([84, 88], 0.05, 0.22, 0.08, "sine"), 1, "ui", -13.0, 0),
        "disconnect": (lambda v: mix(sweep(600, 100, 0.7, "triangle", 0.11), noise(0.5, 3.0, 6, seed=380 + v) * 0.06), 1, "ui", -9.0, 0),
        # identity
        "swatch": (lambda v: mix(click(v), note(88, 0.12, "sine", 0.5, 0.07)), 1, "ui", -13.0, 30),
        "crest": (lambda v: chime([76, 83, 88, 95], 0.05, 0.45, 0.08, "triangle"), 1, "ui", -11.0, 0),
        "apply": (lambda v: chime([67, 72, 76, 79], 0.06, 0.65, 0.11), 1, "ui", -10.0, 0),
    }


def generate_sfx() -> dict:
    SFX.mkdir(parents=True, exist_ok=True)
    out: dict[str, dict] = {}
    for cue, (fn, count, bus, gain_db, cooldown) in sfx_defs().items():
        files = []
        for v in range(count):
            buf = np.asarray(fn(v), dtype=np.float64)
            name = f"{cue}.wav" if count == 1 else f"{cue}_{v + 1}.wav"
            path = SFX / name
            write_mono(path, soft(buf), 0.70)
            files.append(f"sfx/{name}")
        out[cue] = {"files": files, "bus": bus, "gainDb": gain_db, "cooldownMs": cooldown}
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sfx-only", action="store_true")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = generate_music(args.sfx_only)
    if not args.sfx_only:
        manifest["sfx"] = generate_sfx()
    manifest["meta"] = {
        "generator": "tools/audio/generate.py",
        "sampleRate": SR,
        "music": "OGG Vorbis q4, 44.1 kHz stereo; supplied MP3 ambience, 48 kHz stereo",
        "sfx": "WAV PCM 16-bit mono",
        "original": False,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    music_count = len(manifest.get("music", {}))
    motif_count = len(manifest.get("motifs", {}))
    sfx_count = len(manifest.get("sfx", {}))
    print(f"music tracks: {music_count}, motifs: {motif_count}, sfx cues: {sfx_count}")
    print(f"output: {OUT}")


if __name__ == "__main__":
    main()
