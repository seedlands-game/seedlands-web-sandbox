import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { MAX_GLB_ANIMATION_CLIPS, validateStaticGlb } from '../../../src/client/presentation/glb-model';
import {
  createEmptyAppearanceProject,
  validateAppearanceProject,
} from '../../../src/client/presentation/appearance-project';

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function createGlb(document: object, binary = new Uint8Array()): ArrayBuffer {
  const json = jsonBytes(document);
  const jsonLength = Math.ceil(json.byteLength / 4) * 4;
  const binaryLength = Math.ceil(binary.byteLength / 4) * 4;
  const hasBinary = binaryLength > 0;
  const totalLength = 12 + 8 + jsonLength + (hasBinary ? 8 + binaryLength : 0);
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(json, 20);
  bytes.fill(0x20, 20 + json.byteLength, 20 + jsonLength);
  if (hasBinary) {
    const offset = 20 + jsonLength;
    view.setUint32(offset, binaryLength, true);
    view.setUint32(offset + 4, 0x004e4942, true);
    bytes.set(binary, offset + 8);
  }
  return bytes.buffer;
}

const triangleBinary = new Uint8Array(42);
const triangleView = new DataView(triangleBinary.buffer);
for (const [index, value] of [0, 0, 0, 1, 0, 0, 0, 1, 0].entries()) triangleView.setFloat32(index * 4, value, true);
triangleView.setUint16(36, 0, true);
triangleView.setUint16(38, 1, true);
triangleView.setUint16(40, 2, true);

const minimal = {
  asset: { version: '2.0' },
  buffers: [{ byteLength: triangleBinary.byteLength }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 36 },
    { buffer: 0, byteOffset: 36, byteLength: 6 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
  nodes: [{ mesh: 0 }],
  scenes: [{ nodes: [0] }],
  scene: 0,
};

const validGlb = (document: object = minimal, binary = triangleBinary) => createGlb(document, binary);

function mutateFirstAnimationOutputToNaN(input: Uint8Array): ArrayBuffer {
  const bytes = new Uint8Array(input);
  const container = new DataView(bytes.buffer);
  const jsonLength = container.getUint32(12, true);
  const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
    accessors: Array<{ bufferView: number; byteOffset?: number }>;
    bufferViews: Array<{ byteOffset?: number }>;
    animations: Array<{ samplers: Array<{ output: number }> }>;
  };
  const accessor = document.accessors[document.animations[0].samplers[0].output];
  const bufferView = document.bufferViews[accessor.bufferView];
  const binaryStart = 20 + jsonLength + 8;
  container.setFloat32(binaryStart + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0), Number.NaN, true);
  return bytes.buffer;
}

function animatedGlb(overrides: Record<string, unknown> = {}): ArrayBuffer {
  const binary = new Uint8Array(170);
  binary.set(triangleBinary.subarray(0, 36), 0);
  new DataView(binary.buffer).setUint16(36, 0, true);
  new DataView(binary.buffer).setUint16(38, 1, true);
  new DataView(binary.buffer).setUint16(40, 2, true);
  binary.set([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 42);
  const view = new DataView(binary.buffer);
  for (let offset = 54; offset < 102; offset += 16) view.setFloat32(offset, 1, true);
  for (let index = 0; index < 16; index++) view.setFloat32(102 + index * 4, index % 5 === 0 ? 1 : 0, true);
  view.setFloat32(166, 0, true);
  view.setFloat32(170 - 4, 1, true);
  const document = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
      { buffer: 0, byteOffset: 42, byteLength: 12 },
      { buffer: 0, byteOffset: 54, byteLength: 48 },
      { buffer: 0, byteOffset: 102, byteLength: 64 },
      { buffer: 0, byteOffset: 166, byteLength: 4 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 2, componentType: 5121, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 4, componentType: 5126, count: 1, type: 'MAT4' },
      { bufferView: 5, componentType: 5126, count: 1, type: 'SCALAR' },
      { bufferView: 3, componentType: 5126, count: 3, type: 'VEC4' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 2, WEIGHTS_0: 3 }, indices: 1, mode: 4 }] }],
    nodes: [
      { name: 'Root', children: [1] },
      { name: 'Body', mesh: 0, skin: 0 },
    ],
    skins: [{ name: 'VoxelRig', joints: [0], skeleton: 0, inverseBindMatrices: 4 }],
    animations: [
      {
        name: 'Idle',
        samplers: [{ input: 5, output: 6, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
      },
    ],
    scenes: [{ nodes: [0] }],
    scene: 0,
    ...overrides,
  };
  return createGlb(document, binary);
}

describe('有界 GLB', () => {
  it('接受自包含 GLB v2，并返回节点和三角形统计', () => {
    expect(validateStaticGlb(validGlb())).toEqual({
      nodeCount: 1,
      triangleCount: 1,
      skinCount: 0,
      animationClips: [],
    });
    expect(
      validateStaticGlb(validGlb({ ...minimal, nodes: [{ mesh: 0 }, { mesh: 0 }], scenes: [{ nodes: [0, 1] }] })),
    ).toEqual({
      nodeCount: 2,
      triangleCount: 2,
      skinCount: 0,
      animationClips: [],
    });
  });

  it('在写入前拒绝错误容器和外部 URI', () => {
    expect(() => validateStaticGlb(new Uint8Array(12).buffer)).toThrow(/GLB/);
    expect(() =>
      validateStaticGlb(
        createGlb({ asset: { version: '2.0' }, images: [{ uri: 'https://example.invalid/model.png' }] }),
      ),
    ).toThrow(/外部/);
  });

  it('接受真实 skin + clip 样例并返回可绑定片段', () => {
    const bytes = readFileSync('apps/web/public/models/voxel-settler-animated.glb');
    const stats = validateStaticGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(stats.skinCount).toBeGreaterThan(0);
    expect(stats.animationClips.map((clip) => clip.name)).toEqual(expect.arrayContaining(['Idle', 'Walk', 'Attack']));
    expect(stats.animationClips.every((clip) => clip.durationSeconds > 0)).toBe(true);
  });

  it('拒绝真实动画输出中的非有限浮点数', () => {
    const bytes = readFileSync('apps/web/public/models/voxel-settler-animated.glb');
    expect(() => validateStaticGlb(mutateFirstAnimationOutputToNaN(bytes))).toThrow(/NaN|Infinity|有限/);
  });

  it('共享 index accessor 只扫描一次', () => {
    const shared = {
      ...minimal,
      meshes: Array.from({ length: 4 }, () => minimal.meshes[0]),
    };
    const original = DataView.prototype.getUint16;
    const reads = vi.spyOn(DataView.prototype, 'getUint16').mockImplementation(function (
      this: DataView,
      byteOffset: number,
      littleEndian?: boolean,
    ) {
      return original.call(this, byteOffset, littleEndian);
    });
    try {
      expect(validateStaticGlb(validGlb(shared)).triangleCount).toBe(1);
      expect(reads).toHaveBeenCalledTimes(3);
    } finally {
      reads.mockRestore();
    }
  });

  it('有界拒绝过深 JSON 与累计解码像素超限', () => {
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 140; depth++) nested = { child: nested };
    expect(() => validateStaticGlb(validGlb({ ...minimal, extras: nested }))).toThrow(/嵌套.*上限/);

    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47], 0);
    png.set([0x49, 0x48, 0x44, 0x52], 12);
    const pngView = new DataView(png.buffer);
    pngView.setUint32(16, 4096);
    pngView.setUint32(20, 4096);
    const binary = new Uint8Array(66);
    binary.set(triangleBinary, 0);
    binary.set(png, 42);
    expect(() =>
      validateStaticGlb(
        validGlb(
          {
            ...minimal,
            buffers: [{ byteLength: binary.byteLength }],
            bufferViews: [...minimal.bufferViews, { buffer: 0, byteOffset: 42, byteLength: 24 }],
            images: [
              { bufferView: 2, mimeType: 'image/png' },
              { bufferView: 2, mimeType: 'image/png' },
            ],
            textures: [{ source: 0 }, { source: 1 }],
            materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 1 } } }],
          },
          binary,
        ),
      ),
    ).toThrow(/合计像素/);
  });

  it('拒绝畸形骨骼引用、片段输出和超出片段预算', () => {
    expect(() =>
      validateStaticGlb(animatedGlb({ skins: [{ name: 'Broken', joints: [99], inverseBindMatrices: 4 }] })),
    ).toThrow(/joint|骨骼/);
    expect(() =>
      validateStaticGlb(
        animatedGlb({
          nodes: [{ name: 'Root', children: [1] }, { name: 'Body', mesh: 0, skin: 0 }, { name: 'Root' }],
        }),
      ),
    ).toThrow(/joint.*唯一/);
    expect(() =>
      validateStaticGlb(
        animatedGlb({
          animations: [
            {
              name: 'Broken',
              samplers: [{ input: 5, output: 0 }],
              channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
            },
          ],
        }),
      ),
    ).toThrow(/动画/);
    expect(() =>
      validateStaticGlb(
        animatedGlb({
          animations: Array.from({ length: MAX_GLB_ANIMATION_CLIPS + 1 }, (_, index) => ({
            name: `clip-${index}`,
            samplers: [{ input: 5, output: 6 }],
            channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
          })),
        }),
      ),
    ).toThrow(/片段.*上限/);
  });

  it('恢复旧项目并保存角色模型的片段绑定', () => {
    const oldProject = createEmptyAppearanceProject();
    const withoutBindings = structuredClone(oldProject);
    delete withoutBindings.animationBindings;
    expect(validateAppearanceProject(withoutBindings).animationBindings).toEqual({});
    expect(
      validateAppearanceProject({
        ...oldProject,
        animationBindings: {
          settler: { modelId: 'glb:settler', clips: { idle: 'Idle', move: 'Walk', attack: 'Attack' } },
        },
      }).animationBindings?.settler,
    ).toEqual({ modelId: 'glb:settler', clips: { idle: 'Idle', move: 'Walk', attack: 'Attack' } });
    expect(() =>
      validateAppearanceProject({
        ...oldProject,
        animationBindings: { dragon: { modelId: 'glb:settler', clips: { attack: 'Attack' } } },
      }),
    ).toThrow(/动画绑定/);
  });

  it('拒绝压缩或未知 required extension，以及超出静态几何上限的文档', () => {
    expect(() =>
      validateStaticGlb(validGlb({ ...minimal, extensionsRequired: ['KHR_draco_mesh_compression'] })),
    ).toThrow(/压缩/);
    expect(() => validateStaticGlb(validGlb({ ...minimal, extensionsRequired: ['EXAMPLE_future_feature'] }))).toThrow(
      /扩展/,
    );
    expect(() => validateStaticGlb(validGlb({ ...minimal, nodes: Array.from({ length: 257 }, () => ({})) }))).toThrow(
      /节点/,
    );
    const manyIndices = new Uint8Array(36 + 300_003 * 2);
    manyIndices.set(triangleBinary.subarray(0, 36));
    expect(() =>
      validateStaticGlb(
        validGlb(
          {
            ...minimal,
            buffers: [{ byteLength: manyIndices.byteLength }],
            bufferViews: [
              { buffer: 0, byteOffset: 0, byteLength: 36 },
              { buffer: 0, byteOffset: 36, byteLength: 300_003 * 2 },
            ],
            accessors: [
              { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
              { bufferView: 1, componentType: 5123, count: 300_003, type: 'SCALAR' },
            ],
          },
          manyIndices,
        ),
      ),
    ).toThrow(/三角形/);
  });

  it('写入前拒绝不可渲染 scene、越界索引及节点图中的环或多父节点', () => {
    expect(() => validateStaticGlb(validGlb({ ...minimal, nodes: [{}] }))).toThrow(/没有可渲染/);
    expect(() =>
      validateStaticGlb(
        validGlb({ ...minimal, nodes: [{ mesh: 0, children: [1] }, { children: [0] }], scenes: [{ nodes: [0] }] }),
      ),
    ).toThrow(/成环/);
    expect(() =>
      validateStaticGlb(
        validGlb({
          ...minimal,
          nodes: [{ children: [2] }, { children: [2] }, { mesh: 0 }],
          scenes: [{ nodes: [0, 1] }],
        }),
      ),
    ).toThrow(/多个父/);
    const outOfRange = new Uint8Array(triangleBinary);
    new DataView(outOfRange.buffer).setUint16(40, 3, true);
    expect(() => validateStaticGlb(validGlb(minimal, outOfRange))).toThrow(/不存在的 POSITION/);
  });

  it('拒绝外部以外仍会造成过度解码的嵌入纹理', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0x49, 0x48, 0x44, 0x52], 12);
    new DataView(png.buffer).setUint32(16, 4097);
    new DataView(png.buffer).setUint32(20, 1);
    const binary = new Uint8Array(triangleBinary.byteLength + png.byteLength);
    binary.set(triangleBinary);
    binary.set(png, triangleBinary.byteLength);
    expect(() =>
      validateStaticGlb(
        validGlb(
          {
            ...minimal,
            buffers: [{ byteLength: binary.byteLength }],
            bufferViews: [
              ...minimal.bufferViews,
              { buffer: 0, byteOffset: triangleBinary.byteLength, byteLength: png.byteLength },
            ],
            images: [{ bufferView: 2, mimeType: 'image/png' }],
          },
          binary,
        ),
      ),
    ).toThrow(/纹理/);
  });
});
