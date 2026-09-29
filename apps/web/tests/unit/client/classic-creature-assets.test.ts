import { Mat4, Quat, Vec3 } from 'playcanvas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateStaticGlb } from '../../../src/client/presentation/glb-model';
import { createHash } from 'node:crypto';
import { classicCreatureDefinitions } from '../../../src/client/presentation/classic-creature-definitions';
import {
  validateAppearanceProject,
  appearanceAnimationTargets,
} from '../../../src/client/presentation/appearance-project';

const kinds = [
  'pig',
  'cow',
  'sheep',
  'chicken',
  'squid',
  'wolf',
  'zombie',
  'skeleton',
  'spider',
  'creeper',
  'slime',
  'pig-zombie',
];
describe('Classic 生物生产资产合同', () => {
  it('十二物种分别提供带UV、内嵌贴图、独立关节和四角色动画的GLB', () => {
    for (const kind of kinds) {
      const bytes = readFileSync(resolve('apps/web/public/models/classic', `${kind}.glb`));
      const stats = validateStaticGlb(Uint8Array.from(bytes).buffer);
      const definition = classicCreatureDefinitions.find((d) => d.kind === kind)!;
      expect(stats.nodeCount).toBe(definition.nodeCount);
      expect(stats.triangleCount).toBe(definition.triangleCount);
      expect(bytes.length).toBe(definition.byteLength);
      const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
      expect(json.animations.map((a: { name: string }) => a.name).sort()).toEqual(['attack', 'hurt', 'idle', 'move']);
      expect(
        json.images.every(
          (image: { bufferView?: number; uri?: string }) => image.bufferView !== undefined && !image.uri,
        ),
      ).toBe(true);
      expect(json.meshes.length).toBeGreaterThan(3);
      expect(
        json.meshes.every((mesh: { primitives: { attributes: Record<string, number> }[] }) =>
          mesh.primitives.every((p) => p.attributes.TEXCOORD_0 !== undefined),
        ),
      ).toBe(true);
      expect(json.animations.find((a: { name: string }) => a.name === 'move').channels.length).toBeGreaterThan(
        kind === 'slime' ? 1 : 2,
      );
    }
  });
  it('只退出旧角色绑定，不清空其他项目源和新物种绑定', () => {
    const result = validateAppearanceProject({
      schemaVersion: 1,
      assets: [
        {
          id: 'user:retained-pixels',
          name: '保留的用户源',
          source: 'user',
          revision: 1,
          type: 'pixel-texture',
          payload: {
            width: 16,
            height: 16,
            palette: [
              [0, 0, 0],
              [120, 130, 140],
            ],
            pixels: Array(256).fill(1),
          },
        },
      ],
      materialBindings: { 'seedlands:model/actor/grazer': {} },
      animationBindings: {
        settler: { modelId: 'old', clips: { idle: 'Idle' } },
        pig: { modelId: 'my-pig', clips: { idle: 'Idle' } },
      },
      thumbnails: { 'seedlands:model/actor/settler': 'unused' },
    });
    expect(result.animationBindings).toEqual({ pig: { modelId: 'my-pig', clips: { idle: 'Idle' } } });
    expect(result.assets.map((asset) => asset.id)).toEqual(['user:retained-pixels']);
    expect(result.materialBindings).toEqual({});
    expect(result.thumbnails).toEqual({});
  });
  it('生产hash与manifest逐物种一致且模型不是同一黑盒', () => {
    const manifest = JSON.parse(readFileSync(resolve('apps/web/public/models/classic/manifest.json'), 'utf8'));
    expect(
      createHash('sha256').update(readFileSync('scripts/assets/classic-creatures/generate.py')).digest('hex'),
    ).toBe(manifest.recipeSha256);
    const hashes = manifest.models.map((entry: { kind: string; sha256: string }) => {
      const actual = createHash('sha256')
        .update(readFileSync(resolve('apps/web/public/models/classic', `${entry.kind}.glb`)))
        .digest('hex');
      expect(actual).toBe(entry.sha256);
      return actual;
    });
    expect(new Set(hashes).size).toBe(12);
  });
  it('动画绑定目标覆盖当前物种并退出三类旧角色', () => {
    expect([...appearanceAnimationTargets].sort()).toEqual([...kinds].sort());
  });
});

it('骷髅握住弓的中央，弓身朝前且弦端连接上下弓梢', () => {
  const manifest = JSON.parse(readFileSync(resolve('apps/web/public/models/classic/manifest.json'), 'utf8'));
  type Part = { name: string; center: number[]; parent: string | null; ends?: number[][] };
  const parts: Part[] = manifest.models.find((entry: { kind: string }) => entry.kind === 'skeleton').parts;
  const part = (name: string) => {
    const value = parts.find((entry) => entry.name === name);
    expect(value, name).toBeDefined();
    return value!;
  };
  expect(part('bow-grip').center).toEqual(part('hand-bow').center);
  expect(part('bow-grip').parent).toBe('arm--1');
  expect(part('hand-bow').parent).toBe('arm--1');
  const upperTip = part('bow-upper-outer').ends![1];
  const lowerTip = part('bow-lower-outer').ends![1];
  expect(upperTip[2]).toBeLessThan(part('bow-grip').center[2]);
  expect(lowerTip[2]).toBeLessThan(part('bow-grip').center[2]);
  expect(part('bow-string').ends).toEqual([lowerTip, upperTip]);
  for (const name of ['bow-upper-inner', 'bow-upper-outer', 'bow-lower-inner', 'bow-lower-outer', 'bow-string'])
    expect(part(name).parent).toBe('bow-grip');
});

it('导出GLB在idle与抬弓attack帧中保持握点重合、弓竖直且朝向不翻转', () => {
  const bytes = readFileSync(resolve('apps/web/public/models/classic/skeleton.glb'));
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
  const index = (name: string): number => {
    const value = document.nodes.findIndex((node: { name: string }) => node.name === name);
    expect(value, name).toBeGreaterThanOrEqual(0);
    return value;
  };
  const gripIndex = index('bow-grip');
  const handIndex = index('hand-bow');
  const parents = new Map<number, number>();
  document.nodes.forEach((node: { children?: number[] }, parent: number) =>
    node.children?.forEach((child) => parents.set(child, parent)),
  );
  const samples = (accessorIndex: number, frame: number): number[] => {
    const accessor = document.accessors[accessorIndex];
    const view = document.bufferViews[accessor.bufferView];
    const components = accessor.type === 'VEC4' ? 4 : 3;
    const offset = 28 + jsonLength + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + frame * components * 4;
    return Array.from({ length: components }, (_, i) => bytes.readFloatLE(offset + i * 4));
  };
  for (const [role, frame] of [
    ['idle', 1],
    ['attack', 1],
    ['attack', 2],
    ['attack', 3],
  ] as const) {
    const animation = document.animations.find((entry: { name: string }) => entry.name === role);
    const matrix = (nodeIndex: number): Mat4 => {
      const node = document.nodes[nodeIndex];
      let rotation = node.rotation ?? [0, 0, 0, 1];
      const channel = animation.channels.find(
        (entry: { target: { node: number; path: string } }) =>
          entry.target.node === nodeIndex && entry.target.path === 'rotation',
      );
      if (channel) rotation = samples(animation.samplers[channel.sampler].output, frame);
      const local = new Mat4().setTRS(
        new Vec3(node.translation?.[0] ?? 0, node.translation?.[1] ?? 0, node.translation?.[2] ?? 0),
        new Quat(rotation[0], rotation[1], rotation[2], rotation[3]),
        new Vec3(node.scale?.[0] ?? 1, node.scale?.[1] ?? 1, node.scale?.[2] ?? 1),
      );
      const parent = parents.get(nodeIndex);
      return parent === undefined ? local : new Mat4().mul2(matrix(parent), local);
    };
    const grip = matrix(gripIndex);
    const hand = matrix(handIndex).getTranslation();
    expect(grip.getTranslation().distance(hand)).toBeLessThan(1e-6);
    expect(grip.transformVector(new Vec3(0, 1, 0)).distance(new Vec3(0, 1, 0))).toBeLessThan(1e-6);
    expect(grip.transformVector(new Vec3(0, 0, 1)).z).toBeGreaterThan(0.999);
    if (role === 'attack' && frame === 2) {
      expect(hand.y).toBeCloseTo(1.5, 5);
      expect(hand.z).toBeGreaterThan(0.7);
    }
  }
});
