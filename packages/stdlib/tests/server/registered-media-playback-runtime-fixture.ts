import { vi } from 'vitest';
import type { RegisteredCommitContext } from '../../src/server/composition/operation-contracts';
import { WorldResourceAuthorizer } from '../../src/server/harness/world-authorization';
import { createItemDefinitionRegistry } from '../../src/server/gameplay/item-registry';
import {
  buildMediaPlaybackCandidateV1,
  defineMediaPlaybackModelV1,
  type MediaPlaybackActionV1,
} from '../../src/server/gameplay/modules/media-playback-model';
import { MEDIA_PLAYBACK_RESOURCE, mediaPlaybackAddress } from '../../src/server/gameplay/modules/media-playback-module';
import { RegisteredMediaPlaybackRuntime } from '../../src/server/gameplay/modules/registered-media-playback-runtime';

export const model = defineMediaPlaybackModelV1({
  version: 1,
  tracks: [
    { id: 'sample:first-track', resource: { packId: 'sample:pack', path: 'assets/audio/first.mp3' } },
    { id: 'sample:second-track', resource: { packId: 'sample:pack', path: 'assets/audio/second.ogg' } },
  ],
  devices: [
    {
      id: 'sample:player',
      target: { kind: 'voxel', voxelId: 'sample:player-block' },
      tracks: [
        { itemId: 'sample:first-disc', trackId: 'sample:first-track' },
        { itemId: 'sample:second-disc', trackId: 'sample:second-track' },
      ],
    },
  ],
});
const items = createItemDefinitionRegistry([
  { id: 'first-disc', name: 'First disc', itemType: 'resource', stackLimit: 1, capabilities: [] },
  { id: 'second-disc', name: 'Second disc', itemType: 'resource', stackLimit: 1, capabilities: [] },
  { id: 'stone', name: 'Stone', itemType: 'resource', stackLimit: 64, capabilities: [] },
]);
export const first = [1, 2, 3] as const;
export const second = [4, 5, 6] as const;
export const third = [7, 8, 9] as const;
export const address = (position: readonly [number, number, number]) =>
  mediaPlaybackAddress({ kind: 'voxel', position });

type Actor = {
  actorId: string;
  lifecycle: 'alive' | 'dead';
  mode: 'survival' | 'creative';
  inventoryRevision: number;
  selectedSlot: number;
  selectedItemId: string | null;
  slots: ({ itemId: string; count: number } | null)[];
};

export function fixture(initial: Partial<Actor> = {}, maxDeviceInstances?: number) {
  let hostRevision = 7;
  let actor: Actor = {
    actorId: 'alice',
    lifecycle: 'alive',
    mode: 'survival',
    inventoryRevision: 3,
    selectedSlot: 0,
    selectedItemId: 'first-disc',
    slots: [{ itemId: 'first-disc', count: 1 }, null],
    ...initial,
  };
  const voxels = new Map([
    [first.join(','), 'sample:player-block'],
    [second.join(','), 'sample:player-block'],
    [third.join(','), 'sample:player-block'],
  ]);
  const inventoryApplies = vi.fn(),
    mediaChanges = vi.fn(),
    authorizations = vi.fn(),
    reachability = vi.fn();
  const runtime = new RegisteredMediaPlaybackRuntime({
    model,
    items,
    ...(maxDeviceInstances === undefined ? {} : { maxDeviceInstances }),
    getVoxelId: (position) => voxels.get(position.join(',')),
    readActor: () => structuredClone(actor),
    resolveItemStorageId: (itemId) =>
      new Map([
        ['sample:first-disc', 'first-disc'],
        ['sample:second-disc', 'second-disc'],
      ]).get(itemId),
    prepareInventory(input) {
      const expectedActor = structuredClone(actor);
      const next = structuredClone(input.slots) as Actor['slots'];
      let validated = false,
        used = false;
      return {
        validate() {
          validated = false;
          if (
            used ||
            input.actorId !== actor.actorId ||
            input.expectedRevision !== actor.inventoryRevision ||
            JSON.stringify(actor) !== JSON.stringify(expectedActor)
          )
            throw new Error('inventory-stale');
          validated = true;
        },
        apply() {
          if (used || !validated) throw new Error('inventory requires validation');
          used = true;
          if (JSON.stringify(actor.slots) !== JSON.stringify(next)) {
            actor = {
              ...actor,
              slots: next,
              selectedItemId:
                actor.mode === 'creative' ? actor.selectedItemId : (next[actor.selectedSlot]?.itemId ?? null),
              inventoryRevision: actor.inventoryRevision + 1,
            };
            inventoryApplies();
          }
        },
      };
    },
    assertActorAuthorized: authorizations,
    assertTargetReachable: reachability,
    worldRevision: () => 4,
    prepareGameplayChange(inventoryChanged) {
      const expectedRevision = hostRevision;
      let validated = false,
        used = false;
      return {
        revision: expectedRevision + 1,
        validate() {
          validated = false;
          if (used || hostRevision !== expectedRevision) throw new Error('gameplay-stale');
          validated = true;
        },
        apply() {
          if (used || !validated) throw new Error('gameplay requires validation');
          used = true;
          hostRevision += 1;
          mediaChanges(inventoryChanged);
        },
      };
    },
  });
  return {
    runtime,
    voxels,
    inventoryApplies,
    mediaChanges,
    authorizations,
    reachability,
    actor: () => structuredClone(actor),
    changeActor(update: Partial<Actor>) {
      actor = { ...actor, ...update };
    },
    hostRevision: () => hostRevision,
  };
}

export const context = (
  operationId: string,
  position: readonly [number, number, number],
  candidateValue: RegisteredCommitContext['candidateValue'],
  effectiveInput: RegisteredCommitContext['effectiveInput'],
): RegisteredCommitContext => ({
  operationId,
  resource: MEDIA_PLAYBACK_RESOURCE,
  context: {
    kind: 'actor',
    originalActorId: 'alice',
    principal: { id: 'fixture', boundEntityId: 'alice' },
    provenance: { packId: 'sample:pack', moduleId: 'sample:media' },
    target: { kind: 'voxel', position },
  },
  authorizer: new WorldResourceAuthorizer({ principals: [], rules: [] }),
  candidateValue,
  effectiveInput,
});

export function prepare(
  world: ReturnType<typeof fixture>,
  operationId: string,
  position: readonly [number, number, number],
  action: MediaPlaybackActionV1,
) {
  const state = world.runtime.read(position);
  const candidate = buildMediaPlaybackCandidateV1({
    model,
    device: { kind: 'voxel', position, definitionId: state.deviceId },
    state,
    expectedRevision: state.revision,
    action,
  });
  const effectiveInput = {
    expectedRevision: state.revision,
    ...(action && typeof action === 'object' && 'itemId' in action ? { itemId: action.itemId } : {}),
  };
  const plan = world.runtime.state.prepareCommit!(
    [{ address: address(position), revision: state.revision }],
    [{ address: address(position), value: candidate.state }],
    context(operationId, position, candidate.fact, effectiveInput),
  );
  if (!plan?.ok) throw new Error(plan?.reason ?? 'missing media plan');
  return plan;
}
