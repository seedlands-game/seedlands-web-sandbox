import { describe, expect, it } from 'vitest';
import { bodyConfigFor } from '../../packages/game-core/src/physics';
import {
  AuthoritySession,
  type AuthorityServerPort,
} from '../../packages/game-core/src/server/authority/authority-session';
import { PROTOCOL_VERSION, type InputCommand } from '../../packages/game-core/src/runtime/session-protocol';
import { Voxel } from '../../packages/game-core/src/world/voxel';
import { findSafeModeLanding } from '../../packages/game-core/src/server/authority/creative-physics';

type Entity = ReturnType<AuthorityServerPort['queryEntities']>[number];
type ModeState = NonNullable<ReturnType<NonNullable<AuthorityServerPort['getActorModeState']>>>;

class FlightServer implements AuthorityServerPort {
  worldRevision = 0;
  mutationCount = 0;
  worldTime = 9;
  readonly entities = new Map<string, Entity>();

  constructor(
    entity: Entity,
    private readonly modeState: ModeState | null,
  ) {
    this.entities.set(entity.id, entity);
  }

  getEntity(id: string) {
    return this.entities.get(id) ?? null;
  }

  getActorModeState(id: string) {
    return this.entities.has(id) ? this.modeState : null;
  }

  queryEntities() {
    return [...this.entities.values()].map((entity) => ({
      ...entity,
      position: [...entity.position] as [number, number, number],
      physicsVelocity: entity.physicsVelocity ? ([...entity.physicsVelocity] as [number, number, number]) : undefined,
    }));
  }

  updateEntity(id: string, update: { position: [number, number, number]; physicsVelocity: [number, number, number] }) {
    const entity = this.entities.get(id);
    if (!entity) throw new Error(`Missing entity: ${id}`);
    this.entities.set(id, { ...entity, ...update });
  }

  advanceGameplayRules() {}
}

const player = (velocity: [number, number, number] = [0, 0, 0]): Entity => ({
  id: 'player',
  type: 'player',
  position: [0.5, 5, 0.5],
  physicsVelocity: velocity,
});

const creativeFlight: ModeState = { mode: 'creative', flight: { enabled: true } };
const creativeGrounded: ModeState = { mode: 'creative', flight: { enabled: false } };
const survival: ModeState = { mode: 'survival', flight: { enabled: false } };

const command = (
  sequence: number,
  verticalIntent: -1 | 0 | 1,
  moveX = 0,
  targetPhysicsTick = sequence,
): InputCommand => ({
  kind: 'input',
  protocolVersion: PROTOCOL_VERSION,
  epoch: 'creative-flight:1',
  stream: 'player-input',
  sequence,
  targetPhysicsTick,
  issuedAtMs: sequence,
  state: { moveX, moveZ: 0, verticalIntent, jumpHeld: verticalIntent > 0 },
  edges: { jumpPressed: false },
});

const sessionFor = (
  server: FlightServer,
  voxelAt: (x: number, y: number, z: number) => number | null = (_x, y) => (y === -1 ? Voxel.Stone : Voxel.Air),
  unknownRequests: string[] = [],
) =>
  new AuthoritySession({
    epoch: 'creative-flight:1',
    playerId: 'player',
    server,
    bodyConfigFor: () => bodyConfigFor('player'),
    voxelSource: {
      getLoadedVoxel: (x, y, z) => {
        const voxel = voxelAt(x, y, z);
        return voxel === null ? null : { voxel, chunkKey: 'loaded', revision: 0 };
      },
    },
    frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
    startTimeMs: 0,
    requestUnknownChunk: (key) => unknownRequests.push(key),
  });

const advance = (session: AuthoritySession, fromStep: number, count: number) => {
  let snapshot = session.currentSnapshot;
  for (let step = fromStep; step < fromStep + count; step += 1) snapshot = session.wake((step * 1_000) / 60);
  return snapshot;
};

describe('creative authority flight', () => {
  it('ascends, holds without gravity drift, and descends from authoritative creative flight state', () => {
    const server = new FlightServer(player([0, -6, 0]), creativeFlight);
    const session = sessionFor(server);
    session.wake(0);

    session.receiveInput(command(1, 1));
    advance(session, 1, 1);
    expect(server.getEntity('player')!.position[1]).toBeGreaterThan(5);
    expect(server.getEntity('player')!.physicsVelocity![1]).toBeGreaterThan(0);

    const heldAt = server.getEntity('player')!.position[1];
    session.receiveInput(command(2, 0));
    advance(session, 2, 10);
    expect(server.getEntity('player')!.position[1]).toBeCloseTo(heldAt, 6);
    expect(server.getEntity('player')!.physicsVelocity![1]).toBe(0);

    session.receiveInput(command(3, -1, 0, 12));
    advance(session, 12, 1);
    expect(server.getEntity('player')!.position[1]).toBeLessThan(heldAt);
    expect(server.getEntity('player')!.physicsVelocity![1]).toBeLessThan(0);
  });

  it('keeps the existing swept collision solver for flight walls and ceilings', () => {
    const ceilingServer = new FlightServer(player(), creativeFlight);
    const ceilingSession = sessionFor(ceilingServer, (_x, y) => (y === 7 ? Voxel.Stone : Voxel.Air));
    ceilingSession.receiveInput(command(1, 1));
    advance(ceilingSession, 1, 30);
    expect(ceilingServer.getEntity('player')!.position[1]).toBeLessThanOrEqual(5.2 + 1e-6);
    expect(ceilingServer.getEntity('player')!.physicsVelocity![1]).toBe(0);

    const wallServer = new FlightServer(player(), creativeFlight);
    const wallSession = sessionFor(wallServer, (x, y) => (x === 1 && y >= 5 && y <= 7 ? Voxel.Stone : Voxel.Air));
    wallSession.receiveInput(command(1, 0, 1));
    advance(wallSession, 1, 60);
    expect(wallServer.getEntity('player')!.position[0]).toBeLessThanOrEqual(0.68 + 1e-6);
    expect(wallServer.getEntity('player')!.physicsVelocity![0]).toBe(0);
  });

  it.each([
    ['survival', survival],
    ['creative flight disabled', creativeGrounded],
  ] as const)('keeps gravity for %s even when vertical intent is held', (_label, mode) => {
    const server = new FlightServer(player(), mode);
    const session = sessionFor(server, () => Voxel.Air);
    session.receiveInput(command(1, 1));
    advance(session, 1, 1);

    expect(server.getEntity('player')!.position[1]).toBeLessThan(5);
    expect(server.getEntity('player')!.physicsVelocity![1]).toBeLessThan(0);
  });

  it('keeps unknown space as a blocker while flying', () => {
    const requests: string[] = [];
    const server = new FlightServer(player(), creativeFlight);
    const session = sessionFor(server, (_x, y) => (y >= 7 ? null : Voxel.Air), requests);
    session.receiveInput(command(1, 1));
    advance(session, 1, 30);

    expect(server.getEntity('player')!.position[1]).toBeLessThanOrEqual(5.2 + 1e-6);
    expect(server.getEntity('player')!.physicsVelocity![1]).toBe(0);
    expect(requests.length).toBeGreaterThan(0);
  });
});

describe('safe mode landing', () => {
  const landingEntity = player();
  const loadedSource = (voxelAt: (x: number, y: number, z: number) => number | null) => ({
    getLoadedVoxel: (x: number, y: number, z: number) => {
      const voxel = voxelAt(x, y, z);
      return voxel === null ? null : { voxel, chunkKey: 'loaded', revision: 0 };
    },
  });

  it('uses the registered body AABB and loaded voxel collision geometry for a standing landing', () => {
    const landing = findSafeModeLanding(
      landingEntity,
      loadedSource((x, y, z) => (x === 0 && y === 0 && z === 0 ? Voxel.Lantern : Voxel.Air)),
    );

    expect(landing).not.toBeNull();
    expect(landing![0]).toBe(0.5);
    expect(landing![1]).toBeCloseTo(0.94, 6);
    expect(landing![2]).toBe(0.5);
  });

  it('rejects unknown support, missing support and floors beyond the bounded eight-voxel search', () => {
    expect(
      findSafeModeLanding(
        landingEntity,
        loadedSource((_x, y) => (y === 0 ? null : Voxel.Air)),
      ),
    ).toBeNull();
    expect(
      findSafeModeLanding(
        landingEntity,
        loadedSource(() => Voxel.Air),
      ),
    ).toBeNull();
    expect(
      findSafeModeLanding(
        landingEntity,
        loadedSource((_x, y) => (y === -5 ? Voxel.Stone : Voxel.Air)),
      ),
    ).toBeNull();
  });
});
