import { expect, it } from 'vitest';
import { daylightLevel, sampleLight } from '@seedlands/stdlib/server/gameplay/light-sampler';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { GameplayRuntime, classicOptions } from '../../../../fixtures/classic/content';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';

it('昼夜天空光曲线稳定且遮挡归零', () => {
  expect(daylightLevel(12)).toBe(15);
  expect(daylightLevel(0)).toBe(0);
  expect(daylightLevel(24)).toBe(0);
  expect(sampleLight([0, 10, 0], 12, () => Voxel.Air)).toEqual({ sky: 15, block: 0, level: 15 });
  expect(sampleLight([0, 10, 0], 12, ([, y]) => (y === 12 ? Voxel.Stone : Voxel.Air))).toEqual({
    sky: 0,
    block: 0,
    level: 0,
  });
  expect(sampleLight([0, 10, 0], 12, ([, y]) => (y === 12 ? undefined : Voxel.Air))).toBeNull();
});

it('树苗成长通过一次正式 editBatch 提交，阻挡时不写入', () => {
  const cells = new Map<string, number>([
    ['0,0,0', Voxel.Dirt],
    ['0,1,0', Voxel.Sapling],
  ]);
  let calls = 0;
  const callbacks = {
    ...classicOptions(),
    platform: testCorePlatform,
    getWorldTime: () => 12,
    getVoxel: ([x, y, z]: [number, number, number]) => cells.get([x, y, z].join(',')) ?? Voxel.Air,
    getLoadedVoxel: ([x, y, z]: [number, number, number]) => cells.get([x, y, z].join(',')) ?? Voxel.Air,
    prepareVoxelEdit: () => {
      throw new Error('unexpected');
    },
    editBatch: ({ edits }: { edits?: readonly { x: number; y: number; z: number; value: number }[] }) => {
      calls++;
      for (const e of edits ?? []) cells.set([e.x, e.y, e.z].join(','), e.value);
      return {
        committed: true,
        worldRevision: calls,
        structuralChange: null,
        semanticEvents: [],
        metrics: {
          timingStatus: 'not-collected-hot-path' as const,
          inputMutationCount: edits?.length ?? 0,
          canonicalWriteCount: edits?.length ?? 0,
          dirtyChunkCount: 0,
          meshInvalidationCount: 0,
          structuralEventCount: 0 as const,
          semanticEventCount: 0,
          mutationPayloadBytes: 0,
          mutationCapacityBytes: 0,
          validationMs: 0,
          resolveMs: 0,
          applyMs: 0,
          commitMs: 0,
        },
      };
    },
  };
  const world = new GameplayRuntime(callbacks);
  expect(world.environmentQueries.growSapling([0, 1, 0])).toMatchObject({ success: true });
  expect(calls).toBe(1);
  expect(cells.get('0,1,0')).toBe(Voxel.Wood);
  cells.set('10,0,0', Voxel.Dirt);
  cells.set('10,1,0', Voxel.Sapling);
  cells.set('11,4,0', Voxel.Stone);
  expect(world.environmentQueries.growSapling([10, 1, 0])).toEqual({ success: false, reason: 'growth-blocked' });
  expect(calls).toBe(1);
});

it('方块光按距离衰减并在方块变更后立即更新', () => {
  const cells = new Map<string, number>([['2,10,0', Voxel.Lantern]]);
  const get = (p: readonly number[]) => cells.get(p.join(',')) ?? Voxel.Air;
  expect(sampleLight([0, 10, 0], 0, get)).toEqual({ sky: 0, block: 12, level: 12 });
  cells.delete('2,10,0');
  cells.set('1,10,0', Voxel.Fire);
  expect(sampleLight([0, 10, 0], 0, get)?.block).toBe(14);
});
