import { describe, expect, it } from 'vitest';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import type { AuthorityAction } from '../../../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import type { CorePlatformPorts } from '../../../../../../../packages/stdlib/src/runtime/platform-ports';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { classicOptions } from '../../../../fixtures/classic/content';
import { pack } from '../../../../../../../playbooks/classic/src/pack';
import { classicFluidContainerOperationId } from '../../../../../../../playbooks/classic/src/item-interactions';
import { defineFluidContainerInteractionModule, definePack } from '@seedlands/stdlib/mod-api';
import {
  assembleOverworldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';

type Runtime = Awaited<ReturnType<typeof create>>;
type ClassicOptions = ReturnType<typeof classicOptions>;
const create = (options: ClassicOptions = classicOptions(), platform: CorePlatformPorts = testCorePlatform) =>
  AuthorityRuntime.create({
    ...options,
    worldgenProvider: classicWorldgenProvider,
    platform,
    epoch: 'classic-fluid-interactions',
    seedText: 'classic-fluid-interactions',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 60, 0.5],
  });
const classicOptionsWithReplaceableWater = (): ClassicOptions => {
  const fluid = defineFluidContainerInteractionModule({
    moduleId: 'seedlands:fluid-container-handler',
    operationId: classicFluidContainerOperationId,
    emptyItemId: 'bucket',
    emptyVoxel: Voxel.Air,
    filled: [
      { itemId: 'water-bucket', voxel: Voxel.Water },
      { itemId: 'lava-bucket', voxel: Voxel.Lava },
    ],
    replaceableVoxels: [Voxel.Air, Voxel.Fire, Voxel.Water],
  });
  const modules = pack.modules.map((module) =>
    module.descriptor.id === 'seedlands:fluid-container-handler' ? fluid : module,
  );
  const fixturePack = definePack({
    id: pack.manifest.id,
    version: pack.manifest.version,
    kind: pack.manifest.kind,
    entry: pack.manifest.entry,
    resources: pack.manifest.resources,
    presentation: pack.manifest.presentation,
    providerSelections: pack.manifest.providerSelections,
    modules,
  });
  const composition = assembleOverworldPacks([
    {
      ...fixturePack,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: (fixturePack.manifest.resources ?? []).map((path) => ({ path, digest: 'c'.repeat(64) })),
      },
    },
  ]);
  return {
    composition,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
  };
};
const selection = (runtime: Runtime) => {
  const player = runtime.server.getPlayerState(runtime.playerId);
  return {
    inventoryRevision: runtime.server.getInventoryPointerView(runtime.playerId).revision,
    modeRevision: player.mode!.revision,
    creativeCatalogRevision: player.creativeCatalog!.revision,
    selectedSlot: player.mode!.value === 'creative' ? player.creativeCatalog!.selectedSlot : player.selectedSlot,
  };
};
const action = (
  runtime: Runtime,
  hit: [number, number, number],
  adjacent: [number, number, number],
): AuthorityAction => ({
  type: 'interact',
  intent: 'use',
  target: { kind: 'voxel', hit, adjacent },
  expectedSelection: selection(runtime),
});
const load = (runtime: Runtime, edits: readonly { x: number; y: number; z: number; value: number }[]) =>
  expect(runtime.editWorld('fluid-fixture', edits)).resolves.toMatchObject({ committed: true });
const invokeMode = (runtime: Runtime, operationId: string, input: Record<string, unknown>) =>
  runtime.server.invokeActorModuleOperation(runtime.playerId, {
    operationId,
    target: { kind: 'entity', entityId: runtime.playerId },
    input,
  });

describe('Classic fluid interactions through Authority', () => {
  it.each([
    [Voxel.Water, 'water-bucket'],
    [Voxel.Lava, 'lava-bucket'],
  ] as const)('fills and empties source voxel %s symmetrically', async (voxel, filled) => {
    const runtime = await create();
    await load(runtime, [
      { x: 1, y: 59, z: 0, value: voxel },
      { x: 1, y: 60, z: 0, value: Voxel.Air },
      { x: -1, y: 59, z: 0, value: Voxel.Stone },
      { x: -1, y: 60, z: 0, value: Voxel.Air },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'bucket', count: 1 });
    expect((await runtime.performAction(action(runtime, [1, 59, 0], [1, 60, 0]))).result).toMatchObject({
      success: true,
      handled: true,
    });
    expect(runtime.server.getVoxel(1, 59, 0)).toBe(Voxel.Air);
    expect(runtime.server.getInventory(runtime.playerId).slots[0]).toEqual({ itemId: filled, count: 1 });
    expect((await runtime.performAction(action(runtime, [-1, 59, 0], [-1, 60, 0]))).result).toMatchObject({
      success: true,
      handled: true,
    });
    expect(runtime.server.getVoxel(-1, 60, 0)).toBe(voxel);
    expect(runtime.server.getInventory(runtime.playerId).slots[0]).toEqual({ itemId: 'bucket', count: 1 });
  });

  it.each(['inventory', 'slot', 'mode', 'creative-catalog'] as const)(
    'rejects stale %s selection without side effects',
    async (kind) => {
      const runtime = await create();
      await load(runtime, [
        { x: 1, y: 59, z: 0, value: Voxel.Stone },
        { x: 1, y: 60, z: 0, value: Voxel.Air },
      ]);
      runtime.server.giveItem(runtime.playerId, { itemId: 'water-bucket', count: 1 });
      runtime.server.giveItem(runtime.playerId, { itemId: 'lava-bucket', count: 1 });
      if (kind === 'creative-catalog') {
        expect(invokeMode(runtime, 'seedlands:set-mode', { mode: 'creative' })).toMatchObject({ ok: true });
        expect(
          invokeMode(runtime, 'seedlands:set-creative-catalog', { slot: 0, itemId: 'water-bucket' }),
        ).toMatchObject({ ok: true });
      }
      const request = action(runtime, [1, 59, 0], [1, 60, 0]);
      if (kind === 'inventory') runtime.server.giveItem(runtime.playerId, { itemId: 'stone-block', count: 1 });
      if (kind === 'slot') runtime.server.selectHotbarSlot(runtime.playerId, 1);
      if (kind === 'mode')
        expect(invokeMode(runtime, 'seedlands:set-mode', { mode: 'creative' })).toMatchObject({ ok: true });
      if (kind === 'creative-catalog')
        expect(invokeMode(runtime, 'seedlands:set-creative-catalog', { slot: 1, itemId: 'lava-bucket' })).toMatchObject(
          { ok: true },
        );
      const before = runtime.server.getInventoryPointerView(runtime.playerId);
      const revisions = [runtime.server.worldRevision, runtime.server.gameplayRevision];
      expect((await runtime.performAction(request)).result).toEqual({ success: false, reason: 'stale-selection' });
      expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(before);
      expect(runtime.server.getVoxel(1, 60, 0)).toBe(Voxel.Air);
      expect([runtime.server.worldRevision, runtime.server.gameplayRevision]).toEqual(revisions);
    },
  );

  it('uses current creative selection without consuming or producing a bucket', async () => {
    const runtime = await create();
    await load(runtime, [
      { x: 1, y: 59, z: 0, value: Voxel.Stone },
      { x: 1, y: 60, z: 0, value: Voxel.Air },
    ]);
    expect(invokeMode(runtime, 'seedlands:set-mode', { mode: 'creative' })).toMatchObject({ ok: true });
    expect(invokeMode(runtime, 'seedlands:set-creative-catalog', { slot: 0, itemId: 'water-bucket' })).toMatchObject({
      ok: true,
    });
    const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
    const revisions = [runtime.server.worldRevision, runtime.server.gameplayRevision];
    expect((await runtime.performAction(action(runtime, [1, 59, 0], [1, 60, 0]))).result).toMatchObject({
      success: true,
      handled: true,
    });
    expect(runtime.server.getVoxel(1, 60, 0)).toBe(Voxel.Water);
    expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(inventory);
    expect(runtime.server.worldRevision).toBe(revisions[0]! + 1);
    expect(runtime.server.gameplayRevision).toBe(revisions[1]! + 1);
  });

  it('keeps state on occupied, non-source, and full-inventory failures', async () => {
    const runtime = await create();
    await load(runtime, [
      { x: 1, y: 59, z: 0, value: Voxel.Stone },
      { x: 1, y: 60, z: 0, value: Voxel.Stone },
      { x: -1, y: 59, z: 0, value: Voxel.Water },
      { x: -1, y: 60, z: 0, value: Voxel.Air },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'water-bucket', count: 1 });
    const unchanged = async (request: AuthorityAction, reason: string) => {
      const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
      const revisions = [runtime.server.worldRevision, runtime.server.gameplayRevision];
      expect((await runtime.performAction(request)).result).toEqual({ success: false, reason });
      expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(inventory);
      expect([runtime.server.worldRevision, runtime.server.gameplayRevision]).toEqual(revisions);
    };
    await unchanged(action(runtime, [1, 59, 0], [1, 60, 0]), 'target-occupied');
    runtime.server.removeItem(runtime.playerId, { itemId: 'water-bucket', count: 1 });
    runtime.server.giveItem(runtime.playerId, { itemId: 'bucket', count: 1 });
    await unchanged(action(runtime, [1, 59, 0], [1, 60, 0]), 'not-fluid-source');
    runtime.server.removeItem(runtime.playerId, { itemId: 'bucket', count: 1 });
    runtime.server.giveItem(runtime.playerId, { itemId: 'bucket', count: 16 });
    for (let slot = 1; slot < 36; slot++)
      runtime.server.giveItem(runtime.playerId, { itemId: 'stone-block', count: 64 });
    await unchanged(action(runtime, [-1, 59, 0], [-1, 60, 0]), 'inventory-full');
  });

  it('keeps inventory and world unchanged when a valid replacement resolves to the current voxel', async () => {
    const runtime = await create(classicOptionsWithReplaceableWater());
    await load(runtime, [
      { x: 1, y: 59, z: 0, value: Voxel.Stone },
      { x: 1, y: 60, z: 0, value: Voxel.Water },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'water-bucket', count: 1 });
    runtime.takeCommits();
    const before = runtime.server.getInventoryPointerView(runtime.playerId);
    const revisions = [runtime.server.worldRevision, runtime.server.gameplayRevision];
    const response = await runtime.performAction(action(runtime, [1, 59, 0], [1, 60, 0]));

    expect(response.result).toEqual({ success: false, reason: 'world-not-changed' });
    expect(response.commits).toEqual([]);
    expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(before);
    expect(runtime.server.getVoxel(1, 60, 0)).toBe(Voxel.Water);
    expect([runtime.server.worldRevision, runtime.server.gameplayRevision]).toEqual(revisions);
  });

  it('keeps the prepared target and inventory unchanged when an external world commit makes it stale', async () => {
    const fixture: { runtime?: Runtime } = {};
    let armed = false;
    let externalCommit: ReturnType<Runtime['server']['editBatch']> | null = null;
    const platform: CorePlatformPorts = {
      ...testCorePlatform,
      clone: <Value>(value: Value): Value => {
        if (
          armed &&
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.hasOwn(value, 'commit')
        ) {
          armed = false;
          if (!fixture.runtime) throw new Error('Stale fixture runtime is unavailable.');
          externalCommit = fixture.runtime.server.editBatch({
            actorId: 'external-stale-fixture',
            edits: [{ x: 40, y: 59, z: 0, value: Voxel.Dirt }],
          });
        }
        return structuredClone(value);
      },
    };
    const runtime = await create(classicOptions(), platform);
    fixture.runtime = runtime;
    await load(runtime, [
      { x: 1, y: 59, z: 0, value: Voxel.Stone },
      { x: 1, y: 60, z: 0, value: Voxel.Air },
      { x: 40, y: 59, z: 0, value: Voxel.Stone },
    ]);
    runtime.server.giveItem(runtime.playerId, { itemId: 'water-bucket', count: 1 });
    runtime.takeCommits();
    const before = runtime.server.getInventoryPointerView(runtime.playerId);
    const revisions = [runtime.server.worldRevision, runtime.server.gameplayRevision];
    const targetChunkBefore = runtime.server.readCollisionBaseline('0,1,0', 0);
    armed = true;
    const response = await runtime.performAction(action(runtime, [1, 59, 0], [1, 60, 0]));

    expect(response.result).toEqual({ success: false, reason: 'interaction-stale' });
    expect(response.commits).toEqual([]);
    expect(externalCommit).toMatchObject({ committed: true, worldRevision: revisions[0]! + 1 });
    expect(runtime.server.getVoxel(40, 59, 0)).toBe(Voxel.Dirt);
    expect(runtime.server.getVoxel(1, 60, 0)).toBe(Voxel.Air);
    expect(runtime.server.readCollisionBaseline('0,1,0', 0)).toEqual(targetChunkBefore);
    expect(runtime.server.getInventoryPointerView(runtime.playerId)).toEqual(before);
    expect(runtime.server.worldRevision).toBe(revisions[0]! + 1);
    expect(runtime.server.gameplayRevision).toBe(revisions[1]);
  });
});
