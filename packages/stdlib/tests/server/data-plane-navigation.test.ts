import { describe, expect, it, vi } from 'vitest';
import { buildLogicObservation } from '../../src/server/authority/logic-observation-builder';
import { peekLoadedVoxel, peekLoadedVoxelInChunk } from '../../src/server/loaded-voxel-reader';
import { GameServer } from '../../src/server/game-server';
import { testWorldgenExecutableProvider } from '../support/worldgen';
import { testCorePlatform } from '../support/core-platform';
import { defaultItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../../src/world/voxel';
import {
  compareNavigationPriority,
  LogicTerrain,
  selectNavigationOpenNode,
  terrainOverlapValidationMode,
  terrainWindowsOverlap,
  validateTerrainWindows,
  type NavigationPriority,
} from '../../src/server/logic/logic-terrain';
import type { LogicPosition, TerrainWindow } from '../../src/server/logic/logic-protocol';

describe('terrain observation expected chunk reads', () => {
  const fixture = () => {
    const server = new GameServer({
      worldgenProvider: testWorldgenExecutableProvider,
      platform: testCorePlatform,
      seedText: 'observation-keyed-read',
    });
    const chunks = new Map(
      [
        [-1, -1],
        [-1, 0],
        [0, -1],
        [0, 0],
      ].map(([cx, cz]) => {
        const chunk = server.getChunk(cx!, 1, cz!);
        return [chunk.key, chunk] as const;
      }),
    );
    const options: Omit<Parameters<typeof buildLogicObservation>[0], 'getLoadedVoxel'> = {
      clone: testCorePlatform.clone,
      epoch: 'keyed-observation',
      observationSequence: 1,
      snapshot: {
        kind: 'snapshot',
        protocolVersion: 1,
        epoch: 'keyed-observation',
        physicsTick: 1,
        commitSequence: 1,
        worldMutationCount: 0,
        acknowledgedInputSequence: 0,
        inputResyncRequired: false,
        activeTimeMs: 50,
        integratedPhysicsTimeMs: 50,
        physicsDebtMs: 0,
        player: {
          id: 'player',
          type: 'player',
          body: { position: { x: 0.5, y: 40, z: 0.5 }, velocity: { x: 0, y: 0, z: 0 } },
          grounded: false,
          contacts: [],
        },
        entities: [],
        chunkRevisions: {},
        worldRevision: 0,
        worldTime: 8,
        paused: false,
      },
      entities: [
        {
          id: 'grazer',
          type: 'creature',
          kind: 'creature',
          lifecycle: 'active',
          archetype: 'grazer',
          position: [-0.5, 40, -0.5],
        },
      ],
      simulation: {
        actors: [
          {
            entityId: 'grazer',
            archetype: 'grazer',
            hunger: 0,
            behavior: 'idle',
            targetEntityId: null,
            homePoiId: null,
            workPoiId: null,
            foodPoiId: null,
            active: true,
            wanderIndex: 0,
          },
        ],
        pois: { version: 1, sequence: 0, pois: [] },
        actions: { version: 1, sequence: 0, actions: [] },
      },
      items: defaultItemDefinitionRegistry,
      identityRevision: () => 1,
    };
    const read = (x: number, y: number, z: number, key: string) => peekLoadedVoxelInChunk(chunks, key, x, y, z);
    return { options, chunks, read };
  };

  it('passes each clipped window key and preserves complete positive/negative observations', () => {
    const { options, chunks, read } = fixture(),
      getLoadedVoxel = vi.fn(read);
    const observation = buildLogicObservation({ ...options, getLoadedVoxel });
    expect(observation).toEqual(
      buildLogicObservation({ ...options, getLoadedVoxel: (x, y, z) => peekLoadedVoxel(chunks, x, y, z) }),
    );
    expect(observation.decisionContext.terrainWindows).toHaveLength(4);
    for (const [x, y, z, key] of getLoadedVoxel.mock.calls)
      expect(key).toBe(chunkKey(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)));
  });

  it('omits an unloaded window and accepts the current replacement revision', () => {
    const { options, chunks, read } = fixture(),
      original = chunks.get('-1,1,-1')!;
    chunks.delete(original.key);
    expect(
      buildLogicObservation({ ...options, getLoadedVoxel: read }).decisionContext.terrainWindows.some(
        (w) => w.key === original.key,
      ),
    ).toBe(false);
    chunks.set(original.key, { ...original, revision: original.revision + 10 });
    expect(
      buildLogicObservation({ ...options, getLoadedVoxel: read }).decisionContext.terrainWindows.find(
        (w) => w.key === original.key,
      )?.chunkRevision,
    ).toBe(original.revision + 10);
  });

  it.each(['mutation', 'replacement'])('rejects a mixed revision when a chunk changes between cells: %s', (change) => {
    const { options, chunks, read } = fixture(),
      original = chunks.get('-1,1,-1')!;
    let cells = 0;
    const getLoadedVoxel = (x: number, y: number, z: number, key: string) => {
      const value = read(x, y, z, key);
      if (key === original.key && ++cells === 1) {
        if (change === 'mutation') original.revision += 1;
        else chunks.set(key, { ...original, revision: original.revision + 1 });
      }
      return value;
    };
    expect(
      buildLogicObservation({ ...options, getLoadedVoxel }).decisionContext.terrainWindows.some(
        (w) => w.key === original.key,
      ),
    ).toBe(false);
    expect(cells).toBe(2);
  });
});

const window = (key: string, origin: LogicPosition, size: LogicPosition, chunkRevision = 1): TerrainWindow => ({
  key,
  chunkRevision,
  origin,
  size,
  occupancy: new Uint8Array(size[0] * size[1] * size[2]),
});

const legacyOverlapOracle = (left: TerrainWindow, right: TerrainWindow): boolean => {
  const occupied = new Set<string>();
  for (let z = left.origin[2]; z < left.origin[2] + left.size[2]; z += 1)
    for (let y = left.origin[1]; y < left.origin[1] + left.size[1]; y += 1)
      for (let x = left.origin[0]; x < left.origin[0] + left.size[0]; x += 1) occupied.add(`${x},${y},${z}`);
  for (let z = right.origin[2]; z < right.origin[2] + right.size[2]; z += 1)
    for (let y = right.origin[1]; y < right.origin[1] + right.size[1]; y += 1)
      for (let x = right.origin[0]; x < right.origin[0] + right.size[0]; x += 1)
        if (occupied.has(`${x},${y},${z}`)) return true;
  return false;
};

const legacyOpenSelectionOracle = <T extends NavigationPriority>(nodes: readonly T[]): T | undefined =>
  [...nodes].sort((left, right) => left.f - right.f || left.g - right.g || left.key.localeCompare(right.key))[0];

describe('导航数据平面分配控制', () => {
  it.each([
    ['分离', window('a', [-8, -2, -8], [4, 4, 4]), window('b', [2, -2, -8], [4, 4, 4])],
    ['面相邻', window('a', [-8, -2, -8], [4, 4, 4]), window('b', [-4, -2, -8], [4, 4, 4])],
    ['边相邻', window('a', [-8, -2, -8], [4, 4, 4]), window('b', [-4, 2, -8], [4, 4, 4])],
    ['角相邻', window('a', [-8, -2, -8], [4, 4, 4]), window('b', [-4, 2, -4], [4, 4, 4])],
    ['部分重叠', window('a', [-8, -2, -8], [4, 4, 4]), window('b', [-6, 0, -6], [4, 4, 4])],
    ['完全包含', window('a', [-8, -2, -8], [8, 8, 8]), window('b', [-6, 0, -6], [2, 2, 2])],
  ])('整数区间相交与旧逐格 Set oracle 一致：%s', (_name, left, right) => {
    expect(terrainWindowsOverlap(left, right)).toBe(legacyOverlapOracle(left, right));
  });

  it('窗口验证接受负坐标相邻窗口，并拒绝部分重叠和完全包含', () => {
    expect(() =>
      validateTerrainWindows([window('left', [-4, 0, 0], [4, 2, 2]), window('right', [0, 0, 0], [4, 2, 2])]),
    ).not.toThrow();
    expect(() =>
      validateTerrainWindows([window('outer', [-4, 0, -4], [8, 4, 8]), window('partial', [3, 0, 3], [2, 2, 2])]),
    ).toThrow(/overlap/i);
    expect(() =>
      validateTerrainWindows([window('outer', [-4, 0, -4], [8, 4, 8]), window('inner', [-1, 1, -1], [2, 2, 2])]),
    ).toThrow(/overlap/i);
  });

  it('海量单 cell 窗口切换到 O(cells) fallback，避免 O(W²) 退化', () => {
    const windows = Array.from({ length: 2_048 }, (_, index) => window(`tiny-${index}`, [index, 0, 0], [1, 1, 1]));
    expect(terrainOverlapValidationMode(windows.length, windows.length)).toBe('cell-set');
    expect(() => validateTerrainWindows(windows)).not.toThrow();
    windows[windows.length - 1] = window('overlap', [0, 0, 0], [1, 1, 1]);
    expect(() => validateTerrainWindows(windows)).toThrow(/overlap/i);
  });

  it('线性 open 选择在 f、g、负坐标字符串和稳定完全相等场景下匹配旧排序 oracle', () => {
    const nodes = [
      { id: 'later-f', f: 3, g: 1, key: '0,0,0' },
      { id: 'larger-g', f: 2, g: 2, key: '-10,0,0' },
      { id: 'lexical-b', f: 2, g: 1, key: '2,0,-1' },
      { id: 'lexical-a-first', f: 2, g: 1, key: '-2,0,10' },
      { id: 'lexical-a-second', f: 2, g: 1, key: '-2,0,10' },
    ] as const;
    const permutations = [nodes, [...nodes].reverse(), [nodes[2], nodes[0], nodes[4], nodes[1], nodes[3]]];

    for (const permutation of permutations) {
      expect(selectNavigationOpenNode(permutation)).toBe(legacyOpenSelectionOracle(permutation));
      expect([...permutation].sort(compareNavigationPriority)).toEqual(
        [...permutation].sort(
          (left, right) => left.f - right.f || left.g - right.g || left.key.localeCompare(right.key),
        ),
      );
    }
  });

  it('线性 open 选择支持 Map.values 基准入口且空集合返回 undefined', () => {
    const open = new Map<string, NavigationPriority>([
      ['far', { f: 5, g: 1, key: 'far' }],
      ['near', { f: 1, g: 1, key: 'near' }],
    ]);
    expect(selectNavigationOpenNode(open.values())).toBe(open.get('near'));
    expect(selectNavigationOpenNode([])).toBeUndefined();
  });

  it('整条 nextStep 与冻结旧实现语料一致：负坐标、阻断和跨窗口 read revision', () => {
    const flat = (terrain: TerrainWindow) => {
      for (let z = terrain.origin[2]; z < terrain.origin[2] + terrain.size[2]; z += 1)
        for (let x = terrain.origin[0]; x < terrain.origin[0] + terrain.size[0]; x += 1) {
          const localX = x - terrain.origin[0];
          const localZ = z - terrain.origin[2];
          terrain.occupancy[localX + terrain.size[0] * localZ] = 1;
        }
    };
    const run = (windows: TerrainWindow[], start: LogicPosition, target: LogicPosition) => {
      const terrain = new LogicTerrain(windows);
      return {
        step: terrain.nextStep('player', start, target),
        reads: terrain.readRevisions(),
        missing: terrain.hasMissingData,
      };
    };

    const negative = window('negative', [-8, 0, -8], [16, 5, 16]);
    flat(negative);
    expect(run([negative], [-2.5, 1, -2.5], [2.5, 1, -2.5])).toEqual({
      step: { wish: { x: 1, z: 0 }, jumpRequested: false },
      reads: [{ key: 'negative', revision: 1 }],
      missing: false,
    });

    const blocked = window('blocked', [-4, 0, -4], [8, 5, 8]);
    flat(blocked);
    for (let z = -4; z < 4; z += 1)
      for (let y = 1; y <= 2; y += 1)
        blocked.occupancy[-blocked.origin[0] + blocked.size[0] * (z - blocked.origin[2] + blocked.size[2] * y)] = 1;
    expect(run([blocked], [-2.5, 1, 0.5], [2.5, 1, 0.5])).toEqual({
      step: null,
      reads: [{ key: 'blocked', revision: 1 }],
      missing: true,
    });

    const left = window('z-left', [-4, 0, -4], [4, 5, 8], 7);
    const right = window('a-right', [0, 0, -4], [4, 5, 8], 9);
    flat(left);
    flat(right);
    expect(run([left, right], [-2.5, 1, 0.5], [2.5, 1, 0.5])).toEqual({
      step: { wish: { x: 1, z: 0 }, jumpRequested: false },
      reads: [
        { key: 'a-right', revision: 9 },
        { key: 'z-left', revision: 7 },
      ],
      missing: false,
    });
  });
});
