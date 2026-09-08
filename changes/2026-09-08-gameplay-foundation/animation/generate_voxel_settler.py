#!/usr/bin/env python3
"""Generate Seedlands' original skinned voxel settler GLB with reusable clips.

Run from the repository root with Blender 4.3+:
  blender --background --python changes/2026-09-08-gameplay-foundation/animation/generate_voxel_settler.py -- --output apps/web/public/models/voxel-settler-animated.glb
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path
import sys

import bpy


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])


def add_bone(armature: bpy.types.Armature, name: str, head: tuple[float, float, float], tail: tuple[float, float, float], parent: str | None = None) -> None:
    bone = armature.edit_bones.new(name)
    bone.head = head
    bone.tail = tail
    if parent:
        bone.parent = armature.edit_bones[parent]


def add_box(name: str, location: tuple[float, float, float], scale: tuple[float, float, float], bone: str, material: bpy.types.Material, rig: bpy.types.Object) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    mesh = bpy.context.object
    mesh.name = name
    mesh.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    mesh.data.materials.append(material)
    group = mesh.vertex_groups.new(name=bone)
    group.add(range(len(mesh.data.vertices)), 1.0, "REPLACE")
    modifier = mesh.modifiers.new(name="VoxelRig", type="ARMATURE")
    modifier.object = rig
    mesh.parent = rig
    return mesh


def set_pose(rig: bpy.types.Object, frame: int, rotations: dict[str, tuple[float, float, float]], root_z: float = 0.0) -> None:
    for pose_bone in rig.pose.bones:
        pose_bone.rotation_mode = "XYZ"
        pose_bone.rotation_euler = rotations.get(pose_bone.name, (0.0, 0.0, 0.0))
        pose_bone.location = (0.0, 0.0, root_z if pose_bone.name == "Root" else 0.0)
        pose_bone.keyframe_insert("rotation_euler", frame=frame, group=pose_bone.name)
        pose_bone.keyframe_insert("location", frame=frame, group=pose_bone.name)


def action(rig: bpy.types.Object, name: str, keys: list[tuple[int, dict[str, tuple[float, float, float]], float]]) -> None:
    clip = bpy.data.actions.new(name=name)
    rig.animation_data_create()
    rig.animation_data.action = clip
    for frame, rotations, root_z in keys:
        set_pose(rig, frame, rotations, root_z)
    clip.use_fake_user = True
    rig.animation_data.action = None


def main() -> None:
    output = Path(arguments().output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 24

    material = bpy.data.materials.new("SettlerPixels")
    material.diffuse_color = (0.22, 0.58, 0.42, 1.0)
    material.roughness = 0.9

    armature = bpy.data.armatures.new("VoxelSettlerRig")
    rig = bpy.data.objects.new("VoxelSettlerRig", armature)
    scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    add_bone(armature, "Root", (0, 0, 0), (0, 0, 0.25))
    add_bone(armature, "Torso", (0, 0, 0.65), (0, 0, 1.35), "Root")
    add_bone(armature, "Head", (0, 0, 1.35), (0, 0, 1.8), "Torso")
    add_bone(armature, "Arm.L", (0.32, 0, 1.25), (0.32, 0, 0.65), "Torso")
    add_bone(armature, "Arm.R", (-0.32, 0, 1.25), (-0.32, 0, 0.65), "Torso")
    add_bone(armature, "Leg.L", (0.16, 0, 0.65), (0.16, 0, 0.05), "Root")
    add_bone(armature, "Leg.R", (-0.16, 0, 0.65), (-0.16, 0, 0.05), "Root")
    bpy.ops.object.mode_set(mode="OBJECT")

    parts = [
        add_box("Mesh.Torso", (0, 0, 1.0), (0.34, 0.22, 0.4), "Torso", material, rig),
        add_box("Mesh.Head", (0, -0.01, 1.58), (0.28, 0.27, 0.28), "Head", material, rig),
        add_box("Mesh.Arm.L", (0.44, 0, 0.92), (0.1, 0.13, 0.34), "Arm.L", material, rig),
        add_box("Mesh.Arm.R", (-0.44, 0, 0.92), (0.1, 0.13, 0.34), "Arm.R", material, rig),
        add_box("Mesh.Leg.L", (0.17, 0, 0.35), (0.13, 0.16, 0.34), "Leg.L", material, rig),
        add_box("Mesh.Leg.R", (-0.17, 0, 0.35), (0.13, 0.16, 0.34), "Leg.R", material, rig),
    ]

    idle = {"Arm.L": (0.04, 0, 0), "Arm.R": (-0.04, 0, 0)}
    action(rig, "Idle", [(1, idle, 0), (13, {"Torso": (0, 0.03, 0)}, 0.025), (25, idle, 0)])
    action(
        rig,
        "Walk",
        [
            (1, {"Arm.L": (0.55, 0, 0), "Arm.R": (-0.55, 0, 0), "Leg.L": (-0.5, 0, 0), "Leg.R": (0.5, 0, 0)}, 0),
            (7, {}, 0.04),
            (13, {"Arm.L": (-0.55, 0, 0), "Arm.R": (0.55, 0, 0), "Leg.L": (0.5, 0, 0), "Leg.R": (-0.5, 0, 0)}, 0),
            (19, {}, 0.04),
            (25, {"Arm.L": (0.55, 0, 0), "Arm.R": (-0.55, 0, 0), "Leg.L": (-0.5, 0, 0), "Leg.R": (0.5, 0, 0)}, 0),
        ],
    )
    action(
        rig,
        "Attack",
        [
            (1, {"Arm.R": (-0.25, 0, -0.25), "Torso": (0, 0, -0.08)}, 0),
            (7, {"Arm.R": (-1.8, 0, 0.65), "Torso": (0, 0, 0.18)}, 0),
            (13, {"Arm.R": (0.35, 0, -0.75), "Torso": (0, 0, -0.12)}, 0),
            (19, idle, 0),
        ],
    )
    action(rig, "Hurt", [(1, {"Torso": (0.1, 0, 0.18)}, 0), (5, {"Torso": (-0.16, 0, -0.22)}, 0), (11, {}, 0)])

    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = rig
    properties = {prop.identifier for prop in bpy.ops.export_scene.gltf.get_rna_type().properties}
    options: dict[str, object] = {
        "filepath": str(output),
        "export_format": "GLB",
        "use_selection": True,
        "export_animations": True,
        "export_yup": True,
        "export_apply": True,
    }
    if "export_animation_mode" in properties:
        options["export_animation_mode"] = "ACTIONS"
    if "export_extra_animations" in properties:
        options["export_extra_animations"] = True
    if "export_optimize_animation_size" in properties:
        options["export_optimize_animation_size"] = False
    bpy.ops.export_scene.gltf(**options)
    print(f"generated {output} ({output.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
