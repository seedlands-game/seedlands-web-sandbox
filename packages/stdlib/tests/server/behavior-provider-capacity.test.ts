import { createKernelStateOwner } from '@seedlands/kernel/execution';
import { describe, expect, it } from 'vitest';
import type { BodyConfig } from '../../src/physics';
import type { BehaviorDefinition } from '../../src/runtime/behavior-control-protocol';
import { BEHAVIOR_PROVIDER_CALLBACK_INVOKE_BUDGET } from '../../src/server/composition/behavior-capability-dispatch';
import {
  createBehaviorCapabilityRegistry,
  type BehaviorProviderContext,
  type BehaviorRuntimeContext,
} from '../../src/server/composition/behavior-capability-registry';
import {
  createAuthorityKernelExecutionPort,
  createAuthorityKernelState,
  encodeAuthorityKernelState,
} from '../../src/server/authority/authority-kernel-state';
import { AuthoritySession, type AuthorityServerPort } from '../../src/server/authority/authority-session';
import { characterBehaviorCommitUpperBound } from '../../src/server/simulation/character-advance-capacity';

const operation = {
  operationId: 'test:increment',
  target: { kind: 'entity' as const, entityId: 'npc-1' },
  input: {},
};
const definition: BehaviorDefinition = {
  version: 1,
  root: { id: 'repeat', type: 'action', skill: 'test:repeat' },
};
const bodyConfig: BodyConfig = {
  localAabb: { min: { x: -0.3, y: 0, z: -0.3 }, max: { x: 0.3, y: 1.8, z: 0.3 } },
  gravity: 20,
  terminalVelocity: 30,
};

function behaviorContext(invoke: BehaviorRuntimeContext['invoke']): BehaviorRuntimeContext {
  return {
    actor: { entityId: 'npc-1', epoch: 1, lifetime: 1, behaviorRevision: 1, activation: 1 },
    actorState: {
      reference: { entityId: 'npc-1', epoch: 1, lifetime: 1 },
      lifecycle: 'alive',
      controlSource: 'behavior',
      health: 10,
      maxHealth: 10,
      needs: { hunger: 0, maxHunger: 100, hungerMeaning: 'deficit' },
      inventory: { slots: [], selectedSlot: 0, revision: 0 },
    },
    deltaSeconds: 0.1,
    elapsedSeconds: 0.1,
    invoke,
    resolveTarget: () => null,
    allows: () => true,
    standard: {
      evaluate: () => false,
      start: () => ({ status: 'failed', reason: 'unused' }),
      continue: () => ({ status: 'failed', reason: 'unused' }),
      cancel: () => ({ status: 'cancelled' }),
    },
  };
}

function createRegistry(callbacks: {
  start(context: BehaviorProviderContext): ReturnType<BehaviorProviderContext['invoke']>[];
  continue?(context: BehaviorProviderContext): void;
}) {
  const registry = createBehaviorCapabilityRegistry();
  registry.register(
    { moduleId: 'test:behavior', moduleVersion: '1.0.0', packId: 'test:pack' },
    {
      id: 'test:repeat',
      version: '1.0.0',
      kind: 'skill',
      description: 'Repeats an authorized operation.',
      arguments: {},
      requiredOperations: [{ operationId: operation.operationId, authorization: 'self' }],
      state: { version: '1.0.0', maximumBytes: 32 },
      start(context) {
        callbacks.start(context);
        return { status: 'running', phase: 'active', state: {} };
      },
      continue(context) {
        callbacks.continue?.(context);
        return { status: 'running', phase: 'active', state: {} };
      },
    },
  );
  registry.freeze({
    operation: (id) =>
      id === operation.operationId
        ? { id, moduleId: 'test:counter', resource: 'test.counter', executionKind: 'actor' }
        : null,
    module: (id) =>
      ['test:behavior', 'test:counter'].includes(id)
        ? { packId: 'test:pack', permissions: [{ resource: 'test.counter', operations: ['execute'] }] }
        : null,
  });
  return registry;
}

describe('Behavior provider advance capacity', () => {
  it('revokes retained callback contexts and limits each live callback to the shared budget', () => {
    let executed = 0;
    let retained: BehaviorProviderContext | null = null;
    let firstResults: ReturnType<BehaviorProviderContext['invoke']>[] = [];
    let secondResults: ReturnType<BehaviorProviderContext['invoke']>[] = [];
    let retainedResult: ReturnType<BehaviorProviderContext['invoke']> | null = null;
    const registry = createRegistry({
      start(context) {
        retained = context;
        firstResults = Array.from({ length: BEHAVIOR_PROVIDER_CALLBACK_INVOKE_BUDGET + 1 }, () =>
          context.invoke(operation),
        );
        return firstResults;
      },
      continue(context) {
        retainedResult = retained!.invoke(operation);
        secondResults = Array.from({ length: BEHAVIOR_PROVIDER_CALLBACK_INVOKE_BUDGET + 1 }, () =>
          context.invoke(operation),
        );
      },
    });
    const context = behaviorContext(() => ({ ok: true, value: ++executed, revision: executed }));
    const started = registry.start('test:repeat', context, {});
    if (started.status !== 'running') throw new Error('Provider did not start.');
    expect(retained!.invoke(operation)).toMatchObject({ ok: false, code: 'BEHAVIOR_CONTEXT_EXPIRED' });
    registry.continue('test:repeat', context, {}, started.state);

    expect(firstResults.at(-1)).toMatchObject({ ok: false, code: 'BEHAVIOR_OPERATION_BUDGET_EXHAUSTED' });
    expect(retainedResult).toMatchObject({ ok: false, code: 'BEHAVIOR_CONTEXT_EXPIRED' });
    expect(secondResults.at(-1)).toMatchObject({ ok: false, code: 'BEHAVIOR_OPERATION_BUDGET_EXHAUSTED' });
    expect(executed).toBe(BEHAVIOR_PROVIDER_CALLBACK_INVOKE_BUDGET * 2);
  });

  it('rejects a six-invocation Character callback near exhaustion before any lane changes', () => {
    const owner = createKernelStateOwner({ commitSequence: Number.MAX_SAFE_INTEGER - 6 });
    const state = createAuthorityKernelState();
    const execution = createAuthorityKernelExecutionPort(owner, state);
    let providerInvocations = 0;
    const context = behaviorContext(() => {
      providerInvocations += 1;
      owner.commitGameplay(owner.epoch);
      return { ok: true, value: providerInvocations, revision: owner.gameplayRevision };
    });
    const registry = createRegistry({
      start(providerContext) {
        return Array.from({ length: 6 }, () => providerContext.invoke(operation));
      },
    });
    const entity = { id: 'npc-1', type: 'npc' as const, position: [0.5, 1, 0.5] as [number, number, number] };
    const server: AuthorityServerPort = {
      worldRevision: 0,
      mutationCount: 0,
      worldTime: 9,
      getEntity: () => ({ ...entity }),
      queryEntities: () => [{ ...entity }],
      updateEntity: () => owner.commitGameplay(owner.epoch),
      updateEntities: (updates) => owner.commitGameplayBatch(owner.epoch, updates.length),
      gameplayAdvanceCommitUpperBound: () => characterBehaviorCommitUpperBound(definition, 1),
      advanceGameplayRules: () => {
        registry.start('test:repeat', context, {});
      },
    };
    const session = new AuthoritySession({
      epoch: 'capacity:custom-provider',
      playerId: entity.id,
      server,
      bodyConfigFor: () => bodyConfig,
      voxelSource: { getLoadedVoxel: () => ({ voxel: 0, chunkKey: 'loaded', revision: 0 }) },
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
      startTimeMs: 0,
      execution,
    });
    const beforeState = encodeAuthorityKernelState(state);
    const beforeOwner = owner.snapshot();
    const beforeSnapshot = session.currentSnapshot;

    expect(() => session.wake(50)).toThrow('Kernel commit sequence is exhausted.');
    expect(providerInvocations).toBe(0);
    expect(encodeAuthorityKernelState(state)).toEqual(beforeState);
    expect(owner.snapshot()).toEqual(beforeOwner);
    expect(session.currentSnapshot).toEqual(beforeSnapshot);
  });
});
