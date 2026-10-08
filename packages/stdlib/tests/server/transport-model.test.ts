import { describe, expect, it } from 'vitest';
import {
  createTransportDefinitionRegistryV1,
  migrateLegacyTransportCheckpointV1,
  validateTransportCheckpointV2,
  type TransportCheckpointV2,
  type TransportDefinitionRegistryV1,
  type TransportRouteCursorV2,
} from '../../src/server/gameplay/modules/transport-model';
import {
  buildTransportDismountCandidateV1,
  buildTransportMountCandidateV1,
} from '../../src/server/gameplay/modules/transport-relation-model';

const reference = (entityId: string, lifetime: number) => ({ entityId, epoch: 3, lifetime });
const routeCursor = (): TransportRouteCursorV2 => ({
  family: 'sample:guideway',
  cell: [4, 5, 6],
  variant: 'sample:straight',
  entry: { side: 'west', elevation: 0 },
  exit: { side: 'east', elevation: 0 },
  progress: 0.25,
  segmentLength: 1,
});

const definitions = (): TransportDefinitionRegistryV1 =>
  createTransportDefinitionRegistryV1([
    {
      version: 1,
      id: 'sample:route-pod',
      locomotion: { provider: 'route', providerId: 'sample:guideway' },
      bodyAabb: { min: { x: -0.45, y: 0, z: -0.45 }, max: { x: 0.45, y: 0.7, z: 0.45 } },
      seatOffset: [0, 0.55, 0],
      fuelCapacity: 120,
      inventoryCapacity: 2,
      presentationId: 'sample:route-pod-model',
    },
    {
      version: 1,
      id: 'sample:surface-pod',
      locomotion: { provider: 'surface', providerId: 'sample:water-surface' },
      bodyAabb: { min: { x: -0.8, y: 0, z: -1.2 }, max: { x: 0.8, y: 0.7, z: 1.2 } },
      seatOffset: [0, 0.45, 0],
      presentationId: 'sample:surface-pod-model',
    },
  ]);

const state = (overrides: Record<string, unknown> = {}) => ({
  version: 2 as const,
  reference: reference('transport-a', 10),
  definitionId: 'sample:route-pod',
  pose: { position: [1, 2, 3], yaw: 0.5 },
  velocity: [2, 0, 0],
  routeCursor: routeCursor(),
  rider: null,
  fuel: 40,
  inventory: [{ itemId: 'sample:cargo', count: 2 }, null],
  ...overrides,
});

const checkpoint = (transports: readonly unknown[] = [state()]): TransportCheckpointV2 =>
  validateTransportCheckpointV2({ version: 2, sequence: 4, transports }, definitions());

describe('TransportDefinitionV1 and V2 state', () => {
  it('validates and freezes route/surface definitions, body, seat, optional fuel/inventory and presentation', () => {
    const registry = definitions();
    expect(registry.require('sample:route-pod')).toMatchObject({
      locomotion: { provider: 'route', providerId: 'sample:guideway' },
      fuelCapacity: 120,
      inventoryCapacity: 2,
      presentationId: 'sample:route-pod-model',
    });
    expect(registry.require('sample:surface-pod')).toMatchObject({
      locomotion: { provider: 'surface', providerId: 'sample:water-surface' },
      fuelCapacity: null,
      inventoryCapacity: null,
    });
    expect(Object.isFrozen(registry.list())).toBe(true);
    expect(() => registry.require('sample:missing')).toThrow(/unknown.*definition/i);
    expect(() =>
      createTransportDefinitionRegistryV1([
        {
          ...registry.require('sample:route-pod'),
          id: 'not-namespaced',
        },
      ]),
    ).toThrow(/namespace/i);
  });

  it('validates a frozen V2 checkpoint and rejects unknown definitions, invalid cursors, NaN and capacity mismatches', () => {
    const registry = definitions();
    const valid = validateTransportCheckpointV2({ version: 2, sequence: 4, transports: [state()] }, registry);
    expect(valid.transports[0]).toMatchObject({ definitionId: 'sample:route-pod', fuel: 40 });
    expect(Object.isFrozen(valid.transports[0]!.routeCursor)).toBe(true);
    expect(() =>
      validateTransportCheckpointV2(
        { version: 2, sequence: 4, transports: [state({ definitionId: 'sample:missing' })] },
        registry,
      ),
    ).toThrow(/unknown.*definition/i);
    expect(() =>
      validateTransportCheckpointV2(
        { version: 2, sequence: 4, transports: [state({ routeCursor: { ...routeCursor(), progress: 2 } })] },
        registry,
      ),
    ).toThrow(/cursor/i);
    expect(() =>
      validateTransportCheckpointV2(
        { version: 2, sequence: 4, transports: [state({ velocity: [Number.NaN, 0, 0] })] },
        registry,
      ),
    ).toThrow(/velocity/i);
    expect(() =>
      validateTransportCheckpointV2({ version: 2, sequence: 4, transports: [state({ inventory: [null] })] }, registry),
    ).toThrow(/capacity/i);
    expect(() =>
      validateTransportCheckpointV2(
        {
          version: 2,
          sequence: 4,
          transports: [
            state({
              definitionId: 'sample:surface-pod',
              routeCursor: routeCursor(),
              fuel: null,
              inventory: [],
            }),
          ],
        },
        registry,
      ),
    ).toThrow(/must not have.*cursor/i);
  });

  it('rejects duplicate vehicle ids, lifetimes and one rider assigned to multiple transports', () => {
    const registry = definitions();
    const rider = reference('actor-a', 30);
    expect(() =>
      validateTransportCheckpointV2(
        { version: 2, sequence: 4, transports: [state(), state({ reference: reference('transport-a', 11) })] },
        registry,
      ),
    ).toThrow(/duplicate vehicle/i);
    expect(() =>
      validateTransportCheckpointV2(
        { version: 2, sequence: 4, transports: [state(), state({ reference: reference('transport-b', 10) })] },
        registry,
      ),
    ).toThrow(/lifetime/i);
    expect(() =>
      validateTransportCheckpointV2(
        {
          version: 2,
          sequence: 4,
          transports: [state({ rider }), state({ reference: reference('transport-b', 11), rider })],
        },
        registry,
      ),
    ).toThrow(/one rider/i);
    expect(() =>
      validateTransportCheckpointV2(
        { version: 2, sequence: 4, transports: [state({ rider: reference('transport-a', 99) })] },
        registry,
      ),
    ).toThrow(/ride itself/i);
  });

  it('migrates injected legacy identities to V2 without embedding legacy kind rules', () => {
    const registry = definitions();
    const refs = new Map([
      ['legacy-a', reference('legacy-a', 10)],
      ['actor-a', reference('actor-a', 20)],
    ]);
    const migrated = migrateLegacyTransportCheckpointV1(
      {
        version: 1,
        sequence: 7,
        vehicles: [
          {
            id: 'legacy-a',
            kind: 'legacy-route-kind',
            position: [1, 2, 3],
            velocity: 2,
            heading: [1, 0],
            riderId: 'actor-a',
            fuelSeconds: 20,
            inventory: [{ itemId: 'sample:cargo', count: 1 }, null],
          },
        ],
      },
      {
        definitions: registry,
        definitionIdForKind: (kind) => (kind === 'legacy-route-kind' ? 'sample:route-pod' : null),
        referenceForEntity: (id) => refs.get(id) ?? null,
        routeCursorForState: () => routeCursor(),
      },
    );
    expect(migrated).toMatchObject({
      version: 2,
      sequence: 7,
      transports: [
        {
          reference: reference('legacy-a', 10),
          definitionId: 'sample:route-pod',
          rider: reference('actor-a', 20),
          fuel: 20,
        },
      ],
    });
    expect(migrated.transports[0]!.velocity).toEqual([2, 0, 0]);
    expect(() =>
      migrateLegacyTransportCheckpointV1(
        {
          version: 1,
          sequence: 0,
          vehicles: [
            {
              id: 'legacy-a',
              kind: 'unknown-kind',
              position: [1, 2, 3],
              velocity: 0,
              heading: [1, 0],
              riderId: null,
              fuelSeconds: 0,
              inventory: [],
            },
          ],
        },
        { definitions: registry, definitionIdForKind: () => null, referenceForEntity: () => null },
      ),
    ).toThrow(/unknown legacy/i);
    expect(() =>
      migrateLegacyTransportCheckpointV1(
        {
          version: 1,
          sequence: 0,
          vehicles: [
            {
              id: 'legacy-a',
              kind: 'legacy-surface-kind',
              position: [1, 2, 3],
              velocity: 0,
              heading: [1, 0],
              riderId: null,
              fuelSeconds: 1,
              inventory: [],
            },
          ],
        },
        {
          definitions: registry,
          definitionIdForKind: () => 'sample:surface-pod',
          referenceForEntity: (id) => refs.get(id) ?? null,
        },
      ),
    ).toThrow(/fuel.*incompatible/i);
  });

  it('mount candidates enforce current lifetimes, one rider per actor and zero input mutation on failure', () => {
    const source = checkpoint();
    const snapshot = structuredClone(source);
    const rider = reference('actor-a', 30);
    const current = (candidate: ReturnType<typeof reference>) => candidate.epoch === 3;
    expect(
      buildTransportMountCandidateV1(source, { transport: reference('missing', 99), rider, isCurrent: current }),
    ).toEqual({ success: false, reason: 'stale-transport' });
    expect(
      buildTransportMountCandidateV1(source, {
        transport: reference('transport-a', 10),
        rider: { ...rider, epoch: 4 },
        isCurrent: current,
      }),
    ).toEqual({ success: false, reason: 'stale-rider' });
    expect(source).toEqual(snapshot);

    const mounted = buildTransportMountCandidateV1(source, {
      transport: reference('transport-a', 10),
      rider,
      isCurrent: current,
    });
    expect(mounted).toMatchObject({ success: true, checkpoint: { transports: [{ rider }] } });
    expect(source.transports[0]!.rider).toBeNull();
    if (!mounted.success) throw new Error('Expected mount success.');
    expect(
      buildTransportMountCandidateV1(
        checkpoint([mounted.checkpoint.transports[0]!, state({ reference: reference('transport-b', 11) })]),
        { transport: reference('transport-b', 11), rider, isCurrent: current },
      ),
    ).toEqual({ success: false, reason: 'actor-already-mounted' });
    expect(
      buildTransportMountCandidateV1(mounted.checkpoint, {
        transport: reference('transport-a', 10),
        rider: reference('actor-b', 31),
        isCurrent: current,
      }),
    ).toEqual({ success: false, reason: 'transport-occupied' });
  });

  it('dismount selects a stable safe exit and leaves relations unchanged on stale or no-safe-exit failure', () => {
    const rider = reference('actor-a', 30);
    const mounted = checkpoint([state({ rider })]);
    const snapshot = structuredClone(mounted);
    const current = (candidate: ReturnType<typeof reference>) => candidate.epoch === 3;
    expect(
      buildTransportDismountCandidateV1(mounted, {
        rider,
        exits: [
          { position: [2, 2, 3], status: 'unknown' },
          { position: [0, 2, 3], status: 'blocked' },
        ],
        isCurrent: current,
      }),
    ).toEqual({ success: false, reason: 'no-safe-exit' });
    expect(
      buildTransportDismountCandidateV1(mounted, {
        rider: { ...rider, epoch: 4 },
        exits: [{ position: [2, 2, 3], status: 'safe' }],
        isCurrent: current,
      }),
    ).toEqual({ success: false, reason: 'stale-rider' });
    expect(
      buildTransportDismountCandidateV1(mounted, {
        rider,
        exits: [{ position: [2, 2, 3], status: 'safe' }],
        isCurrent: (candidate) => candidate.entityId !== 'transport-a',
      }),
    ).toEqual({ success: false, reason: 'stale-transport' });
    expect(mounted).toEqual(snapshot);

    const dismounted = buildTransportDismountCandidateV1(mounted, {
      rider,
      exits: [
        { position: [3, 2, 3], status: 'safe' },
        { position: [0, 2, 3], status: 'safe' },
        { position: [2, 2, 3], status: 'unknown' },
      ],
      isCurrent: current,
    });
    expect(dismounted).toMatchObject({
      success: true,
      exitPosition: [0, 2, 3],
      checkpoint: { transports: [{ rider: null }] },
    });
    expect(mounted.transports[0]!.rider).toEqual(rider);
  });
});
