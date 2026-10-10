import type { ModuleInvocationValue } from '@seedlands/stdlib/mod-api';
import type { CompositionCheckpointIdentity } from '@seedlands/stdlib/mod-api';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import type { AuthorityAction } from '../../../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import type { CorePlatformPorts } from '../../../../../../../packages/stdlib/src/runtime/platform-ports';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { classicOptions } from '../../../../fixtures/classic/content';
import { preTransportGameplayFixture } from '../../../../fixtures/classic/pre-transport-schedule';

type Runtime = Awaited<ReturnType<typeof create>>;
type Position = [number, number, number];
const hit: Position = [1, 59, 0];
const above: Position = [1, 60, 0];
const side: Position = [1, 59, 1];
const floor: Position = [0, 59, 0];
const body: Position = [0, 60, 0];
const head: Position = [0, 61, 0];
const previousIdentity = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../../../../../../changes/2026-10-08-pr41-ci-recovery/evidence/pre-crop-support-v4-browser20-01.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as CompositionCheckpointIdentity;

const create = (platform: CorePlatformPorts = testCorePlatform, persistence?: MemoryGamePersistence) =>
  AuthorityRuntime.create({
    ...classicOptions(),
    ...(persistence ? { persistence } : {}),
    worldgenProvider: classicWorldgenProvider,
    platform,
    epoch: 'classic-crop-support-authority',
    seedText: 'classic-crop-support-authority',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 60, 0.5],
  });

const put = (position: readonly [number, number, number], value: number) => ({
  x: position[0],
  y: position[1],
  z: position[2],
  value,
});
const loadFixture = async (runtime: Runtime) => {
  const result = await runtime.editWorld('crop-support-fixture', [
    put(floor, Voxel.Stone),
    put(body, Voxel.Air),
    put(head, Voxel.Air),
    put(hit, Voxel.Farmland),
    put(above, Voxel.Air),
    put(side, Voxel.Air),
  ]);
  expect(result).toMatchObject({ committed: true });
  expect(runtime.server.peekLoadedVoxel(...floor)?.voxel).toBe(Voxel.Stone);
  expect(runtime.server.peekLoadedVoxel(...body)?.voxel).toBe(Voxel.Air);
  expect(runtime.server.peekLoadedVoxel(...head)?.voxel).toBe(Voxel.Air);
  expect(runtime.server.peekLoadedVoxel(...hit)?.voxel).toBe(Voxel.Farmland);
};
const selection = (runtime: Runtime) => {
  const player = runtime.server.getPlayerState(runtime.playerId);
  const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
  return {
    inventoryRevision: inventory.revision,
    modeRevision: player.mode!.revision,
    creativeCatalogRevision: player.creativeCatalog!.revision,
    selectedSlot: player.mode!.value === 'creative' ? player.creativeCatalog!.selectedSlot : player.selectedSlot,
  };
};
const plant = (runtime: Runtime): AuthorityAction => ({
  type: 'interact',
  intent: 'use',
  target: { kind: 'voxel', hit: [...hit], adjacent: [...above] },
  expectedSelection: selection(runtime),
});
const invoke = (runtime: Runtime, operationId: string, input: ModuleInvocationValue) =>
  runtime.server.invokeActorModuleOperation(runtime.playerId, {
    operationId,
    target: { kind: 'entity', entityId: runtime.playerId },
    input,
  });
const plantCrop = async (runtime: Runtime) => {
  runtime.server.giveItem(runtime.playerId, { itemId: 'wheat-seeds', count: 2 });
  const response = await runtime.performAction(plant(runtime));
  expect(response.result, JSON.stringify(response.result)).toMatchObject({ success: true, handled: true });
  expect(runtime.server.crops.at(hit)).toMatchObject({ position: hit, stage: 0, subSeconds: 0 });
};
const startSurvivalBreak = async (runtime: Runtime) => {
  const response = await runtime.performAction({ type: 'begin-break', position: [...hit] });
  expect(response.result, JSON.stringify(response.result)).toMatchObject({ success: true });
  const requiredSeconds = (response.result as { requiredSeconds?: number }).requiredSeconds;
  expect(typeof requiredSeconds).toBe('number');
  const advance = runtime.advanceSession(Math.ceil((requiredSeconds! + 0.1) * 1_000));
  expect(runtime.server.peekLoadedVoxel(...hit)?.voxel).toBe(Voxel.Air);
  return advance;
};
const expectCropRemoved = (runtime: Runtime) => {
  expect(runtime.server.crops.at(hit)).toBeNull();
  expect(runtime.server.crops.checkpoint().crops).toEqual([]);
};

it('RED: registered Survival finish removes the crop with its support block', async () => {
  const runtime = await create();
  await loadFixture(runtime);
  await plantCrop(runtime);
  runtime.takeCommits();
  const worldRevision = runtime.server.worldRevision;
  const gameplayRevision = runtime.server.gameplayRevision;

  const advance = await startSurvivalBreak(runtime);

  expect(advance.commits.length).toBeGreaterThan(0);
  expectCropRemoved(runtime);
  expect(runtime.server.worldRevision).toBeGreaterThan(worldRevision);
  expect(runtime.server.gameplayRevision).toBeGreaterThan(gameplayRevision);
  // Normal block drops may be picked up by the player; inventory is deliberately not used as a no-change oracle.
});

it('RED: registered Creative immediate begin removes the crop in the same block transaction', async () => {
  const runtime = await create();
  await loadFixture(runtime);
  await plantCrop(runtime);
  expect(invoke(runtime, 'seedlands:set-mode', { mode: 'creative' })).toMatchObject({ ok: true });
  runtime.takeCommits();

  const response = await runtime.performAction({ type: 'begin-break', position: [...hit] });

  expect(response.result).toMatchObject({ success: true });
  expect(response.commits.length).toBeGreaterThan(0);
  expect(runtime.server.peekLoadedVoxel(...hit)?.voxel).toBe(Voxel.Air);
  expectCropRemoved(runtime);
});

it('RED: restored crop is removed by registered Survival finish and stays absent after another restore', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const runtime = await create(testCorePlatform, persistence);
  await loadFixture(runtime);
  await plantCrop(runtime);
  await runtime.persistPortableCheckpoint(runtime.exportPortableCheckpoint());

  const restored = await create(testCorePlatform, persistence);
  expect(restored.server.crops.checkpoint()).toEqual(runtime.server.crops.checkpoint());
  await expect(restored.server.prepareCanonicalChunkForMutation(0, 1, 0)).resolves.toBe(true);
  expect(restored.server.peekLoadedVoxel(...floor)?.voxel).toBe(Voxel.Stone);
  expect(restored.server.peekLoadedVoxel(...hit)?.voxel).toBe(Voxel.Farmland);
  restored.takeCommits();

  await startSurvivalBreak(restored);

  expectCropRemoved(restored);
  await restored.persistPortableCheckpoint(restored.exportPortableCheckpoint());
  const restoredAgain = await create(testCorePlatform, persistence);
  expect(restoredAgain.server.crops.checkpoint().crops).toEqual([]);
});

it('accepts the actual pre-support identity in a V4 restore fixture and removes its crop through the registered action', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const runtime = await create(testCorePlatform, persistence);
  await loadFixture(runtime);
  await plantCrop(runtime);
  const checkpoint = runtime.exportPortableCheckpoint();
  // The identity is a real production capture; the child payload is a focused compatibility fixture.
  persistence.saveFrozenSnapshot({
    ...checkpoint,
    gameplay: { ...preTransportGameplayFixture(checkpoint.gameplay), composition: previousIdentity() },
  });
  const restored = await create(testCorePlatform, persistence);
  expect(restored.server.crops.checkpoint()).toEqual(runtime.server.crops.checkpoint());
  await expect(restored.server.prepareCanonicalChunkForMutation(0, 1, 0)).resolves.toBe(true);
  await startSurvivalBreak(restored);
  expectCropRemoved(restored);
});

it.each(['integrity', 'definition'] as const)('rejects a pre-support V4 identity with altered %s', async (field) => {
  const runtime = await create();
  const identity = previousIdentity();
  const altered =
    field === 'integrity'
      ? {
          ...identity,
          packLock: identity.packLock.map((pack) => ({
            ...pack,
            integrity: { ...pack.integrity, entryDigest: '0'.repeat(64) },
          })),
        }
      : {
          ...identity,
          definitionMap: {
            ...identity.definitionMap,
            capabilities: identity.definitionMap.capabilities.map((capability) =>
              capability.id === 'seedlands:block-actions'
                ? { ...capability, definitionIdentity: 'unapproved-crop-support' }
                : capability,
            ),
          },
        };
  const checkpoint = runtime.exportPortableCheckpoint();
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  persistence.saveFrozenSnapshot({ ...checkpoint, gameplay: { ...checkpoint.gameplay, composition: altered } });
  await expect(create(testCorePlatform, persistence)).rejects.toThrow(/composition identity/i);
});

it('RED: expected-null crop observation rejects prepared support removal if a crop appears', async () => {
  const fixture: { runtime?: Runtime } = {};
  let armed = false;
  let triggered = false;
  const platform: CorePlatformPorts = {
    ...testCorePlatform,
    clone: <Value>(value: Value): Value => {
      if (
        armed &&
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        Object.hasOwn(value, 'kind') &&
        (value as { kind?: unknown }).kind === 'begin' &&
        Object.hasOwn(value, 'actorId') &&
        Object.hasOwn(value, 'commit')
      ) {
        armed = false;
        triggered = true;
        const crops = fixture.runtime?.server.crops;
        if (!crops) throw new Error('Crop owner race fixture is unavailable.');
        // Test-only owner-state injection, not a registered player planting action or permission proof.
        const participant = crops.prepareChange(hit, null, { position: hit, stage: 0, subSeconds: 0 });
        participant.validate();
        participant.apply();
      }
      return structuredClone(value);
    },
  };
  const runtime = await create(platform);
  fixture.runtime = runtime;
  await loadFixture(runtime);
  expect(runtime.server.crops.at(hit)).toBeNull();
  expect(invoke(runtime, 'seedlands:set-mode', { mode: 'creative' })).toMatchObject({ ok: true });
  runtime.takeCommits();
  const inventoryBefore = runtime.server.getInventoryPointerView(runtime.playerId);
  const worldRevision = runtime.server.worldRevision;
  const gameplayRevision = runtime.server.gameplayRevision;
  const commitSequence = runtime.server.commitSequence;
  armed = true;

  const response = await runtime.performAction({ type: 'begin-break', position: [...hit] });

  expect(triggered).toBe(true);
  expect(response.result).toMatchObject({ success: false });
  expect(response.commits).toEqual([]);
  expect(runtime.server.peekLoadedVoxel(...hit)?.voxel).toBe(Voxel.Farmland);
  expect(runtime.server.crops.at(hit)).toMatchObject({ position: hit, stage: 0 });
  expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(inventoryBefore);
  expect(runtime.server.worldRevision).toBe(worldRevision);
  expect(runtime.server.gameplayRevision).toBe(gameplayRevision);
  expect(runtime.server.commitSequence).toBe(commitSequence);
});
