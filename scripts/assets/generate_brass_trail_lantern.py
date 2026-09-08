"""Generate the Seedlands brass-trail lantern sample.

Run from Blender, for example:
  Blender --background --factory-startup --python generate_brass_trail_lantern.py -- \
    --output-dir /tmp/seedlands-lantern

Only files owned by this recipe are written below --output-dir.  No .blend
authoring file is required in the repository; the script is the editable
source of the model.
"""

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy


def arguments():
    parser = argparse.ArgumentParser(description="Generate a static voxel-style Seedlands lantern GLB.")
    parser.add_argument("--output-dir", required=True, type=Path, help="Directory for the generated recipe, textures, GLB and report.")
    blender_args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    return parser.parse_args(blender_args)


def main():
    args = arguments()
    output = args.output_dir.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    # Dimensions are integer sixteenths. Blender's exporter converts Z-up to
    # glTF's conventional Y-up while preserving this source recipe.
    parts = [
        ("base", (3, 3, 0), (13, 13, 2), 0), ("foot", (4, 4, 2), (12, 12, 3), 2),
        ("crown", (3, 3, 11), (13, 13, 13), 0), ("cap", (5, 5, 13), (11, 11, 14), 2),
        ("warm_core", (5, 5, 3), (11, 11, 11), 1), ("front_left", (3, 3, 2), (4, 4, 12), 0),
        ("front_right", (12, 3, 2), (13, 4, 12), 0), ("back_left", (3, 12, 2), (4, 13, 12), 0),
        ("back_right", (12, 12, 2), (13, 13, 12), 0), ("handle_left", (5, 7, 14), (6, 9, 18), 2),
        ("handle_right", (10, 7, 14), (11, 9, 18), 2), ("handle_top", (5, 7, 18), (11, 9, 19), 2),
        ("front_crest", (7, 2, 6), (9, 3, 8), 3), ("back_crest", (7, 13, 6), (9, 14, 8), 3),
    ]
    recipe = {"schemaVersion": 1, "id": "seedlands:lantern/brass-trail", "grid": 16,
              "authoringUp": "Z", "exportUp": "Y",
              "parts": [{"name": n, "min": a, "max": b, "tile": t} for n, a, b, t in parts]}
    (output / "lantern.recipe.json").write_text(json.dumps(recipe, ensure_ascii=False, indent=2) + "\n")

    colors = [(126, 91, 43), (237, 166, 59), (54, 47, 33), (57, 123, 117)]
    size, pixels, emission = 36, [], []
    for y in range(size):
        for x in range(size):
            tile = (y // 18) * 2 + x // 18
            u, v = max(0, min(15, x % 18 - 1)), max(0, min(15, y % 18 - 1))
            amount = 1.0
            if tile == 0: amount = 1.25 if v in (1, 14) else 0.82 if u in (0, 15) else 1.0
            elif tile == 1: amount = 1.12 if 4 <= u <= 11 and 3 <= v <= 12 else 0.8
            elif tile == 2: amount = 0.82 if u in (3, 9, 14) else 1.07 if u in (4, 10) else 1
            else: amount = 1.2 if u == v or u + v == 15 else 1
            rgb = [min(255, round(c * amount)) / 255 for c in colors[tile]]
            pixels.extend((*rgb, 1.0))
            emission.extend((*(rgb if tile == 1 else [0, 0, 0]), 1.0))

    def image(name, values):
        image_data = bpy.data.images.new(name, width=size, height=size, alpha=True)
        image_data.pixels.foreach_set(values)
        image_data.filepath_raw = str(output / f"{name}.png")
        image_data.file_format = "PNG"
        image_data.save()
        image_data.pack()
        return image_data

    albedo, glow = image("lantern-atlas", pixels), image("lantern-emission", emission)
    material = bpy.data.materials.new("Brass trail / pixel16")
    material.use_nodes = True
    material.use_backface_culling = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = 0.78
    shader.inputs["Metallic"].default_value = 0.18
    shader.inputs["Emission Strength"].default_value = 1.3
    for source, socket in ((albedo, "Base Color"), (glow, "Emission Color")):
        texture = material.node_tree.nodes.new("ShaderNodeTexImage")
        texture.image, texture.interpolation = source, "Closest"
        material.node_tree.links.new(texture.outputs["Color"], shader.inputs[socket])

    vertices, faces, uvs = [], [], []
    face_corners = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    for _name, low, high, tile in parts:
        x0, y0, z0, x1, y1, z1 = (*low, *high)
        corners = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        for order in face_corners:
            start = len(vertices)
            coords = [corners[index] for index in order]
            vertices.extend(((x - 8) / 16, (y - 8) / 16, z / 16) for x, y, z in coords)
            faces.append(tuple(range(start, start + 4)))
            width, height = math.dist(coords[0], coords[1]), math.dist(coords[1], coords[2])
            ox, oy = (tile % 2) * 18 + 1, (tile // 2) * 18 + 1
            uvs.extend(((ox + u) / size, (oy + v) / size) for u, v in ((0, 0), (width, 0), (width, height), (0, height)))
    mesh = bpy.data.meshes.new("Brass trail mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop in polygon.loop_indices:
            uv_layer.data[loop].uv = uvs[mesh.loops[loop].vertex_index]
    lantern = bpy.data.objects.new("Brass trail lantern", mesh)
    bpy.context.collection.objects.link(lantern)
    lantern.data.materials.append(material)
    lantern.select_set(True)
    bpy.context.view_layer.objects.active = lantern
    bpy.ops.export_scene.gltf(filepath=str(output / "brass-trail-lantern.glb"), export_format="GLB", use_selection=True,
                              export_animations=False, export_skins=False, export_morph=False, export_yup=True,
                              export_cameras=False, export_lights=False, export_tangents=False)
    generated = ["lantern.recipe.json", "lantern-atlas.png", "lantern-emission.png", "brass-trail-lantern.glb"]
    report = {"blender": bpy.app.version_string, "worldUnitsPerGrid": 1 / 16, "recipeBoxes": len(parts),
              "meshObjects": 1, "triangles": len(faces) * 2, "atlas": {"width": size, "height": size, "tile": 16, "padding": 1},
              "files": {name: {"bytes": (output / name).stat().st_size, "sha256": hashlib.sha256((output / name).read_bytes()).hexdigest()} for name in generated}}
    (output / "generation-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print("SEEDLANDS_EXPORT_OK", json.dumps(report))


if __name__ == "__main__":
    main()
