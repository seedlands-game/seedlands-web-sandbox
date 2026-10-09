import { expect, it } from 'vitest';
import {
  assembleWorldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
  worldgenProviderForComposition,
  type VerifiedPackArtifact,
} from '@seedlands/stdlib/host';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { pack, MODULAR_WORLD_SENTINEL_VOXEL } from '../../../../fixtures/packs/modular-world/modular-world';

// Composition fixture only; the browser verifies the built Pack and its real digests.
const artifact: VerifiedPackArtifact = {
  ...pack,
  integrity: {
    algorithm: 'sha256',
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: (pack.manifest.resources ?? []).map((path) => ({ path, digest: 'c'.repeat(64) })),
  },
};

const create = async () => {
  const composition = assembleWorldPacks([artifact], {
    approvedPermissions: {
      [pack.manifest.id]: pack.modules.flatMap((module) => module.descriptor.permissions ?? []),
    },
  });
  const moduleActorAuthority = createGameplayActorAuthority(composition.resources, { playerAlias: 'modular-player' });
  const runtime = await AuthorityRuntime.create({
    composition,
    moduleActorAuthority,
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
    worldgenProvider: worldgenProviderForComposition(composition),
    epoch: 'modular-player-block-actions',
    seedText: 'modular-player-block-actions',
    platform: testCorePlatform,
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 65, 0.5],
  });
  return Object.assign(runtime, { commandBinding: moduleActorAuthority.forActor(runtime.playerId, 'player')! });
};

it('uses the registered modular block producer for Creative placement and mining without partial writes', async () => {
  const runtime = await create();
  const position: [number, number, number] = [1, 65, 0];
  const playerId = runtime.playerId;
  const server = runtime.server;
  const source = {
    actorId: playerId,
    entityId: playerId,
    sourceType: 'test-player',
    capabilities: ['mutation'] as const,
  };
  expect(server.getVoxel(0, 64, 0)).toBe(MODULAR_WORLD_SENTINEL_VOXEL);
  // The ordinary UI settles its cursor before switching modes, even when empty.
  const pointer = server.getInventoryPointerView(playerId);
  const closed = await runtime.performAction({
    type: 'inventory-pointer',
    actor: pointer.actor,
    expectedInventoryRevision: pointer.revision,
    command: { kind: 'close' },
  });
  expect(closed.result, JSON.stringify(closed.result)).toMatchObject({ success: true });
  const mode = await runtime.executeCommand(source, { type: 'set-mode', mode: 'creative' }, runtime.commandBinding);
  expect(mode, JSON.stringify(mode)).toMatchObject({ success: true, data: { mode: 'creative' } });
  expect(
    await runtime.executeCommand(
      source,
      { type: 'set-creative-slot', slot: 0, itemId: 'sample:sentinel-glass' },
      runtime.commandBinding,
    ),
  ).toMatchObject({ success: true });
  expect(runtime.view().player.creativeCatalog?.hotbar[0]).toBe('sample:sentinel-glass');

  const beforePlace = {
    inventory: server.getInventoryPointerView(playerId),
    entities: server.queryEntities(),
    gameplayRevision: server.gameplayRevision,
    worldRevision: server.worldRevision,
    commitSequence: server.commitSequence,
  };
  const placed = await runtime.performAction({ type: 'place', position });
  expect(placed.result, JSON.stringify(placed.result)).toMatchObject({ success: true });
  expect(placed.commits).toHaveLength(1);
  expect(server.getVoxel(...position)).toBe(MODULAR_WORLD_SENTINEL_VOXEL);
  expect(server.getInventoryPointerView(playerId)).toEqual(beforePlace.inventory);
  expect(server.queryEntities()).toEqual(beforePlace.entities);
  expect(server.worldRevision).toBeGreaterThan(beforePlace.worldRevision);
  expect(server.commitSequence).toBeGreaterThan(beforePlace.commitSequence);
  expect(server.gameplayRevision).toBeGreaterThanOrEqual(beforePlace.gameplayRevision);

  const beforeOccupied = {
    inventory: server.getInventoryPointerView(playerId),
    entities: server.queryEntities(),
    gameplayRevision: server.gameplayRevision,
    worldRevision: server.worldRevision,
    commitSequence: server.commitSequence,
  };
  const occupied = await runtime.performAction({ type: 'place', position });
  expect(occupied.result, JSON.stringify(occupied.result)).toMatchObject({ success: false });
  expect(occupied.commits).toEqual([]);
  expect(server.getVoxel(...position)).toBe(MODULAR_WORLD_SENTINEL_VOXEL);
  expect(server.getInventoryPointerView(playerId)).toEqual(beforeOccupied.inventory);
  expect(server.queryEntities()).toEqual(beforeOccupied.entities);
  expect(server.gameplayRevision).toBe(beforeOccupied.gameplayRevision);
  expect(server.worldRevision).toBe(beforeOccupied.worldRevision);
  expect(server.commitSequence).toBe(beforeOccupied.commitSequence);

  const beforeBreak = server.worldRevision;
  const broken = await runtime.performAction({ type: 'begin-break', position });
  expect(broken.result, JSON.stringify(broken.result)).toMatchObject({ success: true });
  expect(server.getVoxel(...position)).toBe(0);
  expect(server.worldRevision).toBeGreaterThan(beforeBreak);
});
