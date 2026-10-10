import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Original, deterministic voxel geometry. Dimensions share the declared Classic body bounds.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'playbooks/classic/assets/transport/minecart.glb');
const groups = [[], []];
const box = (material, center, size) => groups[material].push({ center, size });
box(0, [0, 0.19, 0], [0.84, 0.1, 0.84]);
for (const sign of [-1, 1]) {
  box(0, [sign * 0.4, 0.42, 0], [0.06, 0.4, 0.84]);
  box(0, [0, 0.42, sign * 0.4], [0.72, 0.4, 0.06]);
  box(1, [sign * 0.405, 0.665, 0], [0.09, 0.07, 0.9]);
  box(1, [0, 0.665, sign * 0.405], [0.72, 0.07, 0.09]);
  for (const z of [-0.28, 0.28]) box(1, [sign * 0.4, 0.075, z], [0.1, 0.14, 0.2]);
}
const chunks = [];
const bufferViews = [];
const accessors = [];
let byteLength = 0;
const accessor = (array, componentType, type, count, target, bounds) => {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const view = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
  chunks.push(bytes);
  const padding = (4 - (bytes.length % 4)) % 4;
  if (padding) chunks.push(Buffer.alloc(padding));
  byteLength += bytes.length + padding;
  accessors.push({ bufferView: view, componentType, count, type, ...bounds });
  return accessors.length - 1;
};
const primitives = groups.map((boxes, material) => {
  const positions = [],
    normals = [],
    indices = [];
  for (const { center, size } of boxes) {
    const [x0, y0, z0] = center.map((v, i) => v - size[i] / 2);
    const [x1, y1, z1] = center.map((v, i) => v + size[i] / 2);
    const faces = [
      [
        [1, 0, 0],
        [
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x1, y0, z1],
        ],
      ],
      [
        [-1, 0, 0],
        [
          [x0, y0, z1],
          [x0, y1, z1],
          [x0, y1, z0],
          [x0, y0, z0],
        ],
      ],
      [
        [0, 1, 0],
        [
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x0, y1, z0],
        ],
      ],
      [
        [0, -1, 0],
        [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
        ],
      ],
      [
        [0, 0, 1],
        [
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
          [x0, y0, z1],
        ],
      ],
      [
        [0, 0, -1],
        [
          [x0, y0, z0],
          [x0, y1, z0],
          [x1, y1, z0],
          [x1, y0, z0],
        ],
      ],
    ];
    for (const [normal, vertices] of faces) {
      const start = positions.length / 3;
      for (const vertex of vertices) {
        positions.push(...vertex);
        normals.push(...normal);
      }
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  }
  const packedPositions = new Float32Array(positions);
  const min = [0, 1, 2].map((axis) => Math.min(...packedPositions.filter((_, i) => i % 3 === axis)));
  const max = [0, 1, 2].map((axis) => Math.max(...packedPositions.filter((_, i) => i % 3 === axis)));
  return {
    attributes: {
      POSITION: accessor(packedPositions, 5126, 'VEC3', positions.length / 3, 34962, { min, max }),
      NORMAL: accessor(new Float32Array(normals), 5126, 'VEC3', normals.length / 3, 34962),
    },
    indices: accessor(new Uint16Array(indices), 5123, 'SCALAR', indices.length, 34963),
    material,
  };
});
const document = {
  asset: { version: '2.0', generator: 'Seedlands original voxel minecart generator' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'minecart', mesh: 0 }],
  meshes: [{ primitives }],
  materials: [
    {
      name: 'iron-body',
      pbrMetallicRoughness: { baseColorFactor: [0.35, 0.38, 0.42, 1], metallicFactor: 0, roughnessFactor: 1 },
    },
    {
      name: 'dark-rim-and-wheels',
      pbrMetallicRoughness: { baseColorFactor: [0.07, 0.08, 0.1, 1], metallicFactor: 0, roughnessFactor: 1 },
    },
  ],
  buffers: [{ byteLength }],
  bufferViews,
  accessors,
};
const json = Buffer.from(JSON.stringify(document));
const paddedJson = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const binary = Buffer.concat(chunks);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + paddedJson.length + 8 + binary.length, 8);
const section = (bytes, type) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(bytes.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, bytes]);
};
const glb = Buffer.concat([header, section(paddedJson, 0x4e4f534a), section(binary, 0x004e4942)]);
if (process.argv.includes('--verify')) {
  if (!(await readFile(output)).equals(glb))
    throw new Error('Authored minecart bytes differ from deterministic generator.');
} else {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, glb, { flag: 'wx' });
}
process.stdout.write(JSON.stringify({ ok: true, bytes: glb.length, primitives: primitives.length }) + '\n');
