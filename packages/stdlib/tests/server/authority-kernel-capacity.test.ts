import { createKernelStateOwner } from '@seedlands/kernel/execution';
import { describe, expect, it } from 'vitest';
import type { BodyConfig } from '../../src/physics';
import {
  createAuthorityKernelExecutionPort,
  createAuthorityKernelState,
  encodeAuthorityKernelState,
} from '../../src/server/authority/authority-kernel-state';
import { AuthoritySession, type AuthorityServerPort } from '../../src/server/authority/authority-session';

const bodyConfig: BodyConfig = {
  localAabb: { min: { x: -0.3, y: 0, z: -0.3 }, max: { x: 0.3, y: 1.8, z: 0.3 } },
  gravity: 20,
  terminalVelocity: 30,
};

describe('Authority Kernel commit capacity', () => {
  it('rejects a clock-rate change before mutating module state at an exhausted frontier', () => {
    const owner = createKernelStateOwner({ commitSequence: Number.MAX_SAFE_INTEGER });
    const state = createAuthorityKernelState();
    const execution = createAuthorityKernelExecutionPort(owner, state);
    const server: AuthorityServerPort = {
      worldRevision: 0,
      mutationCount: 0,
      worldTime: 9,
      getEntity: () => null,
      queryEntities: () => [],
      updateEntity: () => undefined,
      advanceGameplayRules: () => undefined,
    };
    const session = new AuthoritySession({
      epoch: 'capacity:1',
      playerId: 'missing-player',
      server,
      bodyConfigFor: () => bodyConfig,
      voxelSource: { getLoadedVoxel: () => null },
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
      startTimeMs: 0,
      execution,
    });
    const before = encodeAuthorityKernelState(state);

    expect(() => session.setWorldClockRate(1)).toThrow('Kernel commit sequence is exhausted.');
    expect(encodeAuthorityKernelState(state)).toEqual(before);
    expect(owner.commitSequence).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects a two-entity physics step before advancing any session or entity frontier', () => {
    const owner = createKernelStateOwner({ commitSequence: Number.MAX_SAFE_INTEGER - 1 });
    const state = createAuthorityKernelState();
    const execution = createAuthorityKernelExecutionPort(owner, state);
    const entities = new Map([
      ['player-1', { id: 'player-1', type: 'player' as const, position: [0.5, 1, 0.5] as [number, number, number] }],
      ['player-2', { id: 'player-2', type: 'player' as const, position: [2.5, 1, 0.5] as [number, number, number] }],
    ]);
    let updateCalls = 0;
    const server: AuthorityServerPort = {
      worldRevision: 0,
      mutationCount: 0,
      worldTime: 9,
      getEntity: (id) => entities.get(id) ?? null,
      queryEntities: () => [...entities.values()].map((entity) => ({ ...entity, position: [...entity.position] })),
      updateEntity: (id, update) => {
        updateCalls += 1;
        owner.commitGameplay(owner.epoch);
        entities.set(id, { ...entities.get(id)!, ...update });
      },
      updateEntities: (updates) => {
        updateCalls += updates.length;
        owner.assertGameplayBatchCapacity(owner.epoch, updates.length);
        for (const { id, update } of updates) entities.set(id, { ...entities.get(id)!, ...update });
        owner.commitGameplayBatch(owner.epoch, updates.length);
      },
      advanceGameplayRules: () => undefined,
    };
    const session = new AuthoritySession({
      epoch: 'capacity:two-entity',
      playerId: 'player-1',
      server,
      bodyConfigFor: () => bodyConfig,
      voxelSource: {
        getLoadedVoxel: (_x, y) => ({ voxel: y < 0 ? 1 : 0, chunkKey: 'loaded', revision: 0 }),
      },
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
      startTimeMs: 0,
      execution,
    });
    const beforeState = encodeAuthorityKernelState(state);
    const beforeEntities = [...entities.values()].map((entity) => ({ ...entity, position: [...entity.position] }));
    const beforeOwner = owner.snapshot();
    const beforeSnapshot = session.currentSnapshot;

    expect(() => session.wake(20)).toThrow('Kernel commit sequence is exhausted.');
    expect(updateCalls).toBe(0);
    expect(encodeAuthorityKernelState(state)).toEqual(beforeState);
    expect([...entities.values()]).toEqual(beforeEntities);
    expect(owner.snapshot()).toEqual(beforeOwner);
    expect(session.currentSnapshot).toEqual(beforeSnapshot);
  });

  it('reserves recovery and physics commits before moving an overlapping entity', () => {
    const owner = createKernelStateOwner({ commitSequence: Number.MAX_SAFE_INTEGER - 1 });
    const state = createAuthorityKernelState();
    const execution = createAuthorityKernelExecutionPort(owner, state);
    let entity = {
      id: 'player-1',
      type: 'player' as const,
      position: [0.5, 0, 0.5] as [number, number, number],
      physicsVelocity: [0, 0, 0] as [number, number, number],
    };
    let updateCalls = 0;
    const server: AuthorityServerPort = {
      worldRevision: 0,
      mutationCount: 0,
      worldTime: 9,
      getEntity: (id) => (id === entity.id ? { ...entity } : null),
      queryEntities: () => [{ ...entity }],
      updateEntity: (_id, update) => {
        owner.commitGameplay(owner.epoch);
        updateCalls += 1;
        entity = { ...entity, ...update };
      },
      updateEntities: (updates) => {
        owner.assertGameplayBatchCapacity(owner.epoch, updates.length);
        updateCalls += updates.length;
        entity = { ...entity, ...updates[0]!.update };
        owner.commitGameplayBatch(owner.epoch, updates.length);
      },
      advanceGameplayRules: () => undefined,
    };
    const session = new AuthoritySession({
      epoch: 'capacity:recovery',
      playerId: entity.id,
      server,
      bodyConfigFor: () => bodyConfig,
      voxelSource: {
        getLoadedVoxel: (x, y, z) => ({
          voxel: x === 0 && y === 0 && z === 0 ? 1 : 0,
          chunkKey: 'loaded',
          revision: 0,
        }),
      },
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
      startTimeMs: 0,
      execution,
    });
    const beforeState = encodeAuthorityKernelState(state);
    const beforeEntity = { ...entity };
    const beforeOwner = owner.snapshot();
    const beforeSnapshot = session.currentSnapshot;

    expect(() => session.wake(20)).toThrow('Kernel commit sequence is exhausted.');
    expect(updateCalls).toBe(0);
    expect(entity).toEqual(beforeEntity);
    expect(encodeAuthorityKernelState(state)).toEqual(beforeState);
    expect(owner.snapshot()).toEqual(beforeOwner);
    expect(session.currentSnapshot).toEqual(beforeSnapshot);
  });

  it('reserves a current world item pickup in addition to the physics batch', () => {
    const owner = createKernelStateOwner();
    const state = createAuthorityKernelState();
    const execution = createAuthorityKernelExecutionPort(owner, state);
    const entities = new Map([
      ['player-1', { id: 'player-1', type: 'player' as const, position: [0.5, 1, 0.5] as [number, number, number] }],
      ['item-1', { id: 'item-1', type: 'world-item' as const, position: [0.7, 1, 0.5] as [number, number, number] }],
    ]);
    let pickupEnabled = false;
    let updateCalls = 0;
    const server: AuthorityServerPort = {
      worldRevision: 0,
      mutationCount: 0,
      worldTime: 9,
      getEntity: (id) => entities.get(id) ?? null,
      queryEntities: () => [...entities.values()].map((entity) => ({ ...entity, position: [...entity.position] })),
      queryPickupTargets: () =>
        pickupEnabled ? [{ id: 'player-1', position: [...entities.get('player-1')!.position] }] : [],
      pickupItem: () => {
        owner.commitGameplay(owner.epoch);
        return { success: true };
      },
      updateEntity: (id, update) => {
        owner.commitGameplay(owner.epoch);
        updateCalls += 1;
        entities.set(id, { ...entities.get(id)!, ...update });
      },
      updateEntities: (updates) => {
        owner.assertGameplayBatchCapacity(owner.epoch, updates.length);
        for (const { id, update } of updates) entities.set(id, { ...entities.get(id)!, ...update });
        owner.commitGameplayBatch(owner.epoch, updates.length);
        updateCalls += updates.length;
      },
      advanceGameplayRules: () => undefined,
    };
    const session = new AuthoritySession({
      epoch: 'capacity:pickup',
      playerId: 'player-1',
      server,
      bodyConfigFor: () => bodyConfig,
      voxelSource: { getLoadedVoxel: () => ({ voxel: 0, chunkKey: 'loaded', revision: 0 }) },
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
      startTimeMs: 0,
      execution,
    });
    session.wake(20);
    pickupEnabled = true;
    owner.restoreCommitFrontier(Number.MAX_SAFE_INTEGER - 2, 0);
    const beforeState = encodeAuthorityKernelState(state);
    const beforeEntities = [...entities.values()].map((entity) => ({ ...entity, position: [...entity.position] }));
    const beforeUpdates = updateCalls;
    const beforeOwner = owner.snapshot();

    expect(() => session.wake(40)).toThrow('Kernel commit sequence is exhausted.');
    expect(updateCalls).toBe(beforeUpdates);
    expect([...entities.values()]).toEqual(beforeEntities);
    expect(encodeAuthorityKernelState(state)).toEqual(beforeState);
    expect(owner.snapshot()).toEqual(beforeOwner);
  });

  it('uses the Gameplay-provided scheduled commit upper bound before advancing lanes', () => {
    const owner = createKernelStateOwner();
    const state = createAuthorityKernelState();
    const execution = createAuthorityKernelExecutionPort(owner, state);
    let entity = { id: 'player-1', type: 'player' as const, position: [0.5, 1, 0.5] as [number, number, number] };
    let updateCalls = 0;
    let ruleCommits = 0;
    const server: AuthorityServerPort = {
      worldRevision: 0,
      mutationCount: 0,
      worldTime: 9,
      getEntity: (id) => (id === entity.id ? { ...entity } : null),
      queryEntities: () => [{ ...entity, position: [...entity.position] }],
      updateEntity: (_id, update) => {
        owner.commitGameplay(owner.epoch);
        entity = { ...entity, ...update };
        updateCalls += 1;
      },
      updateEntities: (updates) => {
        owner.assertGameplayBatchCapacity(owner.epoch, updates.length);
        entity = { ...entity, ...updates[0]!.update };
        owner.commitGameplayBatch(owner.epoch, updates.length);
        updateCalls += updates.length;
      },
      gameplayAdvanceCommitUpperBound: () => 3,
      advanceGameplayRules: () => {
        for (let index = 0; index < 3; index += 1) {
          owner.commitGameplay(owner.epoch);
          ruleCommits += 1;
        }
      },
    };
    const session = new AuthoritySession({
      epoch: 'capacity:schedule',
      playerId: entity.id,
      server,
      bodyConfigFor: () => bodyConfig,
      voxelSource: { getLoadedVoxel: () => ({ voxel: 0, chunkKey: 'loaded', revision: 0 }) },
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
      startTimeMs: 0,
      execution,
    });
    session.wake(20);
    owner.restoreCommitFrontier(Number.MAX_SAFE_INTEGER - 4, 0);
    const beforeState = encodeAuthorityKernelState(state);
    const beforeEntity = { ...entity };
    const beforeUpdates = updateCalls;
    const beforeOwner = owner.snapshot();

    expect(() => session.wake(50)).toThrow('Kernel commit sequence is exhausted.');
    expect(updateCalls).toBe(beforeUpdates);
    expect(ruleCommits).toBe(0);
    expect(entity).toEqual(beforeEntity);
    expect(encodeAuthorityKernelState(state)).toEqual(beforeState);
    expect(owner.snapshot()).toEqual(beforeOwner);
  });
});
