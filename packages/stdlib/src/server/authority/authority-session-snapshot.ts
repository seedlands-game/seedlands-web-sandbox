import type { InputCommandBuffer } from '../../runtime/session-protocol';
import type { VoxelCollisionWorld } from './voxel-collision-world';
import type { AuthoritySessionOptions } from './authority-session-options';
import type { AuthorityKernelState } from './authority-kernel-state';
import type { AuthorityBodySnapshot, AuthoritySnapshot, BodyRecoveryDiagnostic } from './authority-session-types';
import { projectMovementBodies } from './actor-movement-projection';

/** Pure projection of existing owners; no retained snapshot or alternate session state. */
export function projectAuthoritySessionSnapshot(
  source: Readonly<{
    options: AuthoritySessionOptions;
    state: AuthorityKernelState;
    input: InputCommandBuffer;
    bodies: ReadonlyMap<string, AuthorityBodySnapshot>;
    collisionWorld: VoxelCollisionWorld;
    paused: boolean;
    recoveryResults: readonly BodyRecoveryDiagnostic[];
    physicsCost: NonNullable<AuthoritySnapshot['diagnostics']>['physicsCost'];
  }>,
): AuthoritySnapshot {
  const { options, state, input, bodies, collisionWorld } = source;
  return {
    kind: 'snapshot',
    protocolVersion: 1,
    epoch: options.epoch,
    physicsTick: state.physicsTick,
    commitSequence: options.execution.commitSequence,
    acknowledgedInputSequence: input.acknowledgedSequence,
    inputResyncRequired: input.requiresResync,
    activeTimeMs: state.activeTimeMs,
    integratedPhysicsTimeMs: state.integratedPhysicsTimeMs,
    physicsDebtMs: state.physicsDebtMs,
    ...projectMovementBodies(options, bodies),
    chunkRevisions: collisionWorld.revisionVector(),
    worldRevision: options.server.worldRevision,
    worldMutationCount: options.server.mutationCount,
    worldTime: options.server.worldTime,
    paused: source.paused,
    diagnostics: {
      recoveryResults: source.recoveryResults.map((result) => ({ ...result })),
      physicsCost: source.physicsCost,
      ...(options.server.fluidDiagnostics ? { fluid: { ...options.server.fluidDiagnostics } } : {}),
    },
  };
}
