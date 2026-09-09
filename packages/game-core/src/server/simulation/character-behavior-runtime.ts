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
import { behaviorArgs, validateBehavior } from './character-behavior-definition';

type TreeSession = { tree: BehaviourTree; delta: number; invoked: Set<string>; guardValues: Map<string, boolean> };

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const nodeSignature = (node: Extract<BehaviorNode, { type: 'action' }>) =>
  JSON.stringify({ skill: node.skill, args: node.args ?? {}, guard: node.guard ?? null });

export function createBehaviorRecord(
  goal: CharacterBehaviorRecord['goal'],
  definition: BehaviorDefinition,
  revision = 1,
): CharacterBehaviorRecord {
  validateBehavior(goal, definition);
  return {
    revision,
    goal: cloneJson(goal),
    definition: cloneJson(definition),
    cycle: 0,
    activationSequence: 0,
    skills: [],
    monitors: [],
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
    return {
      revision: record.behaviorTree.revision,
      goal: cloneJson(record.behaviorTree.goal),
      definition: cloneJson(record.behaviorTree.definition),
      runtime: {
        cycle: record.behaviorTree.cycle,
        activeNodeIds: active,
        skills: record.behaviorTree.skills.map(
          ({ signature: _signature, targetEntityId: _target, targetPosition: _position, count: _count, ...entry }) => ({
            ...entry,
          }),
        ),
        monitors: record.behaviorTree.monitors.map(({ version: _version, ...entry }) => ({ ...entry })),
        milestones: (record.behaviorTree.goal.milestones ?? []).map((entry) => ({
          id: entry.id,
          satisfied: this.skills.condition(record, entry.condition),
        })),
      },
    };
  }

  install(record: CharacterRecord, goal: CharacterBehaviorRecord['goal'], definition: BehaviorDefinition): void {
    validateBehavior(goal, definition);
    const signatures = this.actionNodes(definition).map((node) => [node.id, nodeSignature(node)] as const);
    const compatible = new Map(signatures);
    for (const execution of record.behaviorTree.skills)
      if (execution.status === 'running' && compatible.get(execution.nodeId) !== execution.signature)
        this.skills.interrupt(record, execution, 'behavior-replaced');
    record.behaviorTree = {
      revision: record.behaviorTree.revision + 1,
      goal: cloneJson(goal),
      definition: cloneJson(definition),
      cycle: record.behaviorTree.cycle,
      activationSequence: record.behaviorTree.activationSequence,
      skills: record.behaviorTree.skills.filter((entry) => compatible.get(entry.nodeId) === entry.signature),
      monitors: [],
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
    record.lastPosition = [...entity.position];
    record.lastBehavior = actor.behavior;
    record.hunger = actor.hunger;
    let session = this.sessions.get(record.entityId);
    if (!session) session = this.rebuild(record);
    session.delta = seconds;
    session.invoked.clear();
    this.observeMonitors(record, session);
    if (session.tree.getState() === State.SUCCEEDED || session.tree.getState() === State.FAILED) {
      record.behaviorTree.cycle += 1;
      record.behaviorTree.skills = record.behaviorTree.skills.filter((entry) => entry.status === 'running');
      session.tree.reset();
    }
    session.tree.step();
    record.dangerSecondsRemaining = Math.max(0, record.dangerSecondsRemaining - seconds);
    if (record.dangerSecondsRemaining === 0) record.lastThreatEntityId = undefined;
    this.options.changed();
  }

  rebuildAfterRestore(record: CharacterRecord): void {
    validateBehavior(record.behaviorTree.goal, record.behaviorTree.definition);
    const valid = new Map(
      this.actionNodes(record.behaviorTree.definition).map((node) => [node.id, nodeSignature(node)]),
    );
    for (const execution of record.behaviorTree.skills) {
      if (valid.get(execution.nodeId) !== execution.signature)
        throw new TypeError('Character behavior ledger references an incompatible node.');
      if (execution.actionId) {
        const action = this.options.action(execution.actionId);
        if (
          !action ||
          action.actorId !== record.entityId ||
          (execution.skill === 'attack-threat' ? action.type !== 'attack' : action.type !== 'move-to')
        )
          throw new TypeError('Character behavior ledger action is missing or owned by another actor.');
      }
    }
    this.sessions.delete(record.entityId);
  }

  private rebuild(record: CharacterRecord): TreeSession {
    const agent: Record<string, unknown> = {};
    for (const node of this.actionNodes(record.behaviorTree.definition)) {
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
      agent[key] = () => this.skills.condition(record, condition);
    });
    const session: TreeSession = {
      tree: new BehaviourTree(this.compile(record.behaviorTree.definition.root) as never, agent, {
        getDeltaTime: () => session.delta,
        random: () => 0.5,
      }),
      delta: 0,
      invoked: new Set(),
      guardValues: new Map(),
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
      (entry) => entry.nodeId === node.id && entry.signature === nodeSignature(node),
    );
    if (!execution) {
      execution = {
        nodeId: node.id,
        skill: node.skill,
        signature: nodeSignature(node),
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
      let monitor = record.behaviorTree.monitors.find((value) => value.nodeId === entry.id);
      const dialogueCursor =
        'name' in entry.condition && entry.condition.name === 'dialogue-received'
          ? ([...record.events].reverse().find((event) => event.type === 'dialogue-heard')?.cursor ?? 0)
          : undefined;
      const matched =
        dialogueCursor === undefined
          ? this.skills.condition(record, entry.condition)
          : dialogueCursor > (monitor?.version ?? dialogueCursor);
      const old = session.guardValues.get(entry.id);
      session.guardValues.set(entry.id, matched);
      if (!monitor) {
        monitor = {
          nodeId: entry.id,
          matched,
          episode: matched ? 1 : 0,
          ...(dialogueCursor === undefined ? {} : { version: dialogueCursor }),
        };
        record.behaviorTree.monitors.push(monitor);
      } else if (matched && (!monitor.matched || dialogueCursor !== undefined)) monitor.episode += 1;
      monitor.matched = matched;
      if (dialogueCursor !== undefined) monitor.version = dialogueCursor;
      if ((old === false && matched) || (dialogueCursor !== undefined && matched)) {
        this.callbacks.record(record, 'rejudge-requested', {
          nodeId: entry.id,
          episode: monitor.episode,
          reason: entry.reason,
        });
      }
    }
  }

  private actionNodes(definition: BehaviorDefinition): Extract<BehaviorNode, { type: 'action' }>[] {
    const result: Extract<BehaviorNode, { type: 'action' }>[] = [];
    const walk = (node: BehaviorNode) => {
      if (node.type === 'action') result.push(node);
      else if (node.type === 'selector' || node.type === 'sequence') node.children.forEach(walk);
    };
    walk(definition.root);
    return result;
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
