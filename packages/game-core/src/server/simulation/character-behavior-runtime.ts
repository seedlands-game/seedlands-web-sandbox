import { BehaviourTree, State } from 'mistreevous';
import type {
  BehaviorArguments,
  BehaviorCondition,
  BehaviorDefinition,
  BehaviorJson,
  BehaviorNode,
  CharacterBehaviorState,
} from '../../runtime/behavior-control-protocol';
import type { BehaviorProviderContext, BehaviorRuntimeContext } from '../composition/behavior-capability-registry';
import type {
  CharacterBehaviorRecord,
  CharacterRecord,
  CharacterRuntimeOptions,
  CharacterSkillExecution,
} from './character-runtime-types';
import { CharacterBehaviorSkills, type BehaviorCallbacks } from './character-behavior-skills';
import { validateActorBehavior } from './character-behavior-admission';
export { createBehaviorRecord } from './character-behavior-admission';
import {
  behaviorActionNodes,
  behaviorActionArgs,
  behaviorActionContexts,
  behaviorActionSignature,
  behaviorConditionConsumers,
  behaviorConditionContainsDialogue,
  behaviorConditionFailureReason,
  behaviorExecutionProviderCompatible,
  behaviorMilestoneState,
  behaviorMovementSkill,
  behaviorRetainsLegacyThreatGuard,
  type BehaviorTreeSession,
  compileBehaviorTree,
  latestBehaviorDialogueCursor,
  registeredBehaviorCapability,
  restoreBehaviorProviderIdentity,
  validateBehavior,
  walkBehaviorConditions,
} from './character-behavior-definition';

type TreeSession = BehaviorTreeSession<BehaviourTree>;

const cloneJson = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value;

export class CharacterBehaviorRuntime {
  private readonly sessions = new Map<string, TreeSession>();
  private readonly skills: CharacterBehaviorSkills;

  constructor(
    private readonly options: CharacterRuntimeOptions,
    private readonly callbacks: BehaviorCallbacks,
  ) {
    this.skills = new CharacterBehaviorSkills(options, callbacks);
  }

  state(record: CharacterRecord, options: Readonly<{ evaluateMilestones?: boolean }> = {}): CharacterBehaviorState {
    const active = record.behaviorTree.skills
      .filter((entry) => entry.status === 'running')
      .map((entry) => entry.nodeId);
    const publicMonitorIds = new Set((record.behaviorTree.definition.monitors ?? []).map((entry) => entry.id));
    return {
      revision: record.behaviorTree.revision,
      goal: cloneJson(record.behaviorTree.goal),
      definition: cloneJson(record.behaviorTree.definition),
      runtime: {
        cycle: record.behaviorTree.cycle,
        activeNodeIds: active,
        skills: record.behaviorTree.skills.map(
          ({
            signature: _signature,
            targetEntityId: _target,
            targetPosition: _position,
            searchOrigin: _origin,
            count: _count,
            providerId: _providerId,
            providerVersion: _providerVersion,
            providerModuleId: _providerModuleId,
            stateVersion: _stateVersion,
            providerState: _providerState,
            ...entry
          }) => ({ ...entry }),
        ),
        monitors: record.behaviorTree.monitors
          .filter((entry) => publicMonitorIds.has(entry.nodeId))
          .map(({ version: _version, ...entry }) => ({ ...entry })),
        milestones: (record.behaviorTree.goal.milestones ?? []).map((entry) =>
          behaviorMilestoneState(entry.id, options.evaluateMilestones !== false, () =>
            this.condition(record, entry.condition, `$milestone:${entry.id}`),
          ),
        ),
      },
    };
  }

  install(record: CharacterRecord, goal: CharacterBehaviorRecord['goal'], definition: BehaviorDefinition): void {
    validateBehavior(goal, definition, this.options.capabilities);
    validateActorBehavior(this.options, record.entityId, definition);
    const previousContexts = behaviorActionContexts(record.behaviorTree.definition);
    const nextContexts = behaviorActionContexts(definition);
    const nextSignatures = new Map(
      behaviorActionNodes(definition).map((node) => [node.id, behaviorActionSignature(node)]),
    );
    const compatible = (execution: CharacterSkillExecution) =>
      nextSignatures.get(execution.nodeId) === execution.signature &&
      previousContexts.get(execution.nodeId) === nextContexts.get(execution.nodeId) &&
      behaviorExecutionProviderCompatible(this.options.capabilities, execution);
    for (const execution of record.behaviorTree.skills)
      if (execution.status === 'running' && !compatible(execution)) this.cancel(record, execution, 'behavior-replaced');
    const dialogueCursor = latestBehaviorDialogueCursor(record);
    record.behaviorTree = {
      revision: record.behaviorTree.revision + 1,
      goal: cloneJson(goal),
      definition: cloneJson(definition),
      cycle: record.behaviorTree.cycle,
      activationSequence: record.behaviorTree.activationSequence,
      recentThreat: record.behaviorTree.recentThreat,
      skills: record.behaviorTree.skills.filter(compatible),
      monitors: behaviorConditionConsumers(definition)
        .filter((entry) => behaviorConditionContainsDialogue(entry.condition))
        .map((entry) => ({ nodeId: entry.id, matched: false, episode: 0, version: dialogueCursor })),
    };
    this.sessions.delete(record.entityId);
  }

  dispose(record: CharacterRecord, reason: string): void {
    for (const execution of record.behaviorTree.skills)
      if (execution.status === 'running') this.cancel(record, execution, reason);
    this.sessions.delete(record.entityId);
  }

  advance(record: CharacterRecord, seconds: number): void {
    if (record.lifecycle !== 'active') return;
    const entity = this.options.entities.get(record.entityId);
    const actor = this.options.actor(record.entityId);
    const body = this.options.domain.read(record.entityId);
    if (!entity || !actor || !body || body.controlSource !== 'behavior') return;
    record.lastBehavior = actor.behavior;
    let session = this.sessions.get(record.entityId);
    if (!session) session = this.rebuild(record);
    session.delta = seconds;
    session.invoked.clear();
    session.conditionValues.clear();
    this.skills.observeThreat(record, seconds);
    this.observeMonitors(record, session);
    if (session.tree.getState() === State.SUCCEEDED || session.tree.getState() === State.FAILED) {
      record.behaviorTree.cycle += 1;
      record.behaviorTree.skills = record.behaviorTree.skills.filter((entry) => entry.status === 'running');
      session.tree.reset();
    }
    session.tree.step();
    for (const execution of record.behaviorTree.skills)
      if (execution.status === 'running' && !session.invoked.has(execution.nodeId))
        this.cancel(record, execution, 'branch-changed');
    record.dangerSecondsRemaining = Math.max(0, record.dangerSecondsRemaining - seconds);
    if (record.dangerSecondsRemaining === 0) record.lastThreatEntityId = undefined;
    record.lastPosition = [...entity.position];
    this.options.changed();
  }

  rebuildAfterRestore(record: CharacterRecord): void {
    validateBehavior(record.behaviorTree.goal, record.behaviorTree.definition, this.options.capabilities);
    if (record.lifecycle === 'active')
      validateActorBehavior(this.options, record.entityId, record.behaviorTree.definition);
    const valid = new Map(
      behaviorActionNodes(record.behaviorTree.definition).map((node) => [
        node.id,
        { skill: node.skill, signature: behaviorActionSignature(node) },
      ]),
    );
    for (const execution of record.behaviorTree.skills) {
      const expected = valid.get(execution.nodeId);
      if (!expected || expected.signature !== execution.signature || expected.skill !== execution.skill)
        throw new TypeError('Character behavior ledger references an incompatible node.');
      restoreBehaviorProviderIdentity(this.options.capabilities, execution);
      if (execution.status === 'running') {
        if (execution.providerState === undefined || !execution.stateVersion)
          throw new TypeError('Running behavior ledger provider state is missing.');
        this.options.capabilities.assertRestorable({
          capabilityId: execution.providerId!,
          provider: { moduleId: execution.providerModuleId!, version: execution.providerVersion! },
          state: { version: execution.stateVersion, value: execution.providerState },
        });
      }
      if (execution.actionId) {
        const action = this.options.action(execution.actionId);
        const expectedAction =
          expected.skill === 'attack-threat' ? 'attack' : behaviorMovementSkill(expected.skill) ? 'move-to' : null;
        if (!action || action.actorId !== record.entityId || expectedAction === null || action.type !== expectedAction)
          throw new TypeError('Character behavior ledger action is missing or owned by another actor.');
      }
    }
    this.sessions.delete(record.entityId);
  }

  private rebuild(record: CharacterRecord): TreeSession {
    const agent: Record<string, unknown> = {};
    for (const node of behaviorActionNodes(record.behaviorTree.definition)) {
      agent[`action_${node.id}`] = () => this.runSkill(record, node, this.sessions.get(record.entityId)!);
      agent[`exit_${node.id}`] = (result: { aborted?: boolean }) => {
        if (!result?.aborted) return;
        const running = record.behaviorTree.skills.find(
          (entry) => entry.nodeId === node.id && entry.status === 'running',
        );
        if (running) this.cancel(record, running, 'guard-failed');
      };
    }
    walkBehaviorConditions(record.behaviorTree.definition.root, (key, condition) => {
      const consumerId = key.startsWith('guard_')
        ? `$guard:${key.slice('guard_'.length)}`
        : `$condition:${key.slice('condition_'.length)}`;
      agent[key] = () =>
        this.evaluateCondition(record, this.sessions.get(record.entityId)!, consumerId, condition).matched;
    });
    const session: TreeSession = {
      tree: new BehaviourTree(compileBehaviorTree(record.behaviorTree.definition.root) as never, agent, {
        getDeltaTime: () => session.delta,
        random: () => 0.5,
      }),
      delta: 0,
      invoked: new Set(),
      conditionValues: new Map(),
    };
    this.sessions.set(record.entityId, session);
    return session;
  }

  private runSkill(
    record: CharacterRecord,
    node: Extract<BehaviorNode, { type: 'action' }>,
    session: TreeSession,
  ): State {
    let execution = record.behaviorTree.skills.find(
      (entry) => entry.nodeId === node.id && entry.signature === behaviorActionSignature(node),
    );
    if (!execution) {
      const capability = registeredBehaviorCapability(this.options.capabilities, 'skill', node.skill);
      execution = {
        nodeId: node.id,
        skill: node.skill,
        signature: behaviorActionSignature(node),
        activation: ++record.behaviorTree.activationSequence,
        status: 'running',
        phase: 'starting',
        elapsedSeconds: 0,
        replanCount: 0,
        count: 0,
        providerId: capability.id,
        providerVersion: capability.version,
        providerModuleId: capability.provider.moduleId,
        stateVersion: capability.state!.version,
      };
      record.behaviorTree.skills = record.behaviorTree.skills.filter((entry) => entry.nodeId !== node.id);
      record.behaviorTree.skills.push(execution);
      this.callbacks.record(record, 'activity-started', { nodeId: node.id, episode: execution.activation });
    }
    const status = execution.status as CharacterSkillExecution['status'];
    if (status === 'succeeded') return State.SUCCEEDED;
    if (status === 'failed' || status === 'interrupted') return State.FAILED;
    if (!session.invoked.has(node.id)) {
      execution.elapsedSeconds += session.delta;
      session.invoked.add(node.id);
      try {
        const context = this.context(record, execution, session.delta);
        const result =
          execution.providerState === undefined
            ? this.options.capabilities.start(node.skill, context, node.args)
            : this.options.capabilities.continue(node.skill, context, node.args, execution.providerState);
        this.applyResult(record, execution, result);
      } catch (error) {
        this.fail(record, execution, error instanceof Error ? error.message : 'provider-failed');
      }
    }
    const finalStatus = execution.status as CharacterSkillExecution['status'];
    if (finalStatus === 'succeeded') return State.SUCCEEDED;
    if (finalStatus === 'failed' || finalStatus === 'interrupted') return State.FAILED;
    return State.RUNNING;
  }

  private context(
    record: CharacterRecord,
    execution: CharacterSkillExecution,
    deltaSeconds: number,
    dialogueAfterCursor = 0,
  ): BehaviorRuntimeContext {
    const body = this.options.domain.read(record.entityId);
    if (!body || body.controlSource !== 'behavior')
      throw new TypeError('Behavior actor domain binding is unavailable.');
    const actor = Object.freeze({
      entityId: body.reference.entityId,
      epoch: body.reference.epoch,
      lifetime: body.reference.lifetime,
      behaviorRevision: record.behaviorTree.revision,
      activation: execution.activation,
    });
    return Object.freeze({
      actor,
      actorState: Object.freeze({
        reference: Object.freeze({ ...body.reference }),
        lifecycle: body.lifecycle,
        controlSource: 'behavior' as const,
        health: body.health,
        maxHealth: body.maxHealth,
        needs: Object.freeze({ ...body.needs }),
        inventory: Object.freeze({
          slots: Object.freeze(body.inventory.slots.map((slot) => (slot ? cloneJson(slot) : null))),
          selectedSlot: body.inventory.selectedSlot,
          revision: body.inventory.revision,
        }),
      }),
      deltaSeconds,
      elapsedSeconds: execution.elapsedSeconds,
      resolveTarget: (reference: string) => {
        const targetId = this.callbacks.resolveTargetRef(record, reference);
        return targetId ? this.options.entities.createReference(targetId) : null;
      },
      invoke: (origin, request) => this.options.domain.invoke(record.entityId, origin, request),
      allows: (capability) => this.options.domain.allowsCapability(record.entityId, capability),
      standard: Object.freeze({
        evaluate: (id: string, args: BehaviorArguments) => this.skills.evaluate(record, id, args, dialogueAfterCursor),
        start: (
          _id: string,
          args: BehaviorArguments,
          port: Pick<BehaviorProviderContext, 'invoke' | 'resolveTarget'>,
        ) => this.skills.start(record, execution, args, port),
        continue: (
          _id: string,
          args: BehaviorArguments,
          state: BehaviorJson,
          port: Pick<BehaviorProviderContext, 'invoke' | 'resolveTarget'>,
        ) => this.skills.continue(record, execution, args, state, port),
        cancel: (_id: string, _args: BehaviorArguments, _state: BehaviorJson, reason: string) =>
          this.skills.cancel(record, execution, reason),
      }),
    });
  }

  private applyResult(
    record: CharacterRecord,
    execution: CharacterSkillExecution,
    result: ReturnType<CharacterRuntimeOptions['capabilities']['start']>,
  ): void {
    execution.phase = result.phase ?? result.status;
    if (result.status === 'running') {
      execution.providerState = cloneJson(result.state);
      return;
    }
    execution.providerState = undefined;
    if (result.status === 'succeeded') {
      if (execution.status === 'running') {
        execution.status = 'succeeded';
        this.callbacks.record(record, 'activity-succeeded', {
          nodeId: execution.nodeId,
          episode: execution.activation,
          count: execution.count,
        });
      }
      return;
    }
    if (result.status === 'cancelled') {
      if (execution.status === 'running') execution.status = 'interrupted';
      return;
    }
    this.fail(record, execution, result.reason);
  }

  private fail(record: CharacterRecord, execution: CharacterSkillExecution, reason: string): void {
    if (execution.status !== 'running') return;
    execution.status = 'failed';
    execution.reason = reason.slice(0, 256);
    this.callbacks.record(record, 'activity-failed', {
      nodeId: execution.nodeId,
      episode: execution.activation,
      reason: execution.reason,
    });
  }

  private cancel(record: CharacterRecord, execution: CharacterSkillExecution, reason: string): void {
    if (execution.status !== 'running') return;
    try {
      if (execution.providerState === undefined) {
        this.skills.interrupt(record, execution, reason);
        return;
      }
      const result = this.options.capabilities.cancel(
        execution.skill,
        this.context(record, execution, 0),
        behaviorActionArgs(record.behaviorTree.definition, execution.nodeId),
        execution.providerState,
        reason,
      );
      execution.providerState = undefined;
      execution.status = result.status === 'failed' ? 'failed' : 'interrupted';
      execution.reason = result.status === 'failed' ? result.reason : reason;
      if (result.status !== 'failed' && execution.providerModuleId !== 'seedlands:behavior-registry-module')
        this.callbacks.record(record, 'activity-interrupted', {
          nodeId: execution.nodeId,
          episode: execution.activation,
          reason,
        });
    } catch (error) {
      this.fail(record, execution, error instanceof Error ? error.message : 'cancel-failed');
    }
  }

  private condition(record: CharacterRecord, condition: BehaviorCondition, consumerId: string): boolean {
    return this.evaluateCondition(
      record,
      { tree: null as never, delta: 0, invoked: new Set(), conditionValues: new Map() },
      consumerId,
      condition,
      false,
      false,
    ).matched;
  }

  private evaluateNamed(
    record: CharacterRecord,
    condition: Extract<BehaviorCondition, { name: string }>,
    dialogueAfterCursor: number,
  ): boolean {
    const execution: CharacterSkillExecution = {
      nodeId: '$condition',
      skill: '$condition',
      signature: '$condition',
      activation: 0,
      status: 'running',
      phase: 'condition',
      elapsedSeconds: 0,
      replanCount: 0,
      count: 0,
    };
    return this.options.capabilities.evaluate(
      condition.name,
      this.context(record, execution, 0, dialogueAfterCursor),
      condition.args,
    );
  }

  private evaluateRecursive(record: CharacterRecord, condition: BehaviorCondition, cursor: number): boolean {
    if ('all' in condition) return condition.all.every((entry) => this.evaluateRecursive(record, entry, cursor));
    if ('any' in condition) return condition.any.some((entry) => this.evaluateRecursive(record, entry, cursor));
    if ('not' in condition) return !this.evaluateRecursive(record, condition.not, cursor);
    return this.evaluateNamed(record, condition, cursor);
  }

  private observeMonitors(record: CharacterRecord, session: TreeSession): void {
    for (const entry of record.behaviorTree.definition.monitors ?? []) {
      const evaluation = this.evaluateCondition(record, session, entry.id, entry.condition, true);
      if ((evaluation.previous === false && evaluation.matched) || evaluation.dialogueEdge) {
        const monitor = record.behaviorTree.monitors.find((value) => value.nodeId === entry.id)!;
        this.callbacks.record(record, 'rejudge-requested', {
          nodeId: entry.id,
          episode: monitor.episode,
          reason: entry.reason,
        });
      }
    }
  }

  private evaluateCondition(
    record: CharacterRecord,
    session: TreeSession,
    consumerId: string,
    condition: BehaviorCondition,
    trackLevel = false,
    reportFailure = true,
  ): Readonly<{ matched: boolean; previous: boolean | undefined; dialogueEdge: boolean }> {
    const cached = session.conditionValues.get(consumerId);
    const existing = record.behaviorTree.monitors.find((entry) => entry.nodeId === consumerId);
    if (cached !== undefined) return { matched: cached, previous: existing?.matched, dialogueEdge: false };
    const hasDialogue = behaviorConditionContainsDialogue(condition);
    const latestDialogueCursor = latestBehaviorDialogueCursor(record);
    const previous = existing?.matched,
      previousCursor = existing?.version ?? latestDialogueCursor;
    let matched: boolean;
    try {
      matched =
        behaviorRetainsLegacyThreatGuard(record, consumerId, condition) ||
        this.evaluateRecursive(record, condition, previousCursor);
    } catch (error) {
      if (!reportFailure) throw error;
      matched = false;
      const reason = behaviorConditionFailureReason(record, consumerId, error);
      if (reason) this.callbacks.record(record, 'activity-failed', { nodeId: consumerId, reason });
    }
    const dialogueEdge = hasDialogue && latestDialogueCursor > previousCursor && matched;
    session.conditionValues.set(consumerId, matched);
    if (!hasDialogue && !trackLevel) return { matched, previous, dialogueEdge: false };
    if (!existing)
      record.behaviorTree.monitors.push({
        nodeId: consumerId,
        matched,
        episode: matched ? 1 : 0,
        ...(hasDialogue ? { version: latestDialogueCursor } : {}),
      });
    else {
      if (matched && (!previous || dialogueEdge)) existing.episode += 1;
      existing.matched = matched;
      if (hasDialogue) existing.version = latestDialogueCursor;
    }
    return { matched, previous, dialogueEdge };
  }
}
