import { describe, expect, it, vi } from 'vitest';
import type { RegisteredCommitContext } from '../../src/server/composition/operation-contracts';
import { WorldResourceAuthorizer } from '../../src/server/harness/world-authorization';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import { prepareEntityMutation } from '../../src/server/gameplay/prepared-entity-mutation';
import { prepareMediaPlaybackHostCommit } from '../../src/server/gameplay/modules/media-playback-host-commit';
import {
  buildMediaPlaybackCandidateV1,
  createMediaPlaybackStateV1,
  defineMediaPlaybackModelV1,
} from '../../src/server/gameplay/modules/media-playback-model';
import {
  MEDIA_INSERT_OPERATION,
  MEDIA_PLAYBACK_RESOURCE,
  mediaPlaybackAddress,
} from '../../src/server/gameplay/modules/media-playback-module';

const position = [1, 2, 3] as const;
const model = defineMediaPlaybackModelV1({
  version: 1,
  tracks: [{ id: 'sample:track', resource: { packId: 'sample:pack', path: 'assets/audio/track.mp3' } }],
  devices: [
    {
      id: 'sample:device',
      target: { kind: 'voxel', voxelId: 'sample:device-block' },
      tracks: [{ itemId: 'sample:disc', trackId: 'sample:track' }],
    },
  ],
});
const items = createItemDefinitionRegistry([
  { id: 'disc', name: 'Disc', itemType: 'resource', stackLimit: 1, capabilities: [] },
]);

function fixture() {
  const entities = new EntityStore(items);
  entities.spawn({ id: 'alice', type: 'player', position: [0, 2, 3] });
  entities.actorStateAccess('alice').inventory.add({ itemId: 'disc', count: 1 });
  let media = createMediaPlaybackStateV1(model, 'sample:device');
  let hostRevision = 4;
  let failMediaValidation = false;
  const mediaApply = vi.fn();
  const changed = vi.fn();
  const candidate = buildMediaPlaybackCandidateV1({
    model,
    device: { kind: 'voxel', position, definitionId: 'sample:device' },
    state: media,
    expectedRevision: 0,
    action: { kind: 'insert', itemId: 'sample:disc' },
  });
  const address = mediaPlaybackAddress({ kind: 'voxel', position });
  const execution: RegisteredCommitContext = {
    operationId: MEDIA_INSERT_OPERATION,
    resource: MEDIA_PLAYBACK_RESOURCE,
    context: {
      kind: 'actor',
      originalActorId: 'alice',
      principal: { id: 'fixture', boundEntityId: 'alice' },
      provenance: { packId: 'sample:pack', moduleId: 'sample:media' },
      target: { kind: 'voxel', position },
    },
    authorizer: new WorldResourceAuthorizer({ principals: [], rules: [] }),
    candidateValue: candidate.fact,
    effectiveInput: { expectedRevision: 0, itemId: 'sample:disc' },
  };
  const plan = prepareMediaPlaybackHostCommit(
    {
      model,
      items,
      media: {
        deviceAt: () => model.devices[0]!,
        read: () => media,
        prepareReplacement(_at, expected, replacement) {
          let validated = false;
          let used = false;
          return {
            validate() {
              validated = false;
              if (used || media !== expected || failMediaValidation) throw new Error('media-validation-failure');
              validated = true;
            },
            apply() {
              if (used || !validated) throw new Error('media requires validation');
              used = true;
              media = replacement;
              mediaApply();
            },
          };
        },
      },
      readActor: (actorId) => {
        const actor = entities.actorStateAccess(actorId);
        return {
          actorId,
          lifecycle: actor.lifecycle,
          mode: actor.mode,
          inventoryRevision: actor.inventoryRevision,
          selectedSlot: actor.selectedSlot,
          selectedItemId: actor.inventory.slot(actor.selectedSlot)?.itemId ?? null,
          slots: actor.inventory.snapshot(),
        };
      },
      resolveItemStorageId: (itemId) => (itemId === 'sample:disc' ? 'disc' : undefined),
      prepareInventory(input) {
        const actor = entities.actorStateAccess(input.actorId);
        if (input.expectedRevision !== actor.inventoryRevision) throw new Error('inventory-stale');
        const mutation = prepareEntityMutation(entities, {
          actors: [
            {
              reference: entities.createReference(input.actorId)!,
              health: actor.health,
              components: { ...entities.actorComponentSnapshot(input.actorId), inventory: [...input.slots] },
            },
          ],
        });
        return { validate: mutation.validate, apply: () => void mutation.apply() };
      },
      validateObserved: () => undefined,
      assertActorAuthorized: () => undefined,
      assertTargetReachable: () => undefined,
      worldRevision: () => 3,
      prepareGameplayChange(inventoryChanged) {
        const expectedRevision = hostRevision;
        return {
          revision: expectedRevision + 1,
          validate() {
            if (hostRevision !== expectedRevision) throw new Error('gameplay-stale');
          },
          apply() {
            hostRevision += 1;
            changed(inventoryChanged);
          },
        };
      },
      prepareFactDelivery: () => ({ validate() {}, apply() {} }),
    },
    [{ address, revision: 0 }],
    [{ address, value: candidate.state }],
    execution,
  );
  if (!plan.ok) throw new Error(plan.reason);
  return {
    entities,
    plan,
    media: () => media,
    mediaApply,
    changed,
    failMediaValidation: () => {
      failMediaValidation = true;
    },
  };
}

describe('media playback host commit', () => {
  it('validates the real prepared entity mutation before either owner applies', () => {
    const world = fixture();
    world.failMediaValidation();

    expect(() => world.plan.validate()).toThrow(/media-validation-failure/i);
    expect(world.entities.actorStateAccess('alice').inventory.slot(0)).toEqual({ itemId: 'disc', count: 1 });
    expect(world.media()).toMatchObject({ revision: 0, slot: null });
    expect(world.mediaApply).not.toHaveBeenCalled();
    expect(world.changed).not.toHaveBeenCalled();
  });

  it('applies the validated entity and media replacements synchronously, then changes the host once', () => {
    const world = fixture();
    world.plan.validate();
    world.failMediaValidation();
    world.plan.apply();

    expect(world.entities.actorStateAccess('alice').inventory.slot(0)).toBeNull();
    expect(world.entities.actorStateAccess('alice').inventoryRevision).toBe(1);
    expect(world.media()).toMatchObject({ revision: 1, slot: { itemId: 'sample:disc' } });
    expect(world.mediaApply).toHaveBeenCalledOnce();
    expect(world.changed).toHaveBeenCalledOnce();
    expect(world.changed).toHaveBeenCalledWith(true);
  });
});
