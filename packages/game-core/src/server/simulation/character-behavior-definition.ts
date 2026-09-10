import type { CharacterGoal } from '../../runtime/character-control-protocol';
import {
  BEHAVIOR_MAX_BYTES,
  BEHAVIOR_MAX_DEPTH,
  BEHAVIOR_MAX_NODES,
  BEHAVIOR_SCHEMA_VERSION,
  type BehaviorArguments,
  type BehaviorCapability,
  type BehaviorCondition,
  type BehaviorDefinition,
  type BehaviorGoal,
  type BehaviorNode,
} from '../../runtime/behavior-control-protocol';
import { BehaviourTree, State } from 'mistreevous';

const capabilities = [
  { name: 'always', kind: 'condition', description: 'Always true.', arguments: {} },
  { name: 'threat-visible', kind: 'condition', description: 'A current visible threat exists.', arguments: {} },
  {
    name: 'dialogue-received',
    kind: 'condition',
    description: 'A new dialogue fact arrived since this monitor last evaluated.',
    arguments: {},
  },
  {
    name: 'hunger-at-least',
    kind: 'condition',
    description: 'Hunger is at or above value.',
    arguments: { value: { type: 'number', required: true, minimum: 0, maximum: 100 } },
  },
  {
    name: 'hunger-at-most',
    kind: 'condition',
    description: 'Hunger is at or below value.',
    arguments: { value: { type: 'number', required: true, minimum: 0, maximum: 100 } },
  },
  { name: 'is-night', kind: 'condition', description: 'World time is outside 06:00-18:00.', arguments: {} },
  { name: 'is-day', kind: 'condition', description: 'World time is within 06:00-18:00.', arguments: {} },
  {
    name: 'at-position',
    kind: 'condition',
    description: 'Actor is within radius of position.',
    arguments: {
      position: { type: 'position', required: true },
      radius: { type: 'number', minimum: 0.1, maximum: 16 },
    },
  },
  {
    name: 'flee-threat',
    kind: 'skill',
    description: 'Commit to a fixed retreat from the closest visible threat, then finish at that destination.',
    arguments: {
      distance: { type: 'number', minimum: 2, maximum: 24 },
      maxReplans: { type: 'number', minimum: 0, maximum: 64 },
    },
  },
  { name: 'attack-threat', kind: 'skill', description: 'Attack the closest visible threat.', arguments: {} },
  { name: 'ignore-threat', kind: 'skill', description: 'Acknowledge the current threat.', arguments: {} },
  {
    name: 'satisfy-hunger',
    kind: 'skill',
    description:
      'Collect and eat visible food until satisfied. Avoid recently observed threats by default; false permits risk.',
    arguments: {
      satisfiedAt: { type: 'number', minimum: 0, maximum: 100 },
      avoidThreats: { type: 'boolean' },
      maxReplans: { type: 'number', minimum: 0, maximum: 64 },
    },
  },
  {
    name: 'rest-at-home',
    kind: 'skill',
    description:
      'Return home and rest until daylight. With avoidThreats, wait if the route crosses a recently observed threat.',
    arguments: { position: { type: 'position', required: true }, avoidThreats: { type: 'boolean' } },
  },
  {
    name: 'patrol',
    kind: 'skill',
    description: 'Visit configured positions continuously.',
    arguments: {
      positions: { type: 'position', required: true },
      avoidThreats: { type: 'boolean' },
      maxReplans: { type: 'number', minimum: 0, maximum: 64 },
    },
  },
  {
    name: 'wander',
    kind: 'skill',
    description: 'Visit deterministic nearby points continuously.',
    arguments: {
      radius: { type: 'number', minimum: 1, maximum: 16 },
      maxReplans: { type: 'number', minimum: 0, maximum: 64 },
    },
  },
  {
    name: 'move-to',
    kind: 'skill',
    description: 'Walk to a fixed position.',
    arguments: {
      position: { type: 'position', required: true },
      maxReplans: { type: 'number', minimum: 0, maximum: 64 },
    },
  },
  {
    name: 'follow',
    kind: 'skill',
    description: 'Follow a currently authorized entity target reference.',
    arguments: {
      targetRef: { type: 'string', required: true },
      maxReplans: { type: 'number', minimum: 0, maximum: 64 },
    },
  },
  {
    name: 'wait',
    kind: 'skill',
    description: 'Wait for a bounded simulated duration.',
    arguments: { seconds: { type: 'number', required: true, minimum: 0, maximum: 3600 } },
  },
  { name: 'hold', kind: 'skill', description: 'Remain still until interrupted.', arguments: {} },
  {
    name: 'speak',
    kind: 'skill',
    description: 'Emit one bounded speech fact per activation.',
    arguments: { text: { type: 'string', required: true } },
  },
] as const satisfies readonly BehaviorCapability[];

const byName = new Map(capabilities.map((entry) => [`${entry.kind}:${entry.name}`, entry]));
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const id = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/.test(value))
    throw new TypeError(`${label} is invalid.`);
};
const position = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const utf8Bytes = (text: string) => {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
};

export const behaviorActionSignature = (node: Extract<BehaviorNode, { type: 'action' }>): string =>
  JSON.stringify({ skill: node.skill, args: node.args ?? {}, guard: node.guard ?? null });

export function behaviorActionNodes(
  definition: BehaviorDefinition,
): readonly Extract<BehaviorNode, { type: 'action' }>[] {
  const result: Extract<BehaviorNode, { type: 'action' }>[] = [];
  const walk = (node: BehaviorNode) => {
    if (node.type === 'action') result.push(node);
    else if (node.type === 'selector' || node.type === 'sequence') node.children.forEach(walk);
  };
  walk(definition.root);
  return result;
}

const actionCapacitySkills = new Set([
  'flee-threat',
  'attack-threat',
  'satisfy-hunger',
  'rest-at-home',
  'patrol',
  'wander',
  'move-to',
  'follow',
]);

/** True when a valid definition can require a new Authority Action during its lifetime. */
export const behaviorMayStartAction = (definition: BehaviorDefinition): boolean =>
  behaviorActionNodes(definition).some((node) => actionCapacitySkills.has(node.skill));

export function behaviorConditionContainsDialogue(condition: BehaviorCondition): boolean {
  if ('name' in condition) return condition.name === 'dialogue-received';
  if ('not' in condition) return behaviorConditionContainsDialogue(condition.not);
  const entries = 'all' in condition ? condition.all : condition.any;
  return entries.some(behaviorConditionContainsDialogue);
}

export function behaviorConditionConsumers(
  definition: BehaviorDefinition,
): readonly Readonly<{ id: string; condition: BehaviorCondition; monitor: boolean }>[] {
  const result: Readonly<{ id: string; condition: BehaviorCondition; monitor: boolean }>[] = [];
  const walk = (node: BehaviorNode) => {
    if ('guard' in node && node.guard) result.push({ id: `$guard:${node.id}`, condition: node.guard, monitor: false });
    if (node.type === 'condition')
      result.push({ id: `$condition:${node.id}`, condition: node.condition, monitor: false });
    else if (node.type === 'selector' || node.type === 'sequence') node.children.forEach(walk);
  };
  walk(definition.root);
  for (const monitor of definition.monitors ?? [])
    result.push({ id: monitor.id, condition: monitor.condition, monitor: true });
  return result;
}

function validateArgs(capability: BehaviorCapability, raw: unknown): void {
  const args = raw === undefined ? {} : raw;
  if (!object(args)) throw new TypeError(`Behavior ${capability.name} arguments are invalid.`);
  for (const key of Object.keys(args))
    if (!(key in capability.arguments))
      throw new TypeError(`Behavior ${capability.name} argument ${key} is unsupported.`);
  for (const [key, rule] of Object.entries(capability.arguments)) {
    const value = args[key];
    if (value === undefined) {
      if (rule.required) throw new TypeError(`Behavior ${capability.name} argument ${key} is required.`);
      continue;
    }
    const valid =
      rule.type === 'position'
        ? position(value) ||
          (key === 'positions' &&
            Array.isArray(value) &&
            value.length >= 3 &&
            value.length % 3 === 0 &&
            value.every(Number.isFinite))
        : typeof value === rule.type && (rule.type !== 'number' || Number.isFinite(value));
    if (!valid) throw new TypeError(`Behavior ${capability.name} argument ${key} is invalid.`);
    if (
      capability.name === 'speak' &&
      key === 'text' &&
      typeof value === 'string' &&
      (!value.trim() || value.length > 280)
    )
      throw new TypeError('Behavior speech text is invalid.');
    if (
      typeof value === 'number' &&
      ((rule.minimum !== undefined && value < rule.minimum) || (rule.maximum !== undefined && value > rule.maximum))
    )
      throw new TypeError(`Behavior ${capability.name} argument ${key} is out of range.`);
    if (key === 'maxReplans' && !Number.isSafeInteger(value))
      throw new TypeError('Behavior maxReplans must be an integer.');
  }
}

function validateCondition(value: BehaviorCondition, depth: number, count: { value: number }): void {
  if (!object(value) || depth > BEHAVIOR_MAX_DEPTH) throw new TypeError('Behavior condition is invalid or too deep.');
  count.value += 1;
  if ('name' in value) {
    const capability = byName.get(`condition:${value.name}`);
    if (!capability) throw new TypeError(`Behavior condition is not permitted: ${String(value.name)}.`);
    validateArgs(capability, value.args);
    return;
  }
  const entries = 'all' in value ? value.all : 'any' in value ? value.any : 'not' in value ? [value.not] : null;
  if (!entries || !Array.isArray(entries) || entries.length === 0)
    throw new TypeError('Behavior condition expression is invalid.');
  entries.forEach((entry) => validateCondition(entry, depth + 1, count));
}

function validateNode(node: BehaviorNode, depth: number, count: { value: number }, ids: Set<string>): void {
  if (!object(node) || depth > BEHAVIOR_MAX_DEPTH || ++count.value > BEHAVIOR_MAX_NODES)
    throw new TypeError('Behavior tree is invalid or too large.');
  id(node.id, 'Behavior node id');
  if (ids.has(node.id)) throw new TypeError('Behavior node ids must be unique.');
  ids.add(node.id);
  if ('guard' in node && node.guard) validateCondition(node.guard, depth + 1, count);
  if (node.type === 'selector' || node.type === 'sequence') {
    if (!Array.isArray(node.children) || node.children.length === 0)
      throw new TypeError('Behavior composite must have children.');
    node.children.forEach((child) => validateNode(child, depth + 1, count, ids));
  } else if (node.type === 'condition') validateCondition(node.condition, depth + 1, count);
  else if (node.type === 'action') {
    const capability = byName.get(`skill:${node.skill}`);
    if (!capability) throw new TypeError(`Behavior skill is not permitted: ${String(node.skill)}.`);
    validateArgs(capability, node.args);
  } else throw new TypeError('Behavior node type is invalid.');
}

export function validateBehavior(goal: BehaviorGoal, definition: BehaviorDefinition): void {
  if (
    !object(goal) ||
    typeof goal.description !== 'string' ||
    !goal.description.trim() ||
    goal.description.length > 2_000
  )
    throw new TypeError('Behavior goal is invalid.');
  if (
    !object(definition) ||
    definition.version !== BEHAVIOR_SCHEMA_VERSION ||
    utf8Bytes(JSON.stringify({ goal, definition })) > BEHAVIOR_MAX_BYTES
  )
    throw new TypeError('Behavior definition header is invalid or too large.');
  const ids = new Set<string>();
  const count = { value: 0 };
  validateNode(definition.root, 1, count, ids);
  for (const monitor of definition.monitors ?? []) {
    id(monitor.id, 'Behavior monitor id');
    if (
      ids.has(monitor.id) ||
      typeof monitor.reason !== 'string' ||
      !monitor.reason.trim() ||
      monitor.reason.length > 256
    )
      throw new TypeError('Behavior monitor is invalid or duplicated.');
    ids.add(monitor.id);
    validateCondition(monitor.condition, 1, count);
  }
  for (const milestone of goal.milestones ?? []) {
    id(milestone.id, 'Behavior milestone id');
    if (typeof milestone.description !== 'string' || !milestone.description.trim())
      throw new TypeError('Behavior milestone is invalid.');
    validateCondition(milestone.condition, 1, count);
    if (behaviorConditionContainsDialogue(milestone.condition))
      throw new TypeError('Behavior milestone cannot use the edge-triggered dialogue-received condition.');
  }
  if (count.value > BEHAVIOR_MAX_NODES) throw new TypeError('Behavior definition exceeds the node limit.');
  assertMistreevousDefinition(definition);
}

function assertMistreevousDefinition(definition: BehaviorDefinition): void {
  const agent: Record<string, unknown> = {};
  const child = (node: BehaviorNode): Record<string, unknown> => {
    const guard =
      'guard' in node && node.guard
        ? ((agent[`guard_${node.id}`] = () => true), { while: { call: `guard_${node.id}` } })
        : {};
    if (node.type === 'selector' || node.type === 'sequence')
      return { type: node.type, children: node.children.map(child), ...guard };
    if (node.type === 'condition') {
      agent[`condition_${node.id}`] = () => true;
      return { type: 'condition', call: `condition_${node.id}` };
    }
    agent[`action_${node.id}`] = () => State.SUCCEEDED;
    agent[`exit_${node.id}`] = () => undefined;
    return { type: 'action', call: `action_${node.id}`, exit: { call: `exit_${node.id}` }, ...guard };
  };
  new BehaviourTree({ type: 'root', child: child(definition.root) } as never, agent, {
    getDeltaTime: () => 0,
    random: () => 0.5,
  });
}

export const behaviorCapabilities = (): readonly BehaviorCapability[] =>
  capabilities.map((entry) => ({ ...entry, arguments: { ...entry.arguments } }));
export const behaviorArgs = (args?: BehaviorArguments): Record<string, unknown> => ({ ...(args ?? {}) });

export function behaviorDefinitionForLegacyGoal(
  goal: CharacterGoal,
  home: readonly [number, number, number],
  hunger = 60,
): BehaviorDefinition {
  let action: BehaviorNode;
  if (goal.kind === 'idle') action = { id: 'legacy-goal', type: 'action', skill: 'hold' };
  else if (goal.kind === 'forage')
    action = {
      id: 'legacy-goal',
      type: 'action',
      skill: 'satisfy-hunger',
      args: { satisfiedAt: Math.max(0, hunger - 4) },
    };
  else if (goal.kind === 'follow')
    action = { id: 'legacy-goal', type: 'action', skill: 'follow', args: { targetRef: goal.target.ref } };
  else if (goal.kind === 'return-home')
    action = {
      id: 'legacy-goal',
      type: 'action',
      skill: 'move-to',
      args: { position: home },
    };
  else if ('position' in goal)
    action = { id: 'legacy-goal', type: 'action', skill: 'move-to', args: { position: goal.position } };
  else throw new TypeError('Character goal is invalid.');
  return { version: 1, root: action };
}
