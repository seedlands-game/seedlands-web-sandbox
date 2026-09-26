import { describe, expect, it } from 'vitest';
import { assembleWorldPacks } from '../../src/server/composition/assembly';
import { definePack } from '../../src/server/composition/assembly';
import type { ModuleInvocationValue } from '../../src/server/composition/contracts';
import type { CommittedOperationFact, RegisteredStatePort } from '../../src/server/composition/operation-contracts';
import { createRegisteredOperationRuntime } from '../../src/server/composition/registered-operations';
import { WorldResourceAuthorizer } from '../../src/server/harness/world-authorization';
import { defineContentModule } from '../../src/server/gameplay/modules/content-module';
import {
  createMediaPlaybackStateV1,
  type MediaPlaybackModelV1,
  type MediaPlaybackStateV1,
} from '../../src/server/gameplay/modules/media-playback-model';
import {
  MEDIA_ACTIVATE_OPERATION,
  MEDIA_EJECT_OPERATION,
  MEDIA_INSERT_OPERATION,
  MEDIA_PLAYBACK_COMPONENT,
  MEDIA_PLAYBACK_RESOURCE,
  MEDIA_STOP_OPERATION,
  MEDIA_SWITCH_OPERATION,
  defineMediaPlaybackModuleV1,
  mediaPlaybackAddress,
} from '../../src/server/gameplay/modules/media-playback-module';

const mediaDefinition = {
  version: 1 as const,
  tracks: [
    { id: 'test:first-track', resource: { packId: 'test:media-pack', path: 'assets/audio/first.mp3' } },
    { id: 'test:second-track', resource: { packId: 'test:media-pack', path: 'assets/audio/second.ogg' } },
  ],
  devices: [
    {
      id: 'test:player',
      target: { kind: 'voxel' as const, voxelId: 'test:player-block' },
      tracks: [
        { itemId: 'test:first-disc', trackId: 'test:first-track' },
        { itemId: 'test:second-disc', trackId: 'test:second-track' },
      ],
    },
  ],
};

const items = [
  { id: 'test:first-disc', name: 'First Disc', itemType: 'resource' as const, stackLimit: 1, capabilities: [] },
  { id: 'test:second-disc', name: 'Second Disc', itemType: 'resource' as const, stackLimit: 1, capabilities: [] },
];
const voxels = [
  {
    id: 'test:player-block',
    storageId: 500,
    solid: true,
    targetable: true,
    renderable: true,
    meshKind: 'cube' as const,
    emission: 0,
    lightCost: 1,
    faceMaterials: [1, 1, 1, 1, 1, 1] as const,
  },
];
const target = { kind: 'voxel' as const, position: [1, 2, 3] as const };
const address = mediaPlaybackAddress(target);
const key = JSON.stringify(address);

function setup(worldName: string, allow = true) {
  const packId = 'test:media-pack';
  const content = defineContentModule({
    moduleId: `test:${worldName}-content`,
    items,
    recipes: [],
    voxels,
    meleeDefinitions: [],
  });
  const media = defineMediaPlaybackModuleV1({ moduleId: `test:${worldName}-media`, definition: mediaDefinition });
  const pack = definePack({
    id: packId,
    version: '1.0.0',
    kind: 'playbook',
    modules: [content, media],
    resources: ['assets/audio/first.mp3', 'assets/audio/second.ogg'],
  });
  const composition = assembleWorldPacks(
    [
      {
        ...pack,
        integrity: {
          algorithm: 'sha256' as const,
          manifestDigest: 'a'.repeat(64),
          entryDigest: 'b'.repeat(64),
          resources: [
            { path: 'assets/audio/first.mp3', digest: 'c'.repeat(64) },
            { path: 'assets/audio/second.ogg', digest: 'd'.repeat(64) },
          ],
        },
      },
    ],
    { approvedPermissions: { [packId]: media.descriptor.permissions! } },
  );
  const model = composition.capability<{ resolve(): MediaPlaybackModelV1 }>('seedlands:media-playback').resolve();
  let ownerRevision = 0;
  let projection: ModuleInvocationValue = createMediaPlaybackStateV1(model, 'test:player');
  const facts: CommittedOperationFact[] = [];
  const state: RegisteredStatePort = {
    read(requested) {
      if (JSON.stringify(requested) !== key) throw new Error(`Unexpected media address: ${JSON.stringify(requested)}`);
      return { revision: ownerRevision, value: projection };
    },
    commit(observed, writes) {
      if (observed.length !== 1 || observed[0]!.revision !== ownerRevision)
        return { ok: false, reason: 'stale fake media owner' };
      if (writes.length !== 1 || JSON.stringify(writes[0]!.address) !== key)
        return { ok: false, reason: 'invalid fake media write' };
      projection = structuredClone(writes[0]!.value);
      ownerRevision += 1;
      return { ok: true, revision: ownerRevision };
    },
  };
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'human', boundEntityId: 'alice' }],
      rules: allow
        ? [
            {
              effect: 'allow',
              principal: { ids: ['human'] },
              resources: [MEDIA_PLAYBACK_RESOURCE],
              operations: ['read', 'write', 'execute'],
              scope: 'any',
            },
          ]
        : [],
    },
    composition.resources,
  );
  const runtime = createRegisteredOperationRuntime({ composition, authorizer, clone: structuredClone, state });
  const execution = runtime.bind({
    moduleId: media.descriptor.id,
    principalId: 'human',
    originalActorId: 'alice',
  });
  execution.subscribe((fact) => facts.push(fact));
  return {
    composition,
    execution,
    facts,
    state: () => structuredClone(projection) as MediaPlaybackStateV1,
    ownerRevision: () => ownerRevision,
  };
}

const invoke = (world: ReturnType<typeof setup>, operationId: string, expectedRevision: number, itemId?: string) =>
  world.execution.invoke({
    operationId,
    target,
    input: { expectedRevision, ...(itemId ? { itemId } : {}) },
  });

describe('registered MediaPlaybackModuleV1', () => {
  it('validates track, device and item definitions when assembly finalizes', () => {
    const valid = setup('valid');
    expect(valid.composition.definitionMap.stateCodecs).toContainEqual(
      expect.objectContaining({ id: MEDIA_PLAYBACK_COMPONENT }),
    );
    const codec = valid.composition.registrations.states.find(
      ({ definition }) => definition.id === MEDIA_PLAYBACK_COMPONENT,
    )!.definition;
    expect(codec.validate(valid.state())).toBe(true);
    expect(codec.validate({ ...valid.state(), version: 2 })).toBe(false);
    expect(codec.validate({ ...valid.state(), unexpected: true })).toBe(false);
    expect(() => {
      const content = defineContentModule({
        moduleId: 'test:invalid-content',
        items,
        recipes: [],
        voxels,
        meleeDefinitions: [],
      });
      const media = defineMediaPlaybackModuleV1({
        moduleId: 'test:invalid-media',
        definition: {
          ...mediaDefinition,
          devices: [
            {
              id: 'test:player',
              target: { kind: 'voxel', voxelId: 'test:player-block' },
              tracks: [{ itemId: 'test:missing-disc', trackId: 'test:first-track' }],
            },
          ],
        },
      });
      const pack = definePack({
        id: 'test:media-pack',
        version: '1.0.0',
        kind: 'playbook',
        modules: [content, media],
        resources: ['assets/audio/first.mp3', 'assets/audio/second.ogg'],
      });
      assembleWorldPacks(
        [
          {
            ...pack,
            integrity: {
              algorithm: 'sha256',
              manifestDigest: 'a'.repeat(64),
              entryDigest: 'b'.repeat(64),
              resources: [
                { path: 'assets/audio/first.mp3', digest: 'c'.repeat(64) },
                { path: 'assets/audio/second.ogg', digest: 'd'.repeat(64) },
              ],
            },
          },
        ],
        { approvedPermissions: { 'test:media-pack': media.descriptor.permissions! } },
      );
    }).toThrow(/unknown item/i);
    expect(() => {
      const content = defineContentModule({
        moduleId: 'test:missing-voxel-content',
        items,
        recipes: [],
        voxels,
        meleeDefinitions: [],
      });
      const media = defineMediaPlaybackModuleV1({
        moduleId: 'test:missing-voxel-media',
        definition: {
          ...mediaDefinition,
          devices: [
            {
              ...mediaDefinition.devices[0]!,
              target: { kind: 'voxel', voxelId: 'test:missing-player-block' },
            },
          ],
        },
      });
      const pack = definePack({
        id: 'test:media-pack',
        version: '1.0.0',
        kind: 'playbook',
        modules: [content, media],
        resources: ['assets/audio/first.mp3', 'assets/audio/second.ogg'],
      });
      assembleWorldPacks(
        [
          {
            ...pack,
            integrity: {
              algorithm: 'sha256',
              manifestDigest: 'a'.repeat(64),
              entryDigest: 'b'.repeat(64),
              resources: [
                { path: 'assets/audio/first.mp3', digest: 'c'.repeat(64) },
                { path: 'assets/audio/second.ogg', digest: 'd'.repeat(64) },
              ],
            },
          },
        ],
        { approvedPermissions: { 'test:media-pack': media.descriptor.permissions! } },
      );
    }).toThrow(/unknown voxel/i);
    expect(() => {
      const content = defineContentModule({
        moduleId: 'test:instance-content',
        items: [
          ...items,
          {
            id: 'test:instance-disc',
            name: 'Instance Disc',
            itemType: 'tool',
            stackLimit: 1,
            durability: { max: 10 },
            capabilities: [],
          } as const,
        ],
        recipes: [],
        voxels,
        meleeDefinitions: [],
      });
      const media = defineMediaPlaybackModuleV1({
        moduleId: 'test:instance-media',
        definition: {
          ...mediaDefinition,
          devices: [
            {
              ...mediaDefinition.devices[0]!,
              tracks: [{ itemId: 'test:instance-disc', trackId: 'test:first-track' }],
            },
          ],
        },
      });
      const pack = definePack({
        id: 'test:media-pack',
        version: '1.0.0',
        kind: 'playbook',
        modules: [content, media],
        resources: ['assets/audio/first.mp3', 'assets/audio/second.ogg'],
      });
      assembleWorldPacks(
        [
          {
            ...pack,
            integrity: {
              algorithm: 'sha256',
              manifestDigest: 'a'.repeat(64),
              entryDigest: 'b'.repeat(64),
              resources: [
                { path: 'assets/audio/first.mp3', digest: 'c'.repeat(64) },
                { path: 'assets/audio/second.ogg', digest: 'd'.repeat(64) },
              ],
            },
          },
        ],
        { approvedPermissions: { 'test:media-pack': media.descriptor.permissions! } },
      );
    }).toThrow(/instance state/i);
  });

  it('commits insert, activate, stop, switch and eject states and publishes immutable facts', () => {
    const world = setup('operations');
    expect(invoke(world, MEDIA_INSERT_OPERATION, 0, 'test:first-disc')).toMatchObject({
      ok: true,
      value: {
        kind: 'insert',
        trackId: 'test:first-track',
        resource: { packId: 'test:media-pack', path: 'assets/audio/first.mp3' },
      },
    });
    expect(invoke(world, MEDIA_ACTIVATE_OPERATION, 1)).toMatchObject({
      ok: true,
      value: { kind: 'activate', playing: true, revision: 2 },
    });
    expect(invoke(world, MEDIA_STOP_OPERATION, 2)).toMatchObject({
      ok: true,
      value: { kind: 'stop', playing: false, revision: 3 },
    });
    expect(invoke(world, MEDIA_ACTIVATE_OPERATION, 3)).toMatchObject({ ok: true });
    expect(invoke(world, MEDIA_SWITCH_OPERATION, 4, 'test:second-disc')).toMatchObject({
      ok: true,
      value: { kind: 'switch', previousTrackId: 'test:first-track', trackId: 'test:second-track', playing: true },
    });
    expect(invoke(world, MEDIA_EJECT_OPERATION, 5)).toMatchObject({
      ok: true,
      value: { kind: 'eject', trackId: null, resource: null, playing: false, revision: 6 },
    });
    expect(world.state()).toMatchObject({ revision: 6, slot: null, playing: false });
    expect(world.ownerRevision()).toBe(6);
    expect(world.facts).toHaveLength(6);
    expect(world.facts.every(Object.isFrozen)).toBe(true);
    expect(world.facts.at(-1)).toMatchObject({
      operationId: MEDIA_EJECT_OPERATION,
      value: {
        kind: 'eject',
        device: { kind: 'voxel', position: target.position, definitionId: 'test:player' },
        revision: 6,
      },
      observed: [{ address, revision: 5 }],
      writes: [{ address, value: { revision: 6 } }],
    });
  });

  it('rejects stale model revisions and authorization failures without committing or publishing facts', () => {
    const world = setup('denied', false);
    expect(invoke(world, MEDIA_INSERT_OPERATION, 0, 'test:first-disc')).toMatchObject({
      ok: false,
      code: 'WORLD_PERMISSION_DENIED',
    });
    expect(world.ownerRevision()).toBe(0);
    expect(world.facts).toEqual([]);

    const allowed = setup('stale');
    expect(invoke(allowed, MEDIA_INSERT_OPERATION, 1, 'test:first-disc')).toMatchObject({
      ok: false,
      code: 'OPERATION_FAILED',
      message: 'stale-revision',
    });
    expect(allowed.ownerRevision()).toBe(0);
    expect(allowed.state()).toMatchObject({ revision: 0, slot: null });
    expect(allowed.facts).toEqual([]);
  });

  it('rejects non-voxel device targets before reading media state', () => {
    const world = setup('non-voxel-target');
    expect(
      world.execution.invoke({
        operationId: MEDIA_INSERT_OPERATION,
        target: { kind: 'entity', entityId: 'device-1' },
        input: { expectedRevision: 0, itemId: 'test:first-disc' },
      }),
    ).toMatchObject({ ok: false, code: 'OPERATION_FAILED', message: expect.stringMatching(/voxel device/i) });
    expect(world.ownerRevision()).toBe(0);
    expect(world.facts).toEqual([]);
  });

  it('keeps separate assembled worlds and fake state owners isolated', () => {
    const first = setup('world-one');
    const second = setup('world-two');
    expect(invoke(first, MEDIA_INSERT_OPERATION, 0, 'test:first-disc')).toMatchObject({ ok: true });
    expect(invoke(first, MEDIA_ACTIVATE_OPERATION, 1)).toMatchObject({ ok: true });

    expect(first.state()).toMatchObject({ revision: 2, playing: true, slot: { itemId: 'test:first-disc' } });
    expect(second.state()).toMatchObject({ revision: 0, playing: false, slot: null });
    expect(first.ownerRevision()).toBe(2);
    expect(second.ownerRevision()).toBe(0);
    expect(second.facts).toEqual([]);
  });
});
