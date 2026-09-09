import type { GameplayModuleRuntime } from './gameplay-module-runtime';
import type { ModuleSystemAuthority } from './gameplay-module-schedule';
import type { ModuleInvocationValue } from '../../composition/contracts';
import type {
  ObservedModState,
  RegisteredCommitContext,
  PreparedRegisteredCommit,
  RegisteredOperationRequest,
  RegisteredOperationResult,
} from '../../composition/operation-contracts';
import { captureDurableExecutionOrigin } from '../../composition/execution-origin';
import type { WorldModuleBinding } from '../../commands/module-command';
import type { CombatRequestResult, PreparedCombatMutation } from '../combat-runtime';
import { prepareCombatDamage } from '../prepared-combat-damage';
import type { PreparedEntityMutation } from '../prepared-entity-mutation';
import type { ActionRuntime } from '../../simulation/action-runtime';
import type { CombatAutonomyEffects } from '../../simulation/prepared-combat-effects';
import { createCombatStatePort } from './combat-state-port';
import { createCombatHostEnvironment, type CombatHostEnvironmentOptions } from './combat-host-environment';
import {
  COMBAT_REQUEST_OPERATION,
  COMBAT_RESOLVE_OPERATION,
  COMBAT_ADVANCE_OPERATION,
  COMBAT_RESOURCE,
  COMBAT_CLOCK_RESOURCE,
  COMBAT_PARTITIONS,
  COMBAT_SYSTEM,
  combatActorAddress,
  combatWorldAddress,
  validateCombatCandidate,
} from './combat-model';

type Options = CombatHostEnvironmentOptions &
  Readonly<{
    revision(): number;
    rulesetRevision(): number;
    now(): number;
    assertCanChange(): void;
    changed(): void;
    modules(): GameplayModuleRuntime;
    systemAuthority?: ModuleSystemAuthority;
  }>;

/** Coordinates existing owners after registered rules finish; candidates never become ECS components. */
export class RegisteredCombatRuntime {
  readonly environment;
  readonly state;
  readonly enabled: boolean;
  constructor(private readonly options: Options) {
    this.environment = createCombatHostEnvironment(options);
    this.enabled = [COMBAT_REQUEST_OPERATION, COMBAT_RESOLVE_OPERATION, COMBAT_ADVANCE_OPERATION].every((id) =>
      options.composition.registrations.operations.some(({ definition }) => definition.id === id),
    );
    this.state = createCombatStatePort({
      project: this.environment.project,
      frontierSignature: () =>
        JSON.stringify([
          options.revision(),
          options.simulation().combat.snapshot(),
          options.simulation().combat.peekLifecycleEvents(),
        ]),
      prepare: (observed, execution) => this.prepare(observed, execution),
    });
  }
  private invoke(binding: WorldModuleBinding, actorId: string, request: RegisteredOperationRequest) {
    return this.options
      .modules()
      .invoke(binding.authorizer, { principalId: binding.principalId, originalActorId: actorId }, request);
  }
  private invokeSystem(request: RegisteredOperationRequest): RegisteredOperationResult {
    const authority = this.options.systemAuthority;
    const owner = this.options.composition.registrations.operations.find(
      ({ definition }) => definition.id === request.operationId,
    );
    if (!authority || !owner)
      return { ok: false, code: 'COMBAT_SYSTEM_UNAVAILABLE', message: 'Combat system authority is missing.' };
    const execution = this.options.modules().bindSystem(authority.authorizer, {
      kind: 'system',
      moduleId: owner.moduleId,
      principalId: authority.principalId,
      systemId: COMBAT_SYSTEM,
    });
    try {
      return execution.invoke(request);
    } finally {
      execution.dispose();
    }
  }
  originFor(entities: Options['entities']) {
    return createCombatHostEnvironment({ ...this.options, entities }).originOptions;
  }
  private prepare(observed: readonly ObservedModState[], execution: RegisteredCommitContext): PreparedRegisteredCommit {
    if (!this.enabled) return { ok: false, code: 'COMBAT_UNAVAILABLE', reason: 'combat-unavailable' };
    const candidate = validateCombatCandidate(execution.candidateValue);
    const operationId =
      candidate.kind === 'request'
        ? COMBAT_REQUEST_OPERATION
        : candidate.kind === 'resolve'
          ? COMBAT_RESOLVE_OPERATION
          : COMBAT_ADVANCE_OPERATION;
    const resource = candidate.kind === 'advance' ? COMBAT_CLOCK_RESOURCE : COMBAT_RESOURCE;
    if (execution.operationId !== operationId || execution.resource !== resource)
      throw new TypeError('Combat candidate operation mismatch.');
    const owner = this.options.composition.registrations.operations.find(
      ({ definition }) => definition.id === operationId,
    )!;
    if (owner.moduleId !== execution.context.provenance.moduleId)
      throw new TypeError('Combat candidate owner mismatch.');
    const expected =
      candidate.kind === 'advance'
        ? Array.from({ length: COMBAT_PARTITIONS }, (_, i) => combatWorldAddress(i))
        : [combatActorAddress(candidate.actorId), combatActorAddress(candidate.targetId)];
    const keys = (values: readonly object[]) =>
      values
        .map((value) => JSON.stringify(value))
        .sort()
        .join('|');
    if (keys(observed.map((entry) => entry.address)) !== keys(expected))
      throw new TypeError('Combat candidate observation scope mismatch.');
    const { simulation, entities } = this.options;
    const combat = simulation().combat;
    if (candidate.kind === 'advance') {
      if (execution.context.kind !== 'system' || execution.context.target.kind !== 'world')
        throw new TypeError('Combat clock requires a system context.');
      const pending = combat.peekPendingHits();
      const cancelActorIds = (candidate.cancelTokens ?? []).map((token) => {
        const hit = pending.find((entry) => entry.token === token);
        if (!hit) throw new TypeError('Combat cancellation token is stale.');
        return hit.actorId;
      });
      const plan = combat.prepareMutation({
        advanceSeconds: candidate.seconds,
        cancelActorIds,
        actorCancellationReason: 'combat-resolution-rejected',
      });
      const idle =
        !combat.peekLifecycleEvents().length &&
        combat
          .snapshot()
          .combatants.every(({ combat: state }) => !state.active && state.cooldownRemainingSeconds === 0);
      return this.commit(
        plan,
        { success: true, advancedSeconds: candidate.seconds, cancelled: cancelActorIds.length },
        { changesState: !idle },
      );
    }
    const context = execution.context;
    if (
      context.kind !== 'actor' ||
      context.originalActorId !== candidate.actorId ||
      context.target.kind !== 'entity' ||
      context.target.entityId !== candidate.targetId ||
      candidate.rulesetRevision !== this.options.rulesetRevision()
    )
      throw new TypeError('Combat candidate execution context mismatch.');
    const origin = captureDurableExecutionOrigin({
      composition: this.options.composition,
      authorizer: execution.authorizer,
      identity: this.environment.identity,
      binding: {
        moduleId: context.provenance.moduleId,
        principalId: context.principal.id,
        originalActorId: candidate.actorId,
      },
      request: { resource, operation: 'execute', target: context.target },
    });
    this.environment.resolveOrigin(origin, candidate.targetId);
    if (candidate.kind === 'request') {
      if (candidate.definitionId !== this.environment.projectActor(candidate.actorId).meleeDefinitionId)
        throw new TypeError('Combat equipment selection is stale.');
      if (combat.peekLifecycleEvents().length)
        return {
          ok: false,
          code: 'COMBAT_FRONTIER_BUSY',
          reason: 'Combat lifecycle must settle before another request.',
        };
      const active = combat.snapshotFor(candidate.actorId).active;
      const start = active
        ? undefined
        : simulation().actions.prepareStart(
            { actorId: candidate.actorId, type: 'attack', targetEntityId: candidate.targetId },
            this.options.now(),
            { status: 'running' },
          );
      const plan = combat.prepareRequest({
        actorId: candidate.actorId,
        targetId: candidate.targetId,
        definitionId: candidate.definitionId,
        origin,
        actionId: active?.actionId ?? start!.action.id,
      });
      if (!plan.success) return { ok: false, code: 'COMBAT_REJECTED', reason: plan.reason };
      return this.commit(plan, plan.result, {
        start,
        effects: {
          started: { actorId: candidate.actorId, targetId: candidate.targetId, replaced: !!start?.replacedAction },
        },
      });
    }
    const pending = combat.peekPendingHits().find((hit) => hit.token === candidate.token);
    if (
      !pending ||
      pending.actorId !== candidate.actorId ||
      pending.targetId !== candidate.targetId ||
      JSON.stringify(origin) !== JSON.stringify(pending.origin)
    )
      throw new TypeError('Combat pending origin mismatch.');
    if (!entities.resolveReference(pending.actorIdentity) || !entities.resolveReference(pending.targetIdentity))
      throw new TypeError('Combat pending lifetime is stale.');
    const reason = this.environment.hitFailure(candidate.actorId, candidate.targetId, pending.definitionId);
    const damage = reason
      ? { damage: 0, entity: null, deaths: [], removals: [] }
      : prepareCombatDamage({
          entities,
          targetId: candidate.targetId,
          damage: candidate.damage,
          actorDeathDrop: (id) => simulation().actorDeathDrop(id),
        });
    const plan = combat.prepareMutation({
      resolveHit: {
        token: candidate.token,
        outcome: reason ? 'miss' : 'hit',
        damage: damage.damage,
        ...(reason ? { reason } : {}),
      },
      cancelActorIds: damage.deaths,
      cancelTargetIds: damage.deaths,
      exceptActorId: candidate.actorId,
    });
    return this.commit(
      plan,
      { success: true, damage: damage.damage, outcome: reason ? 'miss' : 'hit' },
      {
        entity: damage.entity,
        effects: {
          deaths: damage.deaths,
          removals: damage.removals,
          ...(!reason && damage.damage > 0
            ? { attacked: { targetId: candidate.targetId, actorId: candidate.actorId } }
            : {}),
        },
      },
    );
  }
  private commit(
    combat: PreparedCombatMutation,
    value: ModuleInvocationValue,
    input: Readonly<{
      changesState?: boolean;
      start?: ReturnType<ActionRuntime['prepareStart']>;
      entity?: PreparedEntityMutation | null;
      effects?: CombatAutonomyEffects;
    }> = {},
  ): PreparedRegisteredCommit {
    const changesState = input.changesState !== false;
    if (changesState) this.options.assertCanChange();
    const revision = this.options.revision();
    const effects = this.options.simulation().prepareCombatEffects(combat, input.effects);
    let used = false;
    return {
      ok: true,
      revision: revision + Number(changesState),
      value,
      validate: () => {
        if (used || revision !== this.options.revision()) throw new Error('Combat commit revision is stale.');
        if (changesState) this.options.assertCanChange();
        input.start?.validate();
        input.entity?.validate();
        effects.validate();
      },
      apply: () => {
        if (used) throw new Error('Combat commit already applied.');
        input.start?.apply();
        combat.apply();
        input.entity?.apply();
        effects.apply();
        if (changesState) this.options.changed();
        used = true;
      },
    };
  }
  request(
    actorId: string,
    targetId: string,
    existingActionId?: string,
    binding?: WorldModuleBinding,
  ): CombatRequestResult & { damage?: number } {
    if (!this.enabled) return { success: false, reason: 'combat-unavailable' };
    const actor = this.options.entities.get(actorId);
    const authority = binding ?? (actor && this.options.actorAuthority?.forActor(actorId, actor.type));
    if (!authority) return { success: false, reason: 'combat-authority-missing' };
    this.drain();
    if (existingActionId) {
      const active = this.options.simulation().combat.snapshotFor(actorId).active;
      return active?.actionId === existingActionId && active.targetId === targetId
        ? { success: true, actionId: existingActionId, buffered: active.buffered }
        : { success: false, reason: 'combat-action-stale' };
    }
    const result = this.invoke(authority, actorId, {
      operationId: COMBAT_REQUEST_OPERATION,
      target: { kind: 'entity', entityId: targetId },
      input: { targetId },
    });
    if (!result.ok) return { success: false, reason: result.message };
    const value = result.value;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('success' in value) ||
      !('actionId' in value) ||
      !('buffered' in value) ||
      value.success !== true ||
      typeof value.actionId !== 'string' ||
      typeof value.buffered !== 'boolean'
    )
      throw new Error('Combat request returned an invalid receipt.');
    this.drain();
    const last = this.options.simulation().combat.snapshotFor(actorId).lastResult;
    return {
      success: true,
      actionId: value.actionId,
      buffered: value.buffered,
      ...(last?.actionId === value.actionId && last.outcome === 'hit' ? { damage: last.damage } : {}),
    };
  }
  drain() {
    if (!this.enabled) return;
    const combat = this.options.simulation().combat;
    for (let remaining = 8192; remaining > 0; remaining--) {
      const pending = combat.peekPendingHits()[0];
      if (!pending && !combat.peekLifecycleEvents().length) return;
      let resolved = false;
      if (pending) {
        try {
          const binding = this.environment.resolveOrigin(pending.origin, pending.targetId);
          resolved = this.invoke(binding, pending.actorId, {
            operationId: COMBAT_RESOLVE_OPERATION,
            target: { kind: 'entity', entityId: pending.targetId },
            input: { token: pending.token },
          }).ok;
        } catch {
          /* Current policy or identity rejection is settled by the registered clock below. */
        }
      }
      if (!resolved) {
        const cancelled = this.invokeSystem({
          operationId: COMBAT_ADVANCE_OPERATION,
          target: { kind: 'world' },
          input: { seconds: 0, ...(pending ? { cancelTokens: [pending.token] } : {}) },
        });
        if (!cancelled.ok) throw new Error(`Combat frontier cannot settle: ${cancelled.code}: ${cancelled.message}`);
      }
      if (pending && combat.peekPendingHits().some((hit) => hit.token === pending.token))
        throw new Error('Combat resolution did not consume its pending token.');
    }
    throw new RangeError('Combat snapshot frontier exceeds its settlement budget.');
  }
}
