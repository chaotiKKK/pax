"""
PAX AETERNA — procedural capital-ship foundry for Blender 5.x
=============================================================
Builds all thirteen class hulls from primitives, kits them with plating,
greebles, radiators, turrets and emissive engine blocks, then exports
GLB (Y-up, +Y forward in Blender -> -Z forward in three.js) plus a
studio render per hull for review.

Run:  blender -b -P tools/blender/build_assets.py
"""

import bpy
import math
import os
import random
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT_MODELS = os.path.join(ROOT, "public", "assets", "models")
OUT_RENDER = os.path.join(ROOT, "art", "renders")
os.makedirs(OUT_MODELS, exist_ok=True)
os.makedirs(OUT_RENDER, exist_ok=True)

# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------
MATS = {}


def mat(name, color, metallic=0.9, rough=0.35, emit=None, strength=0.0, alpha=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if "Alpha" in b.inputs:
        b.inputs["Alpha"].default_value = alpha
    if emit is not None:
        for key in ("Emission Color", "Emission"):
            if key in b.inputs:
                b.inputs[key].default_value = (*emit, 1.0)
                break
        if "Emission Strength" in b.inputs:
            b.inputs["Emission Strength"].default_value = strength
    MATS[name] = m
    return m


HULL_DARK = None
HULL_MID = None
HULL_LIGHT = None
TRIM = None
ACCENT = None
GLOW = None
ENGINE = None
GLASS = None

PARTS = []


def init_materials():
    """Must run after the factory reset: Blender invalidates datablocks on reset."""
    global HULL_DARK, HULL_MID, HULL_LIGHT, TRIM, ACCENT, GLOW, ENGINE, GLASS
    MATS.clear()
    HULL_DARK = mat("Hull_Dark", (0.030, 0.034, 0.045), 0.95, 0.36)
    HULL_MID = mat("Hull_Mid", (0.085, 0.094, 0.115), 0.92, 0.30)
    HULL_LIGHT = mat("Hull_Light", (0.230, 0.240, 0.265), 0.88, 0.24)
    TRIM = mat("Trim_Brass", (0.520, 0.395, 0.190), 1.0, 0.28)
    ACCENT = mat("Accent", (0.620, 0.240, 0.050), 0.55, 0.32, (1.0, 0.45, 0.10), 3.0)
    GLOW = mat("Glow", (0.70, 0.93, 1.0), 0.0, 0.12, (0.65, 0.90, 1.0), 16.0)
    ENGINE = mat("Engine", (0.25, 0.60, 0.95), 0.0, 0.10, (0.35, 0.72, 1.0), 26.0)
    GLASS = mat("Viewport", (0.010, 0.030, 0.050), 0.7, 0.06, (0.20, 0.55, 0.70), 1.6)


# --------------------------------------------------------------------------
# primitive helpers — everything is anchored in absolute coordinates so the
# bevel widths stay physically meaningful after joining
# --------------------------------------------------------------------------
def _shade(o):
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(38))
    except Exception:
        try:
            bpy.ops.object.shade_smooth()
        except Exception:
            pass


def _register(o, material, bevel, segments):
    if material is not None:
        o.data.materials.append(material)
    if bevel and bevel > 0:
        m = o.modifiers.new("bev", 'BEVEL')
        dims = o.dimensions
        m.width = min(bevel, max(0.004, min(dims) * 0.38))
        m.segments = segments
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(40)
    _shade(o)
    PARTS.append(o)
    return o


def box(name, loc, size, material=HULL_MID, bevel=0.06, seg=2, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _register(o, material, bevel, seg)


def cyl(name, loc, radius, depth, material=HULL_MID, rot=(0, 0, 0), verts=24, bevel=0.03):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot
    )
    o = bpy.context.object
    o.name = name
    return _register(o, material, bevel, 2)


def cone(name, loc, r1, r2, depth, material=HULL_MID, rot=(0, 0, 0), verts=6, bevel=0.02):
    bpy.ops.mesh.primitive_cone_add(
        vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot
    )
    o = bpy.context.object
    o.name = name
    return _register(o, material, bevel, 2)


def sphere(name, loc, radius, material=HULL_MID, segments=24, rings=14):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=radius, location=loc
    )
    o = bpy.context.object
    o.name = name
    return _register(o, material, 0.0, 0)


def torus(name, loc, major, minor, material=HULL_MID, rot=(0, 0, 0), maj_seg=48, min_seg=12):
    bpy.ops.mesh.primitive_torus_add(
        location=loc, rotation=rot, major_radius=major, minor_radius=minor,
        major_segments=maj_seg, minor_segments=min_seg,
    )
    o = bpy.context.object
    o.name = name
    return _register(o, material, 0.02, 2)


# --------------------------------------------------------------------------
# detailing helpers
# --------------------------------------------------------------------------
def plating(count, y0, y1, half_x, ztop, seed=1, mat_=HULL_MID, scale=1.0):
    """Thin raised armour plates scattered across the dorsal hull."""
    rnd = random.Random(seed)
    for i in range(count):
        y = rnd.uniform(y0, y1)
        x = rnd.uniform(-half_x, half_x)
        w = rnd.uniform(0.6, 2.4) * scale
        h = rnd.uniform(0.5, 3.0) * scale
        box("plate_%d" % i, (x, y, ztop + 0.04 * scale), (w, h, 0.09 * scale),
            mat_, bevel=0.02 * scale, seg=1)


def windows(y0, y1, x, z, rows=1, count=8, width=0.55, gap=1.1, seed=3):
    """Row(s) of tiny emissive viewports — reads as scale at any distance."""
    rnd = random.Random(seed)
    for r in range(rows):
        for i in range(count):
            y = y0 + (y1 - y0) * (i / max(1, count - 1)) + rnd.uniform(-0.08, 0.08)
            box("win_%d_%d" % (r, i), (x, y, z + r * 0.55), (0.07, width, 0.14),
                GLASS, bevel=0.0, seg=1)


def engine_bank(y, z, count, spread, radius, length, glow_scale=1.0):
    for i in range(count):
        x = (i - (count - 1) / 2) * spread
        cyl("nozzle_%d" % i, (x, y, z), radius, length, HULL_LIGHT, rot=(math.pi / 2, 0, 0), verts=20)
        cyl("bell_%d" % i, (x, y - length * 0.62, z), radius * 0.78, length * 0.34,
            HULL_DARK, rot=(math.pi / 2, 0, 0), verts=20)
        cyl("thrust_%d" % i, (x, y - length * 0.70, z), radius * 0.62 * glow_scale, 0.12,
            ENGINE, rot=(math.pi / 2, 0, 0), verts=20, bevel=0.0)
        box("mount_%d" % i, (x, y + length * 0.55, z), (radius * 2.2, length * 0.5, radius * 2.0),
            HULL_MID, bevel=0.05)


def turret(y, z, x=0.0, scale=1.0):
    cyl("turret_base", (x, y, z), 0.85 * scale, 0.34 * scale, HULL_LIGHT, verts=16)
    box("turret_house", (x, y, z + 0.45 * scale), (1.3 * scale, 1.5 * scale, 0.6 * scale),
        HULL_MID, bevel=0.05 * scale)
    for s in (-1, 1):
        cyl("barrel_%d" % s, (x + s * 0.32 * scale, y + 1.15 * scale, z + 0.45 * scale),
            0.10 * scale, 2.0 * scale, HULL_LIGHT, rot=(math.pi / 2, 0, 0), verts=10, bevel=0.0)


def fin(y, z, x, span, sweep, height=0.14, mat_=HULL_MID):
    rot = (0, math.radians(90), math.radians(sweep))
    box("fin", (x, y, z), (span, 3.2, height), mat_, bevel=0.04, rot=(0, 0, 0))
    box("fin_edge", (x + span * 0.46, y + 0.2, z), (0.16, 3.4, height * 1.4), TRIM, bevel=0.02)


def stripe(y0, y1, x, z, thickness=0.16, height=0.46):
    """Faction-band running along the hull — recoloured per empire in-engine."""
    box("stripe", (x, (y0 + y1) / 2, z), (thickness, abs(y1 - y0), height), ACCENT, bevel=0.02)


def radiator(y, z, x, span, height=4.0):
    box("radiator", (x, y, z), (span, 0.12, height), HULL_DARK, bevel=0.02)
    for i in range(4):
        box("rad_fin_%d" % i, (x, y, z - height / 2 + (i + 0.5) * height / 4),
            (span * 0.94, 0.16, 0.10), TRIM, bevel=0.0)


def join_all(name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in PARTS:
        o.select_set(True)
    bpy.context.view_layer.objects.active = PARTS[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name
    obj.data.name = "%s_mesh" % name
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    PARTS.clear()
    return obj


# --------------------------------------------------------------------------
# hulls
# --------------------------------------------------------------------------
def build_scout():
    box("scout_core", (0, 0, 0), (1.9, 7.0, 1.5), HULL_MID, bevel=0.16)
    cone("scout_nose", (0, 5.4, 0.05), 1.05, 0.10, 4.2, HULL_LIGHT, rot=(-math.pi / 2, 0, 0), verts=6)
    box("scout_spine", (0, 0.4, 0.86), (0.5, 5.4, 0.28), TRIM, bevel=0.03)
    sphere("scout_cockpit", (0, 3.0, 0.62), 0.72, GLASS, 20, 12)
    for s in (-1, 1):
        box("scout_wing", (s * 1.55, -0.6, -0.1), (1.5, 3.4, 0.13), HULL_MID,
            bevel=0.04, rot=(0, 0, math.radians(-8 * s)))
        box("scout_wing_tip", (s * 2.35, -1.5, -0.1), (0.22, 1.7, 0.30), ACCENT, bevel=0.02)
        cyl("scout_probe", (s * 0.55, 3.3, -0.72), 0.10, 2.2, HULL_LIGHT,
            rot=(math.pi / 2, 0, 0), verts=8, bevel=0.0)
    engine_bank(-3.9, 0.0, 2, 1.05, 0.42, 1.5, 1.0)
    windows(-1.6, 1.4, 0.96, 0.42, rows=1, count=5, width=0.34, seed=11)
    for s in (-1, 1):
        box("scout_vent", (s * 0.9, -2.2, 0.55), (0.18, 1.6, 0.30), ACCENT, bevel=0.02)
    return join_all("scout")


def build_corvette():
    box("cor_core", (0, -0.4, 0), (3.6, 13.0, 2.1), HULL_MID, bevel=0.22)
    cone("cor_prow", (0, 7.6, 0.1), 1.85, 0.28, 5.6, HULL_LIGHT, rot=(-math.pi / 2, 0, 0), verts=5)
    box("cor_deck", (0, 1.2, 1.15), (2.2, 7.4, 0.55), HULL_MID, bevel=0.08)
    box("cor_keel", (0, -0.8, -1.25), (2.6, 9.0, 0.55), HULL_DARK, bevel=0.08)
    for s in (-1, 1):
        box("cor_arm", (s * 2.55, -1.6, 0.1), (1.9, 8.2, 0.55), HULL_MID, bevel=0.1)
        box("cor_arm_trim", (s * 2.55, 2.3, 0.42), (1.5, 1.5, 0.22), ACCENT, bevel=0.03)
        cyl("cor_gun", (s * 2.55, 4.6, 0.1), 0.16, 4.2, HULL_LIGHT,
            rot=(math.pi / 2, 0, 0), verts=10, bevel=0.0)
        box("cor_intake", (s * 2.1, -5.2, 0.15), (0.4, 2.2, 1.0), HULL_DARK, bevel=0.03)
        fin(-2.0, 0.1, s * 3.9, 1.5, 0)
    turret(0.2, 1.62, 0, 0.9)
    turret(-5.0, -1.75, 0, 0.8)
    windows(-3.4, 4.0, 1.82, 0.5, rows=2, count=7, width=0.5, seed=21)
    windows(-3.4, 4.0, -1.82, 0.5, rows=2, count=7, width=0.5, seed=22)
    engine_bank(-7.1, 0.0, 3, 1.35, 0.62, 2.2, 1.0)
    return join_all("corvette")


def build_cruiser():
    box("cru_spine", (0, -1.0, 0), (4.2, 30.0, 2.6), HULL_MID, bevel=0.3)
    cone("cru_prow", (0, 17.6, 0.0), 2.2, 0.35, 8.0, HULL_LIGHT, rot=(-math.pi / 2, 0, 0), verts=6)
    box("cru_foredeck", (0, 6.2, 1.6), (7.4, 13.0, 1.5), HULL_MID, bevel=0.16)
    box("cru_foredeck_2", (0, 9.4, 2.6), (5.0, 6.4, 0.9), HULL_MID, bevel=0.1)
    box("cru_aft", (0, -12.5, -0.2), (8.6, 9.6, 3.4), HULL_MID, bevel=0.2)
    box("cru_bridge", (0, 12.4, 3.3), (2.6, 4.0, 1.5), HULL_LIGHT, bevel=0.1)
    box("cru_bridge_glass", (0, 14.2, 3.6), (1.9, 0.3, 0.6), GLASS, bevel=0.02)
    cyl("cru_mast", (0, 10.6, 4.6), 0.14, 4.2, TRIM, verts=10, bevel=0.0)
    sphere("cru_beacon", (0, 10.6, 6.75), 0.22, GLOW, 14, 10)

    for s in (-1, 1):
        box("cru_side", (s * 5.1, -1.0, 0.1), (3.6, 20.0, 1.9), HULL_MID, bevel=0.16)
        box("cru_side_trim", (s * 5.2, 7.0, 0.2), (2.4, 3.0, 1.1), ACCENT, bevel=0.05)
        box("cru_side_vent", (s * 5.15, -9.0, 0.2), (2.0, 4.0, 0.9), HULL_DARK, bevel=0.05)
        # sponson pod with a heavy lance
        cyl("cru_pod", (s * 7.6, 2.0, -0.3), 1.05, 7.2, HULL_MID,
            rot=(math.pi / 2, 0, 0), verts=18)
        cyl("cru_lance", (s * 7.6, 7.4, -0.3), 0.36, 6.4, HULL_LIGHT,
            rot=(math.pi / 2, 0, 0), verts=14)
        cyl("cru_lance_core", (s * 7.6, 10.4, -0.3), 0.18, 0.6, ACCENT,
            rot=(math.pi / 2, 0, 0), verts=12, bevel=0.0)
        radiator(-14.0, 0.0, s * 6.4, 1.4, 7.0)
        box("cru_pylon", (s * 6.6, -8.0, 0.0), (2.4, 1.2, 0.9), HULL_LIGHT, bevel=0.06)

    for i in range(3):
        turret(4.0 + i * 5.2, 2.45, -2.3, 1.05)
        turret(1.6 + i * 5.2, 2.45, 2.3, 1.05)
    turret(-9.0, -1.85, 0, 1.2)

    windows(-11.0, 10.0, 3.75, 1.2, rows=2, count=10, width=0.55, seed=31)
    windows(-11.0, 10.0, -3.75, 1.2, rows=2, count=10, width=0.55, seed=32)
    stripe(-14.0, 14.0, 2.18, 0.55)
    stripe(-14.0, 14.0, -2.18, 0.55)
    plating(28, -13.0, 13.0, 3.0, 1.42, seed=33, scale=1.2)
    engine_bank(-17.6, -0.2, 4, 1.9, 0.85, 2.8, 1.0)
    engine_bank(-16.9, 2.6, 2, 2.4, 0.55, 2.0, 1.0)
    return join_all("cruiser")


def build_dreadnought():
    box("dr_spine", (0, -2.0, 0), (7.0, 58.0, 4.4), HULL_MID, bevel=0.45)
    cone("dr_prow", (0, 33.0, 0.0), 3.6, 0.5, 12.0, HULL_LIGHT, rot=(-math.pi / 2, 0, 0), verts=8)
    box("dr_proora_armor", (0, 24.0, 2.4), (10.0, 16.0, 2.0), HULL_MID, bevel=0.24)
    box("dr_command", (0, 12.0, 3.6), (13.0, 14.0, 3.0), HULL_MID, bevel=0.2)
    box("dr_keep", (0, 13.0, 6.4), (7.0, 8.0, 2.6), HULL_LIGHT, bevel=0.14)
    box("dr_cathedral", (0, 14.4, 8.6), (3.4, 4.6, 2.0), HULL_MID, bevel=0.12)
    cyl("dr_spire", (0, 16.2, 10.6), 0.5, 4.4, TRIM, verts=8)
    cone("dr_spire_tip", (0, 16.2, 13.3), 0.5, 0.02, 1.8, TRIM, verts=8)
    sphere("dr_beacon", (0, 16.2, 14.6), 0.34, GLOW, 14, 10)

    # armoured ribs down the spine — the ship's signature silhouette
    for i in range(9):
        y = -24.0 + i * 4.6
        box("dr_rib_%d" % i, (0, y, 2.3), (9.6 - abs(i - 4) * 0.25, 0.9, 1.5), HULL_DARK, bevel=0.06)
        box("dr_rib_trim_%d" % i, (0, y, 3.05), (7.4 - abs(i - 4) * 0.2, 0.4, 0.3), TRIM, bevel=0.0)

    for s in (-1, 1):
        # outrigger wing with twin spinal cannons
        box("dr_wing", (s * 8.4, -2.0, 0.2), (9.0, 34.0, 2.0), HULL_MID, bevel=0.24)
        box("dr_wing_edge", (s * 12.6, -2.0, 0.2), (1.0, 32.0, 1.3), HULL_DARK, bevel=0.06)
        box("dr_wing_accent", (s * 8.4, 10.0, 1.35), (6.0, 5.0, 0.5), ACCENT, bevel=0.05)
        for k in (-1, 1):
            cyl("dr_cannon_%d" % k, (s * (12.4 + k * 0.0), 18.0, 0.2 + k * 0.9), 0.62, 16.0,
                HULL_LIGHT, rot=(math.pi / 2, 0, 0), verts=16)
            cyl("dr_cannon_muzzle_%d" % k, (s * 12.4, 26.4, 0.2 + k * 0.9), 0.40, 1.2,
                ACCENT, rot=(math.pi / 2, 0, 0), verts=14, bevel=0.0)
        # engine nacelle blocks
        box("dr_nacelle", (s * 6.4, -26.0, -0.4), (5.2, 12.0, 4.0), HULL_MID, bevel=0.18)
        radiator(-31.0, 0.4, s * 9.6, 1.6, 9.0)
        radiator(-24.0, 2.4, s * 11.2, 1.2, 6.0)
        fin(-18.0, 3.0, s * 4.6, 2.2, 0)
        for i in range(4):
            turret(6.0 - i * 7.0, 4.1, s * 4.2, 1.15)
        box("dr_side_armor", (s * 4.4, -6.0, -2.4), (1.6, 22.0, 1.2), HULL_DARK, bevel=0.08)

    turret(28.0, 1.2, 0, 1.4)
    turret(21.0, 3.6, -4.6, 1.1)
    turret(21.0, 3.6, 4.6, 1.1)

    windows(-22.0, 22.0, 6.55, 2.2, rows=2, count=16, width=0.7, seed=41)
    windows(-22.0, 22.0, -6.55, 2.2, rows=2, count=16, width=0.7, seed=42)
    stripe(-27.0, 26.0, 3.62, 1.4, 0.2, 0.62)
    stripe(-27.0, 26.0, -3.62, 1.4, 0.2, 0.62)
    windows(10.0, 18.0, 0, 12.2, rows=1, count=5, width=0.8, seed=43)
    plating(44, -26.0, 26.0, 5.6, 2.22, seed=44, scale=1.6)
    engine_bank(-33.6, -0.4, 3, 3.2, 1.35, 3.6, 1.0)
    engine_bank(-33.0, 2.9, 2, 4.0, 0.9, 2.8, 1.0)
    return join_all("dreadnought")


def build_ark():
    cyl("ark_hull", (0, 0, 0), 6.2, 34.0, HULL_MID, rot=(math.pi / 2, 0, 0), verts=32)
    cone("ark_nose", (0, 20.0, 0), 6.2, 2.0, 6.0, HULL_LIGHT, rot=(-math.pi / 2, 0, 0), verts=24)
    cyl("ark_nose_cap", (0, 23.4, 0), 2.0, 1.2, HULL_DARK, rot=(math.pi / 2, 0, 0), verts=24)
    for i, y in enumerate((-8.0, 2.0, 11.0)):
        torus("ark_ring_%d" % i, (0, y, 0), 9.2, 1.0, HULL_MID, rot=(math.pi / 2, 0, 0))
        for s in range(6):
            a = s * math.pi / 3
            box("ark_spoke_%d_%d" % (i, s), (math.cos(a) * 5.6, y, math.sin(a) * 5.6),
                (4.6, 0.5, 0.5), HULL_LIGHT, bevel=0.04, rot=(0, a, 0))
            cyl("ark_pod_%d_%d" % (i, s), (math.cos(a) * 9.2, y, math.sin(a) * 9.2),
                0.95, 2.0, HULL_DARK, rot=(math.pi / 2, 0, 0), verts=12)
    for s in (-1, 1):
        box("ark_cargo", (s * 7.4, -14.0, 0.0), (3.4, 11.0, 4.0), HULL_MID, bevel=0.16)
        for i in range(4):
            box("ark_container_%d" % i, (s * 7.4, -17.0 + i * 2.6, 2.2), (3.0, 2.0, 0.5),
                ACCENT if i % 2 == 0 else HULL_LIGHT, bevel=0.03)
        cyl("ark_strut", (s * 3.6, -14.0, -1.4), 0.4, 9.0, HULL_LIGHT, verts=10)
    for s in (-1, 1):
        sphere("ark_dome", (s * 3.0, 17.0, 2.2), 1.8, GLASS, 20, 12)
    windows(-12.0, 14.0, 6.25, 1.0, rows=3, count=10, width=0.6, seed=51)
    plating(26, -16.0, 16.0, 0.0, 6.28, seed=52, scale=1.0)
    engine_bank(-18.9, 0.0, 4, 2.5, 1.15, 3.4, 1.0)
    return join_all("ark")


def build_bulwark():
    # horizontal habitat ring, vertical spire — a fixed orbital citadel
    torus("st_ring", (0, 0, 0), 17.0, 2.6, HULL_MID, maj_seg=64, min_seg=16)
    torus("st_ring_trim", (0, 0, 0), 19.2, 0.32, TRIM, maj_seg=64, min_seg=8)
    for i in range(12):
        a = i * math.pi / 6
        box("st_module_%d" % i, (math.cos(a) * 17.0, math.sin(a) * 17.0, 2.9),
            (2.6, 2.6, 2.2), HULL_LIGHT if i % 2 else HULL_MID, bevel=0.1,
            rot=(0, 0, a))
        box("st_module_light_%d" % i, (math.cos(a) * 17.0, math.sin(a) * 17.0, 4.15),
            (1.8, 0.6, 0.14), GLOW if i % 2 else ACCENT, bevel=0.0, rot=(0, 0, a))
    for i in range(8):
        a = i * math.pi / 4
        cyl("st_spoke_%d" % i, (math.cos(a) * 8.5, math.sin(a) * 8.5, 0), 0.55, 16.0,
            HULL_LIGHT, rot=(0, math.pi / 2, a), verts=10)
    cyl("st_core", (0, 0, 0), 5.6, 30.0, HULL_MID, verts=24)
    cyl("st_core_band", (0, 0, 7.0), 6.4, 1.2, TRIM, verts=24)
    cyl("st_core_band2", (0, 0, -7.0), 6.4, 1.2, TRIM, verts=24)
    cone("st_spire", (0, 0, 19.0), 4.0, 0.6, 10.0, HULL_LIGHT, verts=12)
    sphere("st_beacon", (0, 0, 24.6), 0.8, GLOW, 16, 12)
    cone("st_keel", (0, 0, -18.0), 4.6, 1.4, 8.0, HULL_DARK, rot=(math.pi, 0, 0), verts=12)
    for i in range(3):
        torus("st_hab_ring_%d" % i, (0, 0, -11.0 + i * 1.6), 7.4, 0.9, HULL_MID)
    for s in range(4):
        a = s * math.pi / 2 + math.pi / 4
        box("st_dock_%d" % s, (math.cos(a) * 26.0, math.sin(a) * 26.0, 0),
            (12.0, 2.0, 1.4), HULL_MID, bevel=0.08, rot=(0, 0, a))
        box("st_dock_light_%d" % s, (math.cos(a) * 30.0, math.sin(a) * 30.0, 0.4),
            (2.0, 1.4, 1.0), ACCENT, bevel=0.02, rot=(0, 0, a))
    for i in range(5):
        for row in range(4):
            a = i * math.pi * 2 / 5 + row * 0.12
            box("st_win_%d_%d" % (i, row), (math.cos(a) * 5.62, math.sin(a) * 5.62, 2.0 + row * 1.4),
                (0.5, 0.12, 0.55), GLASS, bevel=0.0, rot=(0, 0, a))
    return join_all("bulwark")


# --------------------------------------------------------------------------
# class variants — one silhouette per combat hull, not one per model family
# --------------------------------------------------------------------------
def build_raider():
    """Scout-derived predator: forward-swept blades and exposed missile cells."""
    box("rai_core", (0, -0.2, 0), (2.3, 7.2, 1.15), HULL_MID, bevel=0.12)
    cone("rai_nose", (0, 5.0, 0), 1.2, 0.05, 4.8, HULL_LIGHT,
         rot=(-math.pi / 2, 0, 0), verts=5)
    box("rai_spine", (0, -0.4, 0.66), (0.42, 6.2, 0.22), TRIM, bevel=0.02)
    sphere("rai_eye", (0, 3.2, 0.48), 0.42, GLASS, 16, 10)
    for s in (-1, 1):
        box("rai_blade", (s * 2.25, -0.8, 0.02), (2.8, 4.6, 0.13), HULL_MID,
            bevel=0.04, rot=(0, 0, math.radians(24 * s)))
        box("rai_blade_edge", (s * 3.45, -1.8, 0.02), (0.16, 2.0, 0.24), ACCENT, bevel=0.02)
        box("rai_pod", (s * 1.55, -2.65, -0.35), (1.0, 2.6, 0.72), HULL_DARK, bevel=0.05)
        for i in range(2):
            cyl("rai_tube_%d" % i, (s * 1.55, -3.45 + i * 0.8, 0.18), 0.16, 0.95,
                HULL_LIGHT, rot=(math.pi / 2, 0, 0), verts=8, bevel=0.0)
        box("rai_vent", (s * 0.62, -4.05, 0.34), (0.24, 1.1, 0.32), ACCENT, bevel=0.02)
    engine_bank(-4.0, 0.0, 2, 1.15, 0.4, 1.3)
    windows(-1.8, 1.8, 1.16, 0.38, rows=1, count=5, width=0.28, seed=61)
    return join_all("raider")


def build_frigate():
    """Corvette-derived escort with a shield halo and paired sensor masts."""
    box("fri_core", (0, -0.4, 0), (3.0, 15.0, 1.9), HULL_MID, bevel=0.2)
    cone("fri_prow", (0, 9.4, 0), 1.45, 0.14, 5.4, HULL_LIGHT,
         rot=(-math.pi / 2, 0, 0), verts=6)
    box("fri_deck", (0, 1.1, 1.05), (1.8, 9.2, 0.55), HULL_MID, bevel=0.08)
    box("fri_bridge", (0, 5.1, 1.65), (1.6, 2.6, 0.9), HULL_LIGHT, bevel=0.06)
    for s in (-1, 1):
        box("fri_rail", (s * 2.0, -1.4, 0.05), (1.4, 9.6, 0.5), HULL_MID, bevel=0.06)
        box("fri_rail_trim", (s * 2.05, 2.0, 0.35), (1.0, 1.1, 0.16), ACCENT, bevel=0.02)
        cyl("fri_mast", (s * 0.8, 3.5, 2.15), 0.10, 3.2, TRIM, verts=8, bevel=0.0)
        sphere("fri_mast_tip", (s * 0.8, 3.5, 3.8), 0.18, GLOW, 12, 8)
        cyl("fri_engine", (s * 1.15, -8.0, 0.0), 0.62, 2.5, HULL_LIGHT,
            rot=(math.pi / 2, 0, 0), verts=16)
        box("fri_engine_trim", (s * 1.15, -7.5, 0.0), (1.5, 0.35, 0.5), ACCENT, bevel=0.02)
    torus("fri_shield_ring", (0, 0.5, 0), 4.0, 0.16, GLOW, rot=(math.pi / 2, 0, 0), maj_seg=48, min_seg=8)
    for s in (-1, 1):
        box("fri_shield_pylon", (s * 2.35, 0.5, 0.0), (1.45, 0.55, 0.32), TRIM, bevel=0.02)
    windows(-4.2, 6.2, 1.52, 0.45, rows=2, count=8, width=0.38, seed=62)
    windows(-4.2, 6.2, -1.52, 0.45, rows=2, count=8, width=0.38, seed=63)
    return join_all("frigate")


def build_destroyer():
    """Long, narrow spinal-gun hull with outrigger missile rails."""
    box("des_spine", (0, -1.0, 0), (3.2, 24.0, 1.8), HULL_MID, bevel=0.24)
    cone("des_prow", (0, 13.5, 0), 1.6, 0.16, 7.5, HULL_LIGHT,
         rot=(-math.pi / 2, 0, 0), verts=5)
    box("des_deck", (0, 1.0, 0.95), (2.0, 12.0, 0.5), HULL_MID, bevel=0.06)
    box("des_bridge", (0, 6.2, 1.6), (1.7, 3.0, 0.8), HULL_LIGHT, bevel=0.05)
    cyl("des_spinal", (0, 12.0, 0.0), 0.5, 16.0, HULL_LIGHT,
        rot=(math.pi / 2, 0, 0), verts=16)
    cyl("des_muzzle", (0, 20.2, 0.0), 0.31, 0.8, ACCENT,
        rot=(math.pi / 2, 0, 0), verts=12, bevel=0.0)
    for s in (-1, 1):
        box("des_rail", (s * 3.15, -3.0, -0.1), (1.15, 16.0, 0.55), HULL_MID, bevel=0.05)
        box("des_rail_trim", (s * 3.15, 1.0, 0.2), (0.95, 2.6, 0.18), ACCENT, bevel=0.02)
        for i in range(3):
            box("des_cell_%d" % i, (s * 3.15, -7.6 + i * 2.2, 0.0), (0.85, 1.0, 0.6), HULL_DARK, bevel=0.02)
            cyl("des_cell_tube_%d" % i, (s * 3.15, -7.8 + i * 2.2, 0.38), 0.13, 0.32,
                ENGINE, rot=(math.pi / 2, 0, 0), verts=8, bevel=0.0)
        fin(-5.8, 0.35, s * 2.4, 1.2, 0)
        radiator(-9.5, -0.3, s * 2.2, 1.1, 5.2)
    for i in range(2):
        turret(4.4 - i * 3.2, 1.45, 0.0, 0.9)
    windows(-8.0, 8.5, 1.62, 0.42, rows=2, count=8, width=0.32, seed=64)
    engine_bank(-13.0, 0.0, 4, 1.35, 0.62, 2.0)
    return join_all("destroyer")


def build_carrier():
    """Wide flight deck, twin open hangar bays, offset island."""
    box("car_hull", (0, -1.0, 0), (8.4, 24.0, 2.6), HULL_MID, bevel=0.3)
    box("car_bow", (0, 11.6, -0.1), (7.4, 5.2, 1.9), HULL_LIGHT, bevel=0.24)
    box("car_deck", (0, -0.5, 1.52), (9.2, 20.0, 0.5), HULL_MID, bevel=0.04)
    box("car_deck_line", (0, -0.5, 1.82), (0.28, 18.0, 0.08), ACCENT, bevel=0.0)
    box("car_island", (2.9, 3.0, 2.65), (1.8, 5.0, 2.0), HULL_LIGHT, bevel=0.08)
    box("car_island_glass", (2.9, 5.2, 2.9), (1.5, 0.2, 0.42), GLASS, bevel=0.0)
    for s in (-1, 1):
        box("car_hangar", (s * 4.0, -2.0, -0.1), (2.2, 13.0, 1.8), HULL_DARK, bevel=0.08)
        box("car_hangar_door", (s * 4.0, -8.55, 0.0), (1.9, 0.22, 1.35), GLOW, bevel=0.0)
        for i in range(3):
            box("car_bay_rib_%d" % i, (s * 4.0, -7.2 + i * 3.3, 0.95), (2.35, 0.18, 0.1), TRIM, bevel=0.0)
        box("car_sponson", (s * 4.8, 2.0, 0.1), (1.2, 11.0, 1.0), HULL_MID, bevel=0.06)
        box("car_sponson_light", (s * 4.8, 6.0, 0.6), (0.7, 0.5, 0.25), ACCENT, bevel=0.0)
        fin(-8.5, 0.4, s * 3.2, 1.4, 0)
    for i in range(3):
        box("car_launch_%d" % i, ((i - 1) * 2.2, 10.5, 1.82), (0.6, 1.7, 0.1), ACCENT, bevel=0.0)
    for i in range(5):
        windows(-8.0, 8.0, 4.25, 0.7, rows=1, count=4, width=0.3, seed=65 + i)
    engine_bank(-14.0, -0.2, 4, 2.2, 0.9, 2.6)
    engine_bank(-13.4, 2.0, 2, 2.8, 0.55, 1.8)
    return join_all("carrier")


def build_battleship():
    """Broadside battleship: low armored prow and six heavy turrets."""
    box("bat_spine", (0, -1.0, 0), (7.4, 40.0, 3.2), HULL_MID, bevel=0.4)
    cone("bat_prow", (0, 22.0, 0), 3.3, 0.3, 9.0, HULL_LIGHT,
         rot=(-math.pi / 2, 0, 0), verts=7)
    box("bat_armor", (0, 15.0, 1.9), (9.6, 11.0, 2.0), HULL_MID, bevel=0.2)
    box("bat_bridge", (0, 4.0, 3.0), (4.4, 6.0, 1.3), HULL_LIGHT, bevel=0.1)
    for s in (-1, 1):
        box("bat_wing", (s * 5.0, -3.0, 0.0), (4.6, 28.0, 1.5), HULL_MID, bevel=0.18)
        box("bat_wing_edge", (s * 7.15, -3.0, 0.0), (0.5, 26.0, 0.9), HULL_DARK, bevel=0.04)
        box("bat_wing_accent", (s * 5.0, 8.0, 0.9), (2.8, 3.2, 0.26), ACCENT, bevel=0.03)
        for i in range(3):
            turret(-10.0 + i * 9.0, 1.85, s * 4.3, 1.15)
        radiator(-18.0, 0.2, s * 6.3, 1.4, 7.0)
        fin(-14.0, 0.3, s * 3.0, 1.8, 0)
        box("bat_engine_block", (s * 3.8, -21.0, -0.2), (4.2, 7.0, 2.8), HULL_MID, bevel=0.12)
    turret(18.0, 2.1, 0, 1.25)
    windows(-15.0, 16.0, 3.75, 1.3, rows=2, count=12, width=0.5, seed=66)
    windows(-15.0, 16.0, -3.75, 1.3, rows=2, count=12, width=0.5, seed=67)
    engine_bank(-23.0, -0.2, 4, 2.4, 1.0, 2.5)
    return join_all("battleship")


def build_titan():
    """Aeterna citadel: twin towers, a halo ring and four outriggers."""
    box("tit_spine", (0, -2.0, 0), (9.5, 52.0, 4.0), HULL_MID, bevel=0.55)
    cone("tit_prow", (0, 30.0, 0), 4.4, 0.4, 12.0, HULL_LIGHT,
         rot=(-math.pi / 2, 0, 0), verts=8)
    box("tit_crown", (0, 13.0, 4.2), (7.0, 12.0, 2.5), HULL_MID, bevel=0.2)
    for s in (-1, 1):
        cyl("tit_tower", (s * 2.4, 13.0, 6.0), 0.7, 7.0, TRIM, verts=10)
        cone("tit_tower_tip", (s * 2.4, 13.0, 9.8), 0.7, 0.05, 2.8, TRIM, verts=8)
        sphere("tit_tower_beacon", (s * 2.4, 13.0, 11.3), 0.24, GLOW, 12, 8)
        box("tit_outrigger", (s * 9.5, -4.0, 0.2), (6.0, 34.0, 2.0), HULL_MID, bevel=0.18)
        box("tit_outrigger_edge", (s * 12.2, -4.0, 0.2), (0.6, 32.0, 1.2), HULL_DARK, bevel=0.04)
        for i in range(2):
            cyl("tit_cannon_%d" % i, (s * 10.8, 13.0, -0.1 + i * 0.9), 0.42, 13.0,
                HULL_LIGHT, rot=(math.pi / 2, 0, 0), verts=14)
            cyl("tit_cannon_muzzle_%d" % i, (s * 10.8, 19.2, -0.1 + i * 0.9), 0.26, 0.8,
                ACCENT, rot=(math.pi / 2, 0, 0), verts=12, bevel=0.0)
        box("tit_nacelle", (s * 6.0, -25.0, -0.5), (5.2, 11.0, 3.6), HULL_MID, bevel=0.14)
        radiator(-23.0, 0.8, s * 10.0, 1.5, 8.0)
        fin(-18.0, 1.8, s * 4.0, 2.2, 0)
    torus("tit_halo", (0, -2.0, 0), 13.5, 0.65, TRIM, rot=(math.pi / 2, 0, 0), maj_seg=64, min_seg=10)
    for i in range(8):
        a = i * math.pi / 4
        box("tit_halo_spoke_%d" % i, (math.cos(a) * 7.0, -2.0, math.sin(a) * 7.0),
            (6.5, 0.35, 0.35), HULL_LIGHT, bevel=0.02, rot=(0, -a, 0))
    for i in range(4):
        turret(20.0 - i * 9.0, 2.1, 0, 1.3)
    windows(-18.0, 18.0, 4.85, 2.0, rows=2, count=16, width=0.65, seed=68)
    windows(-18.0, 18.0, -4.85, 2.0, rows=2, count=16, width=0.65, seed=69)
    engine_bank(-31.0, -0.4, 4, 3.4, 1.3, 3.0)
    engine_bank(-30.0, 2.8, 2, 4.0, 0.85, 2.2)
    return join_all("titan")


def build_lance():
    """Grav siege hull: exposed ventral cannon and four landing bays."""
    box("lan_spine", (0, -1.0, 0), (5.4, 30.0, 2.5), HULL_MID, bevel=0.3)
    cone("lan_prow", (0, 18.0, 0), 2.7, 0.3, 7.0, HULL_LIGHT,
         rot=(-math.pi / 2, 0, 0), verts=6)
    box("lan_belly", (0, -1.0, -2.2), (4.6, 18.0, 1.9), HULL_MID, bevel=0.16)
    cyl("lan_grav", (0, 4.0, -3.2), 0.72, 18.0, HULL_LIGHT,
        rot=(math.pi / 2, 0, 0), verts=18)
    cyl("lan_grav_muzzle", (0, 12.8, -3.2), 0.45, 0.9, ACCENT,
        rot=(math.pi / 2, 0, 0), verts=14, bevel=0.0)
    for s in (-1, 1):
        box("lan_pod", (s * 4.2, -4.0, -1.0), (3.2, 10.0, 2.8), HULL_MID, bevel=0.16)
        box("lan_pod_trim", (s * 4.2, 0.0, 0.5), (2.6, 2.0, 0.18), ACCENT, bevel=0.02)
        for i in range(3):
            box("lan_bay_%d" % i, (s * 4.2, -7.4 + i * 3.0, -1.0), (2.5, 1.8, 0.18), HULL_DARK, bevel=0.02)
            box("lan_bay_light_%d" % i, (s * 4.2, -7.4 + i * 3.0, -0.85), (2.2, 0.16, 0.08), GLOW, bevel=0.0)
        box("lan_pylon", (s * 2.7, 0.0, -0.4), (1.4, 7.0, 0.8), HULL_LIGHT, bevel=0.06)
    for i in range(2):
        turret(5.0 - i * 8.0, 1.4, 0, 1.0)
    windows(-9.0, 10.0, 2.75, 0.7, rows=2, count=9, width=0.4, seed=70)
    engine_bank(-16.0, -0.4, 4, 1.8, 0.75, 2.3)
    return join_all("lance")


# --------------------------------------------------------------------------
# studio render
# --------------------------------------------------------------------------
def setup_render():
    sc = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            sc.render.engine = engine
            break
        except Exception:
            continue
    sc.render.resolution_x = 1600
    sc.render.resolution_y = 900
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    if hasattr(sc, "eevee"):
        for attr, val in (("taa_render_samples", 48), ("use_bloom", True),
                          ("use_gtao", True), ("use_raytracing", True)):
            if hasattr(sc.eevee, attr):
                try:
                    setattr(sc.eevee, attr, val)
                except Exception:
                    pass
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.view_settings.exposure = 0.9

    world = bpy.data.worlds.new("Void")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.006, 0.008, 0.014, 1.0)
    bg.inputs[1].default_value = 1.0


def add_light(name, loc, target, energy, size, color):
    data = bpy.data.lights.new(name, type='AREA')
    data.energy = energy
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    direction = Vector(target) - Vector(loc)
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return obj


def render_ship(obj, name, view=(1.05, -1.15, 0.48)):
    sc = bpy.context.scene
    bbox = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    center = sum(bbox, Vector()) / 8.0
    radius = max((v - center).length for v in bbox)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.lens = 62
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    direction = Vector(view).normalized()
    cam.location = center + direction * radius * 3.55
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()

    r = max(radius, 1.0)
    lights = [
        add_light("key", center + Vector((r * 1.7, -r * 2.4, r * 2.1)), center, 210 * r * r, r * 1.5, (1.0, 0.94, 0.84)),
        add_light("rim", center + Vector((-r * 2.6, r * 2.1, r * 1.0)), center, 150 * r * r, r * 2.0, (0.40, 0.68, 1.0)),
        add_light("fill", center + Vector((-r * 1.3, -r * 1.6, -r * 1.1)), center, 45 * r * r, r * 2.6, (1.0, 0.74, 0.48)),
        add_light("top", center + Vector((0, 0, r * 3.0)), center, 60 * r * r, r * 2.2, (0.72, 0.84, 1.0)),
    ]

    sc.render.filepath = os.path.join(OUT_RENDER, "%s.png" % name)
    bpy.ops.render.render(write_still=True)

    for o in lights:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.objects.remove(cam, do_unlink=True)


def export(obj, name):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = os.path.join(OUT_MODELS, "%s.glb" % name)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
    )
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print("[asset] %-12s tris=%-6d  %s" % (name, tris, path))


def purge_objects():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0:
            bpy.data.meshes.remove(m)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_render()
    init_materials()
    for builder in (build_scout, build_raider, build_corvette, build_frigate,
                    build_destroyer, build_cruiser, build_carrier, build_battleship,
                    build_dreadnought, build_titan, build_bulwark, build_lance, build_ark):
        purge_objects()
        obj = builder()
        export(obj, obj.name)
        render_ship(obj, obj.name)
        print("[render] art/renders/%s.png" % obj.name)
    print("[done] fleet exported")


main()
