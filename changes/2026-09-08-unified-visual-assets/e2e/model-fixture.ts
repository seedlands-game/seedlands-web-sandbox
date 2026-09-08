/** A first-party static mesh exported independently of the workbench, with an offset root to test normalization. */
export function modelFixture(): Buffer {
  const positions = new Float32Array([
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5,
    0.5, 0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5,
    0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5,
    0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
  ]);
  const normals = new Float32Array(
    [
      [0, 0, 1],
      [0, 0, -1],
      [-1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
    ].flatMap((n) => Array.from({ length: 4 }, () => n).flat()),
  );
  const indices = new Uint16Array(Array.from({ length: 6 }, (_, i) => [0, 1, 2, 0, 2, 3].map((n) => n + i * 4)).flat());
  const binary = Buffer.concat([
    Buffer.from(positions.buffer),
    Buffer.from(normals.buffer),
    Buffer.from(indices.buffer),
  ]);
  const document = {
    asset: { version: '2.0', generator: 'Seedlands static fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { translation: [12, 3, -7], children: [1, 2, 3] },
      { mesh: 0 },
      { mesh: 1, scale: [1.04, 0.15, 1.04], translation: [0, 0.28, 0] },
      { mesh: 1, scale: [1.04, 0.15, 1.04], translation: [0, -0.28, 0] },
    ],
    meshes: [0, 1].map((material) => ({
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material }],
    })),
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [0.55, 0.3, 0.13, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
      { pbrMetallicRoughness: { baseColorFactor: [0.18, 0.22, 0.23, 1], metallicFactor: 0.4, roughnessFactor: 0.7 } },
    ],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength, target: 34962 },
      {
        buffer: 0,
        byteOffset: positions.byteLength + normals.byteLength,
        byteLength: indices.byteLength,
        target: 34963,
      },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
  };
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const out = Buffer.alloc(28 + padded.length + binary.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(padded.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(out, 20);
  out.writeUInt32LE(binary.length, 20 + padded.length);
  out.writeUInt32LE(0x004e4942, 24 + padded.length);
  binary.copy(out, 28 + padded.length);
  return out;
}
