import { describe, expect, it } from 'vitest';
import { validateStaticGlb } from '../../apps/web/src/client/presentation/glb-model';

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

describe('有界静态 GLB', () => {
  it('接受自包含 GLB v2，并返回节点和三角形统计', () => {
    expect(validateStaticGlb(validGlb())).toEqual({ nodeCount: 1, triangleCount: 1 });
    expect(
      validateStaticGlb(validGlb({ ...minimal, nodes: [{ mesh: 0 }, { mesh: 0 }], scenes: [{ nodes: [0, 1] }] })),
    ).toEqual({
      nodeCount: 2,
      triangleCount: 2,
    });
  });

  it('在写入前拒绝错误容器、外部 URI、动画和骨骼', () => {
    expect(() => validateStaticGlb(new Uint8Array(12).buffer)).toThrow(/GLB/);
    expect(() =>
      validateStaticGlb(
        createGlb({ asset: { version: '2.0' }, images: [{ uri: 'https://example.invalid/model.png' }] }),
      ),
    ).toThrow(/外部/);
    expect(() => validateStaticGlb(validGlb({ ...minimal, animations: [{}] }))).toThrow(/动画/);
    expect(() => validateStaticGlb(validGlb({ ...minimal, skins: [{}] }))).toThrow(/骨骼/);
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
