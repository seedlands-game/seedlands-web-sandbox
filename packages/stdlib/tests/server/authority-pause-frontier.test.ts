import { createKernelStateOwner } from '@seedlands/kernel/execution';
import { expect, it } from 'vitest';
import {
  createAuthorityKernelExecutionPort,
  createAuthorityKernelState,
  decodeAuthorityKernelState,
  encodeAuthorityKernelState,
  type AuthorityKernelState,
} from '../../src/server/authority/authority-kernel-state';
import {
  AuthoritySession,
  type AuthorityEntity,
  type AuthorityServerPort,
} from '../../src/server/authority/authority-session';

function create(state: AuthorityKernelState = createAuthorityKernelState(), startTimeMs = 0) {
  const owner = createKernelStateOwner();
  let entity: AuthorityEntity = { id: 'player', type: 'player', position: [0.5, 1, 0.5] };
  const server: AuthorityServerPort = {
    worldRevision: 0,
    mutationCount: 0,
    worldTime: 9,
    getEntity: () => entity,
    queryEntities: () => [entity],
    updateEntity: (_id, update) => {
      entity = { ...entity, ...update };
      owner.commitGameplay(owner.epoch);
    },
    advanceGameplayRules: () => undefined,
  };
  const session = new AuthoritySession({
    epoch: 'pause-frontier',
    playerId: 'player',
    server,
    execution: createAuthorityKernelExecutionPort(owner, state),
    startTimeMs,
    frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
    voxelSource: { getLoadedVoxel: () => ({ voxel: 0, chunkKey: 'loaded', revision: 0 }) },
    bodyConfigFor: () => ({
      localAabb: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      gravity: 20,
      terminalVelocity: 30,
    }),
  });
  return { session, owner, state };
}

it.each(['pause', 'resume'] as const)(
  '%s records elapsed active time and debt together without advancing lanes',
  (control) => {
    const { session, state, owner } = create();
    session.wake(20);
    const before = { ...state };
    const sequence = owner.commitSequence;
    session[control](27.5);
    expect(state.activeTimeMs).toBe(27.5);
    expect(state.integratedPhysicsTimeMs).toBe(before.integratedPhysicsTimeMs);
    expect(state.physicsTick).toBe(before.physicsTick);
    expect(state.gameplayPeriods).toBe(before.gameplayPeriods);
    expect(state.physicsDebtMs).toBe(27.5 - before.integratedPhysicsTimeMs);
    expect(owner.commitSequence).toBe(sequence + 1);
    const restored = decodeAuthorityKernelState(encodeAuthorityKernelState(state));
    const next = create(restored, 1000);
    next.session.wake(1010);
    expect(restored.activeTimeMs).toBe(37.5);
    expect(restored.physicsTick).toBeGreaterThan(before.physicsTick);
    expect(decodeAuthorityKernelState(encodeAuthorityKernelState(restored))).toEqual(restored);
  },
);
