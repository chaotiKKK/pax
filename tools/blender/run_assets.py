"""Locate the local Blender 5.x install and run the asset foundry headless."""
import glob
import os
import subprocess
import sys

CANDIDATES = [
    r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 5.0\blender.exe",
]
CANDIDATES += sorted(glob.glob(r"C:\Program Files\Blender Foundation\Blender *\blender.exe"), reverse=True)

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "build_assets.py")


def find_blender():
    for c in CANDIDATES:
        if os.path.isfile(c):
            return c
    for c in sorted(glob.glob(r"C:\Program Files\*\blender.exe")):
        return c
    return None


def main():
    blender = find_blender()
    if not blender:
        print("Blender nicht gefunden. Bitte Pfad in tools/blender/run_assets.py eintragen.")
        return 1
    print("Blender:", blender)
    cmd = [blender, "-b", "--factory-startup", "-P", SCRIPT]
    return subprocess.call(cmd)


if __name__ == "__main__":
    sys.exit(main())
