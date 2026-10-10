import { describe, expect, it } from 'vitest';
import {
  buildMediaPlaybackCandidateV1,
  type MediaPlaybackStateV1,
} from '../../src/server/gameplay/modules/media-playback-model';
import {
  MEDIA_ACTIVATE_OPERATION,
  MEDIA_EJECT_OPERATION,
  MEDIA_INSERT_OPERATION,
  MEDIA_STOP_OPERATION,
  MEDIA_SWITCH_OPERATION,
} from '../../src/server/gameplay/modules/media-playback-module';
import {
  address,
  context,
  first,
  fixture,
  model,
  prepare,
  second,
  third,
} from './registered-media-playback-runtime-fixture';

describe('RegisteredMediaPlaybackRuntime', () => {
  it('owns independent per-position revisions and restores deterministic resume-pending checkpoints', () => {
    const world = fixture();
    const insertFirst = prepare(world, MEDIA_INSERT_OPERATION, first, { kind: 'insert', itemId: 'sample:first-disc' });
    insertFirst.validate();
    insertFirst.apply();

    world.changeActor({
      selectedItemId: 'second-disc',
      selectedSlot: 1,
      slots: [null, { itemId: 'second-disc', count: 1 }],
      inventoryRevision: world.actor().inventoryRevision + 1,
    });
    const insertSecond = prepare(world, MEDIA_INSERT_OPERATION, second, {
      kind: 'insert',
      itemId: 'sample:second-disc',
    });
    insertSecond.validate();
    insertSecond.apply();
    const activateSecond = prepare(world, MEDIA_ACTIVATE_OPERATION, second, { kind: 'activate' });
    activateSecond.validate();
    activateSecond.apply();

    expect(world.runtime.read(first)).toMatchObject({ revision: 1, slot: { trackId: 'sample:first-track' } });
    expect(world.runtime.read(second)).toMatchObject({ revision: 3, playing: true });
    const checkpoint = world.runtime.checkpoint();
    expect(checkpoint.devices.map(({ position, snapshot }) => [position, snapshot.revision])).toEqual([
      [first, 1],
      [second, 3],
    ]);

    const restored = fixture();
    const restore = restored.runtime.prepareCheckpointCandidate(checkpoint);
    expect(() => restore.apply()).toThrow(/validation/i);
    restore.validate();
    restore.apply();
    expect(restored.runtime.read(first)).toMatchObject({ revision: 1, playing: false, resumePending: false });
    expect(restored.runtime.read(second)).toMatchObject({ revision: 3, playing: false, resumePending: true });
    expect(() => restore.apply()).toThrow(/validation|stale/i);
  });

  it('commits insert, activate, stop, switch and eject with inventory and media in one prepared plan', () => {
    const world = fixture();
    for (const [operationId, action] of [
      [MEDIA_INSERT_OPERATION, { kind: 'insert', itemId: 'sample:first-disc' }],
      [MEDIA_ACTIVATE_OPERATION, { kind: 'activate' }],
      [MEDIA_STOP_OPERATION, { kind: 'stop' }],
    ] as const) {
      const plan = prepare(world, operationId, first, action);
      plan.validate();
      plan.apply();
    }
    expect(world.actor().slots).toEqual([null, null]);
    expect(world.runtime.read(first)).toMatchObject({ revision: 3, playing: false });

    world.changeActor({
      selectedItemId: 'second-disc',
      slots: [{ itemId: 'second-disc', count: 1 }, null],
      inventoryRevision: world.actor().inventoryRevision + 1,
    });
    const switched = prepare(world, MEDIA_SWITCH_OPERATION, first, { kind: 'switch', itemId: 'sample:second-disc' });
    switched.validate();
    switched.apply();
    expect(world.actor().slots).toEqual([{ itemId: 'first-disc', count: 1 }, null]);
    expect(world.runtime.read(first)).toMatchObject({ revision: 4, slot: { itemId: 'sample:second-disc' } });

    const ejected = prepare(world, MEDIA_EJECT_OPERATION, first, { kind: 'eject' });
    ejected.validate();
    ejected.apply();
    expect(world.actor().slots).toEqual([
      { itemId: 'first-disc', count: 1 },
      { itemId: 'second-disc', count: 1 },
    ]);
    expect(world.runtime.read(first)).toMatchObject({ revision: 5, slot: null, playing: false });
    expect(world.mediaChanges.mock.calls).toEqual([[true], [false], [false], [true], [true]]);
    expect(world.authorizations).toHaveBeenCalledTimes(10);
    expect(world.reachability).toHaveBeenCalledTimes(10);
  });

  it('rejects stale actor, device and forged candidates before either participant applies', () => {
    const actorStale = fixture();
    const pending = prepare(actorStale, MEDIA_INSERT_OPERATION, first, {
      kind: 'insert',
      itemId: 'sample:first-disc',
    });
    actorStale.changeActor({ inventoryRevision: 4 });
    expect(() => pending.validate()).toThrow(/actor-stale|inventory-stale/i);
    expect(actorStale.inventoryApplies).not.toHaveBeenCalled();
    expect(actorStale.runtime.read(first)).toMatchObject({ revision: 0, slot: null });

    const deviceStale = fixture();
    const devicePlan = prepare(deviceStale, MEDIA_INSERT_OPERATION, first, {
      kind: 'insert',
      itemId: 'sample:first-disc',
    });
    deviceStale.voxels.set(first.join(','), 'sample:stone');
    expect(() => devicePlan.validate()).toThrow(/device/i);
    expect(deviceStale.inventoryApplies).not.toHaveBeenCalled();

    const unreachable = fixture();
    unreachable.reachability.mockImplementationOnce(() => {
      throw new Error('out-of-range');
    });
    expect(() =>
      prepare(unreachable, MEDIA_INSERT_OPERATION, first, { kind: 'insert', itemId: 'sample:first-disc' }),
    ).toThrow(/out-of-range/i);
    expect(unreachable.inventoryApplies).not.toHaveBeenCalled();
    expect(unreachable.runtime.read(first)).toMatchObject({ revision: 0, slot: null });

    const movedAfterPrepare = fixture();
    let reachabilityChecks = 0;
    movedAfterPrepare.reachability.mockImplementation(() => {
      if (++reachabilityChecks === 2) throw new Error('blocked');
    });
    const movedPlan = prepare(movedAfterPrepare, MEDIA_INSERT_OPERATION, first, {
      kind: 'insert',
      itemId: 'sample:first-disc',
    });
    expect(() => movedPlan.validate()).toThrow(/blocked/i);
    expect(movedAfterPrepare.inventoryApplies).not.toHaveBeenCalled();
    expect(movedAfterPrepare.runtime.read(first)).toMatchObject({ revision: 0, slot: null });

    const forged = fixture();
    const current = forged.runtime.state.read(address(first));
    const candidate = buildMediaPlaybackCandidateV1({
      model,
      device: { kind: 'voxel', position: first, definitionId: 'sample:player' },
      state: current.value as MediaPlaybackStateV1,
      expectedRevision: 0,
      action: { kind: 'insert', itemId: 'sample:first-disc' },
    });
    expect(() =>
      forged.runtime.state.prepareCommit!(
        [{ address: address(first), revision: 0 }],
        [{ address: address(first), value: candidate.state }],
        context(
          MEDIA_INSERT_OPERATION,
          first,
          { ...candidate.fact, trackId: 'sample:forged' },
          {
            expectedRevision: 0,
            itemId: 'sample:first-disc',
          },
        ),
      ),
    ).toThrow(/candidate-stale/i);
    expect(forged.inventoryApplies).not.toHaveBeenCalled();
    expect(forged.runtime.read(first)).toMatchObject({ revision: 0, slot: null });
  });

  it('rejects a second plan prepared from an already committed media revision', () => {
    const world = fixture();
    const accepted = prepare(world, MEDIA_INSERT_OPERATION, first, {
      kind: 'insert',
      itemId: 'sample:first-disc',
    });
    const stale = prepare(world, MEDIA_INSERT_OPERATION, first, {
      kind: 'insert',
      itemId: 'sample:first-disc',
    });
    accepted.validate();
    accepted.apply();

    expect(() => stale.validate()).toThrow(/stale/i);
    expect(world.inventoryApplies).toHaveBeenCalledOnce();
    expect(world.runtime.read(first)).toMatchObject({ revision: 1, slot: { itemId: 'sample:first-disc' } });
  });

  it('fails a full-inventory eject and treats creative media as virtual without partial state', () => {
    const full = fixture({
      selectedItemId: 'second-disc',
      slots: [
        { itemId: 'second-disc', count: 1 },
        { itemId: 'stone', count: 64 },
      ],
    });
    const inserted = prepare(full, MEDIA_INSERT_OPERATION, first, { kind: 'insert', itemId: 'sample:second-disc' });
    inserted.validate();
    inserted.apply();
    full.changeActor({
      slots: [
        { itemId: 'stone', count: 64 },
        { itemId: 'stone', count: 64 },
      ],
      selectedItemId: 'stone',
      inventoryRevision: full.actor().inventoryRevision + 1,
    });
    expect(() => prepare(full, MEDIA_EJECT_OPERATION, first, { kind: 'eject' })).toThrow(/inventory-full/i);
    expect(full.runtime.read(first)).toMatchObject({ revision: 1, slot: { itemId: 'sample:second-disc' } });

    const creative = fixture({ mode: 'creative' });
    const creativeInventory = creative.actor().slots;
    const virtualInsert = prepare(creative, MEDIA_INSERT_OPERATION, first, {
      kind: 'insert',
      itemId: 'sample:first-disc',
    });
    virtualInsert.validate();
    virtualInsert.apply();
    const virtualEject = prepare(creative, MEDIA_EJECT_OPERATION, first, { kind: 'eject' });
    virtualEject.validate();
    virtualEject.apply();
    expect(creative.actor().slots).toEqual(creativeInventory);
    expect(creative.inventoryApplies).not.toHaveBeenCalled();
    expect(creative.runtime.read(first)).toMatchObject({ revision: 2, slot: null });
    expect(creative.runtime.checkpoint()).toEqual({ version: 1, devices: [] });
    const emptyRemoval = creative.runtime.prepareDeviceRemoval(first);
    expect(emptyRemoval).toMatchObject({ removed: true, ejectedItem: null, fact: null });
    emptyRemoval.validate();
    emptyRemoval.apply();
    expect(creative.runtime.read(first)).toMatchObject({ revision: 3, slot: null });
  });

  it('fails closed on missing devices and malformed checkpoints without installing state', () => {
    const world = fixture();
    expect(() => world.runtime.state.read(address([9, 9, 9]))).toThrow(/device-unavailable/i);
    expect(() =>
      world.runtime.prepareCheckpointCandidate({
        version: 1,
        devices: [{ position: first, snapshot: { version: 1, deviceId: 'sample:player', revision: 0, slot: null } }],
      }),
    ).toThrow(/shape|intent/i);
    expect(() =>
      world.runtime.prepareCheckpointCandidate({
        version: 1,
        devices: [
          {
            position: first,
            snapshot: { version: 1, deviceId: 'sample:player', revision: 0, slot: null, playingIntent: false },
          },
          {
            position: first,
            snapshot: { version: 1, deviceId: 'sample:player', revision: 0, slot: null, playingIntent: false },
          },
        ],
      }),
    ).toThrow(/duplicate/i);
    const sparse = new Array(1);
    expect(() => world.runtime.prepareCheckpointCandidate({ version: 1, devices: sparse })).toThrow(/dense/i);
    const extra = Object.assign([], { unexpected: true });
    expect(() => world.runtime.prepareCheckpointCandidate({ version: 1, devices: extra })).toThrow(/dense/i);
    expect(world.runtime.checkpoint()).toEqual({ version: 1, devices: [] });
  });

  it('counts empty live-instance revisions against the bounded entry limit until device removal', () => {
    const world = fixture({ mode: 'creative' }, 2);
    for (const [index, at] of [first, second].entries()) {
      const inserted = prepare(world, MEDIA_INSERT_OPERATION, at, { kind: 'insert', itemId: 'sample:first-disc' });
      inserted.validate();
      inserted.apply();
      const ejected = prepare(world, MEDIA_EJECT_OPERATION, at, { kind: 'eject' });
      ejected.validate();
      ejected.apply();
      expect(world.runtime.read(at).revision).toBe((index + 1) * 2);
    }
    expect(world.runtime.checkpoint()).toEqual({ version: 1, devices: [] });

    const overCapacity = prepare(world, MEDIA_INSERT_OPERATION, third, {
      kind: 'insert',
      itemId: 'sample:first-disc',
    });
    expect(() => overCapacity.validate()).toThrow(/capacity/i);
    expect(world.runtime.read(third)).toMatchObject({ revision: 4, slot: null });

    const release = world.runtime.prepareDependentRemoval(first);
    release.validate();
    release.apply();
    const accepted = prepare(world, MEDIA_INSERT_OPERATION, third, {
      kind: 'insert',
      itemId: 'sample:first-disc',
    });
    accepted.validate();
    accepted.apply();
    expect(world.runtime.read(third)).toMatchObject({ revision: 6, slot: { itemId: 'sample:first-disc' } });
  });

  it('rejects a lower-revision device mutation when the epoch revision high-water is exhausted', () => {
    const world = fixture({ mode: 'creative' });
    const restore = world.runtime.prepareCheckpointCandidate({
      version: 1,
      devices: [
        {
          position: first,
          snapshot: {
            version: 1,
            deviceId: 'sample:player',
            revision: 1,
            slot: { itemId: 'sample:first-disc', trackId: 'sample:first-track' },
            playingIntent: false,
          },
        },
        {
          position: second,
          snapshot: {
            version: 1,
            deviceId: 'sample:player',
            revision: Number.MAX_SAFE_INTEGER,
            slot: { itemId: 'sample:second-disc', trackId: 'sample:second-track' },
            playingIntent: false,
          },
        },
      ],
    });
    restore.validate();
    restore.apply();
    const before = world.runtime.checkpoint();

    expect(() => prepare(world, MEDIA_ACTIVATE_OPERATION, first, { kind: 'activate' })).toThrow(/exhausted/i);
    expect(() => world.runtime.prepareDeviceRemoval(first)).toThrow(/exhausted/i);
    expect(world.runtime.checkpoint()).toEqual(before);
  });

  it('prepares a missing legacy media child as an empty owner checkpoint', () => {
    const world = fixture();
    const inserted = prepare(world, MEDIA_INSERT_OPERATION, first, { kind: 'insert', itemId: 'sample:first-disc' });
    inserted.validate();
    inserted.apply();
    expect(world.runtime.checkpoint().devices).toHaveLength(1);

    const legacy = world.runtime.prepareCheckpointCandidate(undefined);
    expect(legacy.checkpoint).toEqual({ version: 1, devices: [] });
    legacy.validate();
    legacy.apply();
    expect(world.runtime.checkpoint()).toEqual({ version: 1, devices: [] });
    expect(world.runtime.read(first)).toMatchObject({ revision: 0, slot: null, playing: false, resumePending: false });
  });

  it('removes an occupied device through a prepared lifecycle participant without dropping checkpoint media', () => {
    const world = fixture();
    const inserted = prepare(world, MEDIA_INSERT_OPERATION, first, { kind: 'insert', itemId: 'sample:first-disc' });
    inserted.validate();
    inserted.apply();

    const removal = world.runtime.prepareDeviceRemoval(first);
    expect(removal).toMatchObject({
      removed: true,
      ejectedItem: { itemId: 'sample:first-disc', trackId: 'sample:first-track' },
      fact: { kind: 'eject', revision: 2, playing: false, trackId: null },
    });
    expect(Object.isFrozen(removal.ejectedItem)).toBe(true);
    expect(Object.isFrozen(removal.fact)).toBe(true);
    expect(world.runtime.checkpoint().devices).toHaveLength(1);
    expect(() => removal.apply()).toThrow(/validation/i);
    removal.validate();
    removal.apply();
    expect(world.runtime.checkpoint()).toEqual({ version: 1, devices: [] });

    const replacement = world.runtime.read(first);
    expect(replacement).toMatchObject({ revision: 2, slot: null, playing: false, resumePending: false });
    expect(() => removal.apply()).toThrow(/validation|stale/i);
  });

  it('rejects stale device removal before mutation and fails checkpoint on an orphaned occupied device', () => {
    const stale = fixture();
    const inserted = prepare(stale, MEDIA_INSERT_OPERATION, first, { kind: 'insert', itemId: 'sample:first-disc' });
    inserted.validate();
    inserted.apply();
    const removal = stale.runtime.prepareDeviceRemoval(first);
    stale.voxels.set(first.join(','), 'sample:stone');
    expect(() => removal.validate()).toThrow(/device/i);
    expect(() => stale.runtime.checkpoint()).toThrow(/orphan/i);

    stale.voxels.set(first.join(','), 'sample:player-block');
    expect(stale.runtime.read(first)).toMatchObject({ revision: 1, slot: { itemId: 'sample:first-disc' } });
  });
});
