import { CharacterBehaviorSkills, type BehaviorCallbacks } from './character-behavior-skills';
import { BehaviourTree, State } from 'mistreevous';
import type {
  BehaviorCondition,
  BehaviorDefinition,
  BehaviorNode,
  CharacterBehaviorState,
} from '../../runtime/behavior-control-protocol';
import type {
  CharacterBehaviorRecord,
  CharacterRecord,
  CharacterRuntimeOptions,
  CharacterSkillExecution,
} from './character-runtime-types';
import {
  behaviorActionNodes,
  behaviorActionSignature,
  behaviorConditionConsumers,
  behaviorConditionContainsDialogue,
  behaviorArgs,
  validateBehavior,
} from './character-behavior-definition';

type TreeSession = {
  tree: BehaviourTree;
  delta: number;
  invoked: Set<string>;
  conditionValues: Map<string, boolean>;
};

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function createBehaviorRecord(
  goal: CharacterBehaviorRecord['goal'],
  definition: BehaviorDefinition,
  revision = 1,
  dialogueCursor = 0,
): CharacterBehaviorRecord {
  validateBehavior(goal, definition);
  return {
    revision,
    goal: cloneJson(goal),
    definition: cloneJson(definition),
    cycle: 0,
    activationSequence: 0,
    skills: [],
    monitors: behaviorConditionConsumers(definition)
      .filter((entry) => behaviorConditionContainsDialogue(entry.condition))
      .map((entry) => ({ nodeId: entry.id, matched: false, episode: 0, version: dialogueCursor })),
  };
}

export class CharacterBehaviorRuntime {
  private readonly sessions = new Map<string, TreeSession>();

  private readonly skills: CharacterBehaviorSkills;

  constructor(
    private readonly options: CharacterRuntimeOptions,
    private readonly callbacks: BehaviorCallbacks,
  ) {
    this.skills = new CharacterBehaviorSkills(options, callbacks);
  }

  state(record: CharacterRecord): CharacterBehaviorState {
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
            ...entry
          }) => ({
            ...entry,
          }),
        ),
        monitors: record.behaviorTree.monitors
          .filter((entry) => publicMonitorIds.has(entry.nodeId))
          .map(({ version: _version, ...entry }) => ({ ...entry })),
        milestones: (record.behaviorTree.goal.milestones ?? []).map((entry) => ({
          id: entry.id,
          satisfied: this.skills.condition(record, entry.condition),
        })),
      },
    };
  }

  install(record: CharacterRecord, goal: CharacterBehaviorRecord['goal'], definition: BehaviorDefinition): void {
    validateBehavior(goal, definition);
    const previousContexts = this.actionContexts(record.behaviorTree.definition);
    const nextContexts = this.actionContexts(definition);
    const nextSignatures = new Map(
      behaviorActionNodes(definition).map((node) => [node.id, behaviorActionSignature(node)]),
    );
    const compatible = (execution: CharacterSkillExecution) =>
      nextSignatures.get(execution.nodeId) === execution.signature &&
      previousContexts.get(execution.nodeId) === nextContexts.get(execution.nodeId);
    for (const execution of record.behaviorTree.skills)
      if (execution.status === 'running' && !compatible(execution))
        this.skills.interrupt(record, execution, 'behavior-replaced');
    const dialogueCursor = this.latestDialogueCursor(record);
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
      if (execution.status === 'running') this.skills.interrupt(record, execution, reason);
    this.sessions.delete(record.entityId);
  }

  advance(record: CharacterRecord, seconds: number): void {
    if (record.lifecycle !== 'active') return;
    const entity = this.options.entities.get(record.entityId);
    const actor = this.options.actor(record.entityId);
    if (!entity || !actor) return;
    record.lastBehavior = actor.behavior;
    record.hunger = actor.hunger;
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
        this.skills.interrupt(record, execution, 'branch-changed');
    record.dangerSecondsRemaining = Math.max(0, record.dangerSecondsRemaining - seconds);
    if (record.dangerSecondsRemaining === 0) record.lastThreatEntityId = undefined;
    record.lastPosition = [...entity.position];
    this.options.changed();
  }

  rebuildAfterRestore(record: CharacterRecord): void {
    validateBehavior(record.behaviorTree.goal, record.behaviorTree.definition);
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
      if (execution.actionId) {
        const action = this.options.action(execution.actionId);
        const expectedAction =
          expected.skill === 'attack-threat' ? 'attack' : this.isMovementSkill(expected.skill) ? 'move-to' : null;
        if (!action || action.actorId !== record.entityId || expectedAction === null || action.type !== expectedAction)
          throw new TypeError('Character behavior ledger action is missing or owned by another actor.');
        this.validateFollowTarget(record, execution, action.targetEntityId, true);
      }
      this.validateFollowTarget(record, execution, execution.targetEntityId, Boolean(execution.actionId));
    }
    this.sessions.delete(record.entityId);
  }

  private validateFollowTarget(
    record: CharacterRecord,
    execution: CharacterSkillExecution,
    targetEntityId: string | undefined,
    required: boolean,
  ): void {
    if (execution.skill !== 'follow') return;
    if (targetEntityId === undefined) {
      if (required) throw new TypeError('Character follow ledger target is missing.');
      return;
    }
    const node = behaviorActionNodes(record.behaviorTree.definition).find((entry) => entry.id === execution.nodeId);
    const targetRef = node ? behaviorArgs(node.args).targetRef : undefined;
    const binding = record.targets.find((entry) => entry.kind === 'entity' && entry.ref === targetRef);
    if (!binding || binding.targetId !== targetEntityId)
      throw new TypeError('Character follow ledger target does not match its authorized reference.');
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
        if (running) this.skills.interrupt(record, running, 'guard-failed');
      };
    }
    this.walkConditions(record.behaviorTree.definition.root, (key, condition) => {
      const consumerId = key.startsWith('guard_')
        ? `$guard:${key.slice('guard_'.length)}`
        : `$condition:${key.slice('condition_'.length)}`;
      agent[key] = () =>
        this.evaluateCondition(record, this.sessions.get(record.entityId)!, consumerId, condition).matched;
    });
    const session: TreeSession = {
      tree: new BehaviourTree(this.compile(record.behaviorTree.definition.root) as never, agent, {
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
      };
      record.behaviorTree.skills = record.behaviorTree.skills.filter((entry) => entry.nodeId !== node.id);
      record.behaviorTree.skills.push(execution);
      this.callbacks.record(record, 'activity-started', { nodeId: node.id, episode: execution.activation });
    }
    const result = execution.status as CharacterSkillExecution['status'];
    if (result === 'succeeded') return State.SUCCEEDED;
    if (result === 'failed' || result === 'interrupted') return State.FAILED;
    if (!session.invoked.has(node.id)) {
      execution.elapsedSeconds += session.delta;
      session.invoked.add(node.id);
      this.skills.stepSkill(record, execution, behaviorArgs(node.args));
    }
    if (execution.status === 'succeeded') return State.SUCCEEDED;
    if (execution.status === 'failed' || execution.status === 'interrupted') return State.FAILED;
    return State.RUNNING;
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
  ): Readonly<{ matched: boolean; previous: boolean | undefined; dialogueEdge: boolean }> {
    const cached = session.conditionValues.get(consumerId);
    const existing = record.behaviorTree.monitors.find((entry) => entry.nodeId === consumerId);
    if (cached !== undefined) return { matched: cached, previous: existing?.matched, dialogueEdge: false };

    const hasDialogue = behaviorConditionContainsDialogue(condition);
    const latestDialogueCursor = this.latestDialogueCursor(record);
    const previous = existing?.matched;
    const previousCursor = existing?.version ?? latestDialogueCursor;
    const matched = this.skills.condition(record, condition, previousCursor);
    const dialogueEdge = hasDialogue && latestDialogueCursor > previousCursor && matched;
    session.conditionValues.set(consumerId, matched);

    if (!hasDialogue && !trackLevel) return { matched, previous, dialogueEdge: false };
    if (!existing) {
      record.behaviorTree.monitors.push({
        nodeId: consumerId,
        matched,
        episode: matched ? 1 : 0,
        ...(hasDialogue ? { version: latestDialogueCursor } : {}),
      });
    } else {
      if (matched && (!previous || dialogueEdge)) existing.episode += 1;
      existing.matched = matched;
      if (hasDialogue) existing.version = latestDialogueCursor;
    }
    return { matched, previous, dialogueEdge };
  }

  private latestDialogueCursor(record: CharacterRecord): number {
    return [...record.events].reverse().find((event) => event.type === 'dialogue-heard')?.cursor ?? 0;
  }

  private actionContexts(definition: BehaviorDefinition): ReadonlyMap<string, string> {
    const result = new Map<string, string>();
    const walk = (node: BehaviorNode, context: readonly unknown[]) => {
      if (node.type === 'action') {
        result.set(node.id, JSON.stringify(context));
        return;
      }
      if (node.type === 'selector' || node.type === 'sequence') {
        node.children.forEach((child, index) =>
          walk(child, [
            ...context,
            {
              id: node.id,
              type: node.type,
              guard: node.guard ?? null,
              preceding: node.children.slice(0, index),
            },
          ]),
        );
      }
    };
    walk(definition.root, []);
    return result;
  }

  private isMovementSkill(skill: string): boolean {
    return ['flee-threat', 'satisfy-hunger', 'rest-at-home', 'patrol', 'wander', 'move-to', 'follow'].includes(skill);
  }

  private walkConditions(node: BehaviorNode, add: (key: string, condition: BehaviorCondition) => void): void {
    if ('guard' in node && node.guard) add(`guard_${node.id}`, node.guard);
    if (node.type === 'condition') add(`condition_${node.id}`, node.condition);
    else if (node.type === 'selector' || node.type === 'sequence')
      node.children.forEach((child) => this.walkConditions(child, add));
  }

  private compile(node: BehaviorNode): Record<string, unknown> {
    const guard = 'guard' in node && node.guard ? { while: { call: `guard_${node.id}` } } : {};
    if (node.type === 'selector' || node.type === 'sequence')
      return {
        type: 'root',
        child: { type: node.type, children: node.children.map((child) => this.compileChild(child)), ...guard },
      };
    return { type: 'root', child: this.compileChild(node) };
  }

  private compileChild(node: BehaviorNode): Record<string, unknown> {
    const guard = 'guard' in node && node.guard ? { while: { call: `guard_${node.id}` } } : {};
    if (node.type === 'selector' || node.type === 'sequence')
      return { type: node.type, children: node.children.map((child) => this.compileChild(child)), ...guard };
    if (node.type === 'condition') return { type: 'condition', call: `condition_${node.id}` };
    return { type: 'action', call: `action_${node.id}`, exit: { call: `exit_${node.id}` }, ...guard };
  }
}
