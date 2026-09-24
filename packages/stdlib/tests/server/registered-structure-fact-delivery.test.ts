import { describe, expect, it } from 'vitest';
import type { ModuleInvocationValue } from '../../src/server/composition/contracts';
import { Voxel } from '../../src/world/voxel';
import { createStructureRuntimeFixture, placeStructure } from './registered-structure-runtime-fixture';

describe('registered Structure fact delivery', () => {
  it('delivers both position-bound removal facts once after canonical, ECS, receipt and gameplay state', () => {
    const source: ModuleInvocationValue[][] = [
      [{ version: 1, kind: 'media-removed', position: [1, 31, 0], mediaRevision: 4 }],
      [{ version: 1, kind: 'media-removed', position: [1, 32, 0], mediaRevision: 7 }],
    ];
    const expected = structuredClone(source);
    let mutate = false;
    const world = createStructureRuntimeFixture({
      removalFacts: source,
      afterFactDeliveryPrepared() {
        if (mutate) source[0]![0] = { version: 1, kind: 'tampered', position: [99, 99, 99] };
      },
    });
    expect(placeStructure(world)).toMatchObject({ ok: true });
    expect(world.takeFactBatches()).toEqual([expect.objectContaining({ facts: [] })]);

    mutate = true;
    expect(world.invoke('break', [1, 32, 0], [2, 32, 0])).toMatchObject({ ok: true, value: { kind: 'break' } });
    expect(world.factBatches()).toEqual([
      {
        facts: [expected[0]![0], expected[1]![0]],
        worldRevision: world.server.worldRevision,
        gameplayRevision: world.gameplayRevision(),
      },
    ]);
    expect(Object.isFrozen(world.factBatches()[0]!.facts)).toBe(true);
    expect(Object.isFrozen(world.factBatches()[0]!.facts[0])).toBe(true);
  });

  it('rejects more facts than the bounded Structure footprint before applying any owner', () => {
    const facts = [
      Array.from({ length: 65 }, (_, index) => ({ version: 1, kind: 'removed', ordinal: index })),
      [],
    ] satisfies readonly (readonly ModuleInvocationValue[])[];
    const world = createStructureRuntimeFixture({ removalFacts: facts });
    expect(placeStructure(world)).toMatchObject({ ok: true });
    world.takeFactBatches();
    world.runtime.takeCommits();
    const before = [world.server.worldRevision, world.gameplayRevision(), world.actor.inventoryRevision];

    expect(world.invoke('break', [1, 31, 0], [2, 31, 0])).toMatchObject({
      ok: false,
      message: 'Structure fact delivery capacity exceeded.',
    });
    expect([world.server.worldRevision, world.gameplayRevision(), world.actor.inventoryRevision]).toEqual(before);
    expect(world.server.getVoxel(1, 31, 0)).not.toBe(Voxel.Air);
    expect(world.server.getVoxel(1, 32, 0)).not.toBe(Voxel.Air);
    expect(world.factBatches()).toEqual([]);
    expect(world.runtime.takeCommits()).toEqual([]);
  });

  it('prepares an explicit empty delivery batch for a no-media Structure operation', () => {
    const world = createStructureRuntimeFixture();
    expect(placeStructure(world)).toMatchObject({ ok: true });
    expect(world.factBatches()).toEqual([
      { facts: [], worldRevision: world.server.worldRevision, gameplayRevision: world.gameplayRevision() },
    ]);
  });

  it.each([
    ['world', { failWorldValidateOnce: true }, 'world-validation-failure'],
    ['gameplay', { failGameplayValidateOnce: true }, 'gameplay-validation-failure'],
    ['delivery', { failDeliveryValidateOnce: true }, 'fact-delivery-validation-failure'],
  ] as const)('keeps every owner and fact delivery unchanged when %s validation fails', (_label, failure, message) => {
    const world = createStructureRuntimeFixture(failure);
    const before = [world.server.worldRevision, world.gameplayRevision(), world.actor.inventoryRevision];
    expect(placeStructure(world)).toMatchObject({ ok: false, message });
    expect([world.server.worldRevision, world.gameplayRevision(), world.actor.inventoryRevision]).toEqual(before);
    expect(world.server.getVoxel(1, 31, 0)).toBe(Voxel.Air);
    expect(world.server.getVoxel(1, 32, 0)).toBe(Voxel.Air);
    expect(world.entities.query({ type: 'world-item' })).toEqual([]);
    expect(world.runtime.takeCommits()).toEqual([]);
    expect(world.factBatches()).toEqual([]);
  });

  it.each([
    ['second-removal', { failRemovalPrepareAt: 2 }, 'dependent-removal-prepare-failure'],
    ['delivery-capacity', { failDeliveryPrepareOnce: true }, 'fact-delivery-capacity'],
  ] as const)('does not leak prepared facts after one-shot %s failure', (_label, failure, message) => {
    const facts = [
      [{ version: 1, kind: 'removed', position: [1, 31, 0] }],
      [{ version: 1, kind: 'removed', position: [1, 32, 0] }],
    ] satisfies readonly (readonly ModuleInvocationValue[])[];
    const world = createStructureRuntimeFixture({ ...failure, removalFacts: facts });
    expect(placeStructure(world)).toMatchObject({ ok: true });
    world.takeFactBatches();
    world.runtime.takeCommits();
    const before = [world.server.worldRevision, world.gameplayRevision(), world.actor.inventoryRevision];

    expect(world.invoke('break', [1, 31, 0], [2, 31, 0])).toMatchObject({ ok: false, message });
    expect([world.server.worldRevision, world.gameplayRevision(), world.actor.inventoryRevision]).toEqual(before);
    expect(world.factBatches()).toEqual([]);
    expect(world.runtime.takeCommits()).toEqual([]);
    expect(world.invoke('break', [1, 31, 0], [2, 31, 0])).toMatchObject({ ok: true });
    expect(world.factBatches()).toHaveLength(1);
    expect(world.factBatches()[0]!.facts).toHaveLength(2);
  });
});
