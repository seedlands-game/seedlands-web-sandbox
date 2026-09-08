import { describe, expect, it } from 'vitest';
import { builtinAssets } from '../../apps/web/src/client/presentation/asset-catalog';
import {
  createEmptyAppearanceProject,
  resolveAppearanceAssets,
  validateAppearanceProject,
} from '../../apps/web/src/client/presentation/appearance-project';
import {
  decodeAppearancePackage,
  encodeAppearancePackage,
} from '../../apps/web/src/client/persistence/appearance-project-store';

function staticTriangleGlb(): Blob {
  const binary = new Uint8Array(42);
  const view = new DataView(binary.buffer);
  for (const [index, value] of [0, 0, 0, 1, 0, 0, 0, 1, 0].entries()) view.setFloat32(index * 4, value, true);
  view.setUint16(36, 0, true);
  view.setUint16(38, 1, true);
  view.setUint16(40, 2, true);
  const json = new TextEncoder().encode(
    JSON.stringify({
      asset: { version: '2.0' },
      buffers: [{ byteLength: binary.byteLength }],
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
    }),
  );
  const jsonLength = Math.ceil(json.byteLength / 4) * 4;
  const binaryLength = Math.ceil(binary.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, bytes.byteLength, true);
  header.setUint32(12, jsonLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  bytes.set(json, 20);
  bytes.fill(0x20, 20 + json.byteLength, 20 + jsonLength);
  const binaryOffset = 20 + jsonLength;
  header.setUint32(binaryOffset, binaryLength, true);
  header.setUint32(binaryOffset + 4, 0x004e4942, true);
  bytes.set(binary, binaryOffset + 8);
  return new Blob([bytes], { type: 'model/gltf-binary' });
}

describe('外观项目', () => {
  it('接受受限的用户覆盖，并把模型材质覆盖投影为原材质标识', () => {
    const model = builtinAssets.find((asset) => asset.type === 'builtin-actor-model')!;
    const material = builtinAssets.find(
      (asset) => asset.type === 'material' && asset.id === model.payload.materialIds[0],
    )!;
    const override = {
      ...material,
      source: 'user' as const,
      id: 'project:material:lantern',
      revision: 1,
      payload: { ...material.payload, emissiveIntensity: 0.75 },
    };
    const project = validateAppearanceProject({
      ...createEmptyAppearanceProject(),
      assets: [override],
      materialBindings: { [model.id]: { [material.id]: override.id } },
    });

    expect(resolveAppearanceAssets(project, model.id).find((asset) => asset.id === material.id)).toEqual({
      ...override,
      id: material.id,
    });
  });

  it('拒绝不能由地形批次执行的私有绑定与透明模式变化', () => {
    const model = builtinAssets.find(
      (asset) => asset.type === 'builtin-item-model' && asset.payload.itemId === 'lantern',
    )!;
    if (model.type !== 'builtin-item-model') throw new Error('Missing lantern fixture');
    const material = builtinAssets.find(
      (asset) => asset.type === 'material' && asset.id === model.payload.materialIds[0],
    )!;
    expect(() =>
      validateAppearanceProject({
        ...createEmptyAppearanceProject(),
        materialBindings: { [model.id]: { [material.id]: material.id } },
      }),
    ).toThrow('共享面材质');
    expect(() =>
      validateAppearanceProject({
        ...createEmptyAppearanceProject(),
        assets: [{ ...material, source: 'user', payload: { ...material.payload, renderMode: 'transparent' } }],
      }),
    ).toThrow('透明批次');
  });

  it('拒绝未受限图片 URI、坏引用和不允许的资产类型', () => {
    const base = createEmptyAppearanceProject();
    for (const assets of [
      [
        {
          id: 'user:image',
          name: '图片',
          source: 'user',
          revision: 1,
          type: 'image-texture',
          payload: { path: 'https://example.com/image.png' },
        },
      ],
      [
        {
          id: 'user:model',
          name: '模型',
          source: 'user',
          revision: 1,
          type: 'glb-model',
          payload: { modelId: 'user:model', byteLength: 1, nodeCount: 0, triangleCount: 0 },
        },
      ],
    ])
      expect(() => validateAppearanceProject({ ...base, assets })).toThrow();
    expect(() =>
      validateAppearanceProject({
        ...base,
        materialBindings: { 'builtin:model:missing': { material: 'user:material:missing' } },
      }),
    ).toThrow();
  });

  it('只将已验证的静态 GLB 与项目一起编码，并可无损读回', async () => {
    const project = createEmptyAppearanceProject();
    const encoded = await encodeAppearancePackage(project, [
      { id: 'project:glb:lantern', name: '灯笼.glb', revision: 3, blob: staticTriangleGlb() },
    ]);
    const decoded = await decodeAppearancePackage(encoded);
    expect(decoded.project).toEqual(project);
    expect(
      decoded.models.map(({ id, name, revision, nodeCount, triangleCount }) => ({
        id,
        name,
        revision,
        nodeCount,
        triangleCount,
      })),
    ).toEqual([{ id: 'project:glb:lantern', name: '灯笼.glb', revision: 3, nodeCount: 1, triangleCount: 1 }]);
  });
});
