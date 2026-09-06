import { describe, expect, it } from 'vitest';
import {
  FLUID_FRONTIER_BATCH_SIZE,
  FLUID_TRANSACTION_PROTOCOL_VERSION,
  FluidTransactionAuthority,
  type FluidPosition,
} from '../../src/server/fluid/fluid-transaction';
import { GameServer } from '../../src/server/game-server';
import { ItemIds } from '../../src/server/gameplay/item-registry';
import { Voxel } from '../../src/world/voxel';

const positionKey = (position: FluidPosition) => position.join(',');

const createAuthority = (maxQueue = 8_192) =>
  new FluidTransactionAuthority({
    epoch: 1,
    maxQueue,
    readChunk: () => null,
    readCell: () => null,
    apply: () => undefined,
  });

const seedOrdinaryBacklog = (authority: FluidTransactionAuthority, count = 80) => {
  for (let index = 0; index < count; index += 1) authority.activate([index * 4, 50, 0]);
};

const createGameplayBacklog = (targetVoxel: number) => {
  const server = new GameServer({ seedText: 'interactive-fluid-gameplay' });
  const target: [number, number, number] = [200, 50, 0];
  server.spawnPlayer({ id: 'player-1', position: [200.5, 51.6, 2.5] });
  server.editBatch({
    actorId: 'fixture',
    edits: [
      ...Array.from({ length: 30 }, (_, index) => ({ x: index * 4, y: 50, z: 0, value: Voxel.Water })),
      { x: target[0], y: target[1], z: target[2], value: targetVoxel },
      { x: target[0] + 1, y: target[1], z: target[2], value: Voxel.Water },
    ],
  });
  return { server, target };
};

describe('interactive fluid frontier priority', () => {
  it('puts a bounded interactive neighborhood in the next lease while ordinary water still progresses', () => {
    const authority = createAuthority();
    seedOrdinaryBacklog(authority);
    for (let index = 0; index < 80; index += 1) authority.activate([2_000 + index * 4, 50, 0], 'interactive');
    const interactive: FluidPosition = [2_000, 50, 0];

    const pending = authority.diagnostics.pendingCellCount;
    authority.activate(interactive, 'interactive');
    expect(authority.diagnostics.pendingCellCount).toBe(pending);

    const lease = authority.requestFluidWork()!;
    expect(lease.frontier).toHaveLength(FLUID_FRONTIER_BATCH_SIZE);
    expect(lease.frontier.slice(0, 32).map(positionKey)).toContain(positionKey(interactive));
    expect(lease.frontier.filter(([x]) => x < 400)).toHaveLength(96);
  });

  it('promotes an already queued ordinary position without growing pending work', () => {
    const authority = createAuthority();
    seedOrdinaryBacklog(authority);
    const interactive: FluidPosition = [79 * 4, 50, 0];
    const pending = authority.diagnostics.pendingCellCount;

    authority.activate(interactive, 'interactive');

    expect(authority.diagnostics.pendingCellCount).toBe(pending);
    expect(authority.requestFluidWork()!.frontier.slice(0, 32).map(positionKey)).toContain(positionKey(interactive));
  });

  it('keeps the hard queue cap when an unknown interactive neighborhood arrives', () => {
    const authority = createAuthority(32);
    seedOrdinaryBacklog(authority, 20);
    expect(authority.diagnostics.pendingCellCount).toBe(32);

    expect(authority.activate([4_000, 50, 0], 'interactive')).toBe(false);
    expect(authority.diagnostics.pendingCellCount).toBe(32);
  });

  it('returns rejected or aborted interactive work to the same bounded priority lane', () => {
    const authority = createAuthority();
    seedOrdinaryBacklog(authority);
    const interactive: FluidPosition = [2_000, 50, 0];
    authority.activate(interactive, 'interactive');

    const first = authority.requestFluidWork()!;
    expect(first.frontier.slice(0, 32).map(positionKey)).toContain(positionKey(interactive));
    expect(
      authority.commitFluidCandidate({
        protocolVersion: FLUID_TRANSACTION_PROTOCOL_VERSION,
        epoch: first.epoch,
        workId: first.workId,
        readSet: [{ key: 'unexpected', revision: 1 }],
        writes: [],
        consumedFrontier: first.frontier,
        consumedCleanupFrontier: first.cleanupFrontier,
        nextFrontier: [],
        nextCleanupFrontier: [],
        needsRescan: false,
      }),
    ).toEqual({ accepted: false, reason: 'read-set' });
    const retried = authority.requestFluidWork()!;

    expect(retried.frontier).toEqual(first.frontier);
    expect(retried.frontier.filter(([x]) => x < 400).length).toBeGreaterThanOrEqual(96);
    expect(authority.abortLease(retried.workId, 'worker-crash')).toBe(true);
    expect(authority.requestFluidWork()!.frontier).toEqual(first.frontier);
  });

  it('prioritizes fluid beside a voxel broken through the real gameplay callback', () => {
    const { server, target } = createGameplayBacklog(Voxel.Stone);

    expect(server.beginBreak('player-1', target)).toMatchObject({ success: true });
    expect(server.advanceGameplayRules(3).commits).toHaveLength(1);

    const lease = server.requestFluidWork()!;
    expect(lease.frontier.slice(0, 32).map(positionKey)).toContain(positionKey(target));
  });

  it('prioritizes fluid beside a voxel placed through the real gameplay callback', () => {
    const { server, target } = createGameplayBacklog(Voxel.Air);
    server.giveItem('player-1', { itemId: ItemIds.DirtBlock, count: 1 });
    server.selectHotbarSlot('player-1', 0);

    expect(server.placeVoxel('player-1', target)).toMatchObject({ success: true });

    const lease = server.requestFluidWork()!;
    expect(lease.frontier.slice(0, 32).map(positionKey)).toContain(positionKey(target));
  });

  it('prioritizes one player-edit mutation', () => {
    const single = createGameplayBacklog(Voxel.Air);
    single.server.editBatch({
      actorId: 'player-edit',
      edits: [{ x: single.target[0], y: single.target[1], z: single.target[2], value: Voxel.Water }],
    });
    expect(single.server.requestFluidWork()!.frontier.slice(0, 32).map(positionKey)).toContain(
      positionKey(single.target),
    );
  });

  it('leaves a multi-edit player batch on the ordinary lane', () => {
    const batch = createGameplayBacklog(Voxel.Air);
    batch.server.editBatch({
      actorId: 'player-edit',
      edits: [
        { x: batch.target[0], y: batch.target[1], z: batch.target[2], value: Voxel.Water },
        { x: batch.target[0], y: batch.target[1] + 1, z: batch.target[2], value: Voxel.Water },
      ],
    });
    expect(batch.server.requestFluidWork()!.frontier.slice(0, 32).map(positionKey)).not.toContain(
      positionKey(batch.target),
    );
  });
});
