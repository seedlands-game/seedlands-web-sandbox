import type {
  AuthorityAction,
  AuthorityActionResult,
} from '../../../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import type { VoxelTarget } from '../../../../../src/client/presentation/voxel-target';
import { performSecondaryInteraction } from '../../../../../src/app/player/secondary-interaction';
import { performVoxelTargetInteraction } from '../../../../../src/app/player/secondary-interaction';
import { useGameplayHeldItem } from '../../../../../src/app/gameplay/held-item-interaction';
import { expect, it } from 'vitest';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { executeModeCommand } from '../../../../../../../packages/stdlib/src/server/commands/module-command';
import type { CommandSource } from '../../../../../../../packages/stdlib/src/server/commands/command-contract';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { classicOptions } from '../../../../fixtures/classic/content';

type Runtime = Awaited<ReturnType<typeof create>>;
const crop: [number, number, number] = [1, 59, 0];
const cropAbove: [number, number, number] = [1, 60, 0];
const neutralStone: [number, number, number] = [0, 59, 3];
const neutralAbove: [number, number, number] = [0, 60, 3];

const create = () =>
  AuthorityRuntime.create({
    ...classicOptions(),
    worldgenProvider: classicWorldgenProvider,
    platform: testCorePlatform,
    epoch: 'navigation-target-priority',
    seedText: 'navigation-target-priority',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 60, 0.5],
  });

const target = (
  position: [number, number, number],
  adjacent: [number, number, number],
  voxel: number,
): VoxelTarget => ({
  position: [...position],
  adjacent: [...adjacent],
  voxel,
  distance: 1,
  inRange: true,
});
const cropTarget = () => target(crop, cropAbove, Voxel.Farmland);
const stoneTarget = () => target(neutralStone, neutralAbove, Voxel.Stone);

const selectItem = async (runtime: Runtime, itemId: string) => {
  const source: CommandSource = {
    actorId: 'browser-player',
    sourceType: 'browser-player',
    entityId: runtime.playerId,
    capabilities: ['mutation'],
  };
  const invoke = (actorId: string, request: Parameters<typeof runtime.server.invokeActorModuleOperation>[1]) =>
    runtime.server.invokeActorModuleOperation(actorId, request);
  if (runtime.server.getPlayerState(runtime.playerId).mode?.value !== 'creative') {
    const result = executeModeCommand(source, { type: 'set-mode', mode: 'creative' }, invoke);
    expect(result.data).toMatchObject({ mode: 'creative' });
  }
  const selected = executeModeCommand(source, { type: 'set-creative-slot', slot: 0, itemId }, invoke);
  expect(selected.data).toMatchObject({ mode: 'creative' });
  expect(runtime.server.getPlayerState(runtime.playerId).creativeCatalog).toMatchObject({ selectedSlot: 0 });
  expect(runtime.server.getPlayerState(runtime.playerId).creativeCatalog?.hotbar[0]).toBe(itemId);
};

const prepareMatureCrop = async () => {
  const runtime = await create();
  expect(
    await runtime.editWorld('navigation-target-priority-fixture', [
      { x: 0, y: 59, z: 0, value: Voxel.Stone },
      { x: crop[0], y: crop[1], z: crop[2], value: Voxel.Farmland },
      { x: cropAbove[0], y: cropAbove[1], z: cropAbove[2], value: Voxel.Air },
      { x: neutralStone[0], y: neutralStone[1], z: neutralStone[2], value: Voxel.Stone },
      { x: neutralAbove[0], y: neutralAbove[1], z: neutralAbove[2], value: Voxel.Air },
      { x: 3, y: 59, z: 0, value: Voxel.Water },
    ]),
  ).toMatchObject({ committed: true });
  await selectItem(runtime, 'wheat-seeds');
  await interactTarget(runtime, cropTarget(), 'use');
  expect(runtime.server.crops.at(crop)?.stage).toBe(0);
  await selectItem(runtime, 'white-dye');
  await interactTarget(runtime, cropTarget(), 'use');
  expect(runtime.server.crops.at(crop)?.stage).toBe(7);
  await selectItem(runtime, 'map');
  expect(runtime.view().navigation).toMatchObject({ itemId: 'map', kind: 'map', map: null });
  return runtime;
};

const interactTarget = async (runtime: Runtime, voxelTarget: VoxelTarget, intent: 'use' | 'alternate') => {
  const result = await performVoxelTargetInteraction({
    gameplay: runtime.view(),
    target: voxelTarget,
    intent,
    openStation: () => false,
    perform: (action: Extract<AuthorityAction, { type: 'interact' }>) => runtime.performAction(action),
    refresh: () => undefined,
    succeeded: () => undefined,
    failed: () => undefined,
  });
  return result;
};

const secondaryUse = async (runtime: Runtime, voxelTarget: VoxelTarget) => {
  const pending: Array<Promise<AuthorityActionResult>> = [];
  const perform = (action: Extract<AuthorityAction, { type: 'interact' }>) => {
    const request = runtime.performAction(action);
    pending.push(request);
    return request;
  };
  const result = await performSecondaryInteraction({
    target: voxelTarget,
    bypassTarget: false,
    useTarget: (aim, intent) =>
      performVoxelTargetInteraction({
        gameplay: runtime.view(),
        target: aim,
        intent,
        openStation: () => false,
        perform,
        refresh: () => undefined,
        succeeded: () => undefined,
        failed: () => undefined,
      }),
    useHeldItem: () =>
      useGameplayHeldItem({
        gameplay: runtime.view(),
        perform,
        refresh: () => undefined,
        succeeded: () => undefined,
        failed: () => undefined,
        isEdible: () => false,
        consume: () => undefined,
      }),
    place: () => undefined,
    feedback: () => undefined,
  });
  const responses = await Promise.all(pending);
  return { result, responses };
};

it('keeps target-first mature-crop handling ahead of held map use', async () => {
  const runtime = await prepareMatureCrop();
  const request = await secondaryUse(runtime, cropTarget());
  const evidence = {
    secondaryResult: request.result,
    interactionResults: request.responses.map(({ result }) => result),
    crop: runtime.server.crops.at(crop),
    navigation: runtime.server.navigationItems.checkpoint(),
  };
  expect(request.result).toBe('target');
  expect(request.responses).toHaveLength(1);
  expect(request.responses[0]?.result).toMatchObject({ success: true, handled: true, value: { action: 'harvest' } });
  expect(runtime.server.crops.at(crop)).toBeNull();
  expect(runtime.server.navigationItems.checkpoint().maps, JSON.stringify(evidence)).toEqual([]);
});

it('uses the accepted held map after a neutral Stone target and leaves the mature crop intact', async () => {
  const runtime = await prepareMatureCrop();
  const request = await secondaryUse(runtime, stoneTarget());
  expect(request.result).toBe('held-item');
  expect(request.responses).toHaveLength(2);
  expect(request.responses[0]?.result).toMatchObject({ success: false, reason: 'item-no-interaction' });
  expect(request.responses[1]?.result).toMatchObject({ success: true, handled: true });
  expect(runtime.server.navigationItems.checkpoint().maps).toHaveLength(1);
  expect(runtime.view().navigation).toMatchObject({ itemId: 'map', kind: 'map', map: { id: 'map-1' } });
  expect(runtime.server.crops.at(crop)).toMatchObject({ position: crop, stage: 7 });
});
