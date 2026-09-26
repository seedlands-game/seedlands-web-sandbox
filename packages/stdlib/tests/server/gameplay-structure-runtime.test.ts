import { describe, expect, it } from 'vitest';
import { createGameplayActorAuthority } from '../../src/server/composition/gameplay-actor-authority';
import { GameServer } from '../../src/server/game-server';
import { GameplayRuntime } from '../../src/server/gameplay/gameplay-runtime';
import type { StructureInteractionResolutionV1 } from '../../src/server/gameplay/modules/structure-target-dispatch';
import { Voxel } from '../../src/world/voxel';
import { testCorePlatform } from '../support/core-platform';
import { testWorldgenExecutableProvider } from '../support/worldgen';
import { createStructureTestComposition, structureTestVariant } from './structure-runtime-test-composition';

describe('public registered Structure Gameplay integration', () => {
  it('fails construction when a composition declares Structure actions without loaded batch host ports', () => {
    const { assembled } = createStructureTestComposition();
    expect(
      () =>
        new GameplayRuntime({
          composition: assembled,
          platform: testCorePlatform,
          getVoxel: () => Voxel.Air,
          getWorldTime: () => 12,
          prepareVoxelEdit: () => {
            throw new Error('Unexpected single-voxel preparation.');
          },
        }),
    ).toThrow('Registered Structure host ports are unavailable.');
  });

  it('runs a non-Classic gate through the public GameServer Structure target port', () => {
    const { assembled } = createStructureTestComposition();
    const server = new GameServer({
      composition: assembled,
      moduleActorAuthority: createGameplayActorAuthority(assembled.resources, { playerAlias: 'player' }),
      platform: testCorePlatform,
      worldgenProvider: testWorldgenExecutableProvider,
      seedText: 'non-classic-structure-public-runtime',
    });
    server.spawnPlayer({ id: 'player', position: [1.5, 31, 3.5] });
    server.editBatch({
      actorId: 'fixture',
      edits: [
        { x: 1, y: 30, z: 0, value: Voxel.Stone },
        { x: 1, y: 31, z: 0, value: Voxel.Air },
        { x: 1, y: 32, z: 0, value: Voxel.Air },
      ],
    });
    server.giveItem('player', { itemId: 'gate', count: 1 });
    const target = { kind: 'voxel' as const, hit: [1, 30, 0] as const, adjacent: [1, 31, 0] as const };
    const resolution = server.structureTargets!.resolve({
      actorId: 'player',
      intent: 'use',
      target,
      selectedItemId: 'gate',
    });
    expect(resolution).toMatchObject({ status: 'resolved', kind: 'placement', definitionId: 'fixture:gate' });
    const result = server.structureTargets!.invoke({
      version: 1,
      actorId: 'player',
      intent: 'use',
      target,
      selectedItemId: 'gate',
      resolution: resolution as Extract<StructureInteractionResolutionV1, { status: 'resolved' }>,
    });

    expect(result).toMatchObject({ success: true, handled: true });
    expect([server.getVoxel(1, 31, 0), server.getVoxel(1, 32, 0)]).toEqual([
      structureTestVariant('north', false, false),
      structureTestVariant('north', false, true),
    ]);
  });
});
