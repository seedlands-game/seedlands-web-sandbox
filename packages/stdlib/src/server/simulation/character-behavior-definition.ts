import type { CharacterGoal } from '../../runtime/character-control-protocol';
import {
  BEHAVIOR_MAX_BYTES,
  type BehaviorArguments,
  type BehaviorCapability,
  type BehaviorCondition,
  type BehaviorDefinition,
  type BehaviorGoal,
  type BehaviorNode,
} from '../../runtime/behavior-control-protocol';
import {
  STANDARD_BEHAVIOR_PROVIDER_MODULE_ID,
  type BehaviorCapabilityRegistry,
} from '../composition/behavior-capability-registry';
import type { CharacterRecord, CharacterSkillExecution } from './character-runtime-types';

export type BehaviorTreeSession<Tree> = {
  tree: Tree;
  delta: number;
  invoked: Set<string>;
  conditionValues: Map<string, boolean>;
};

export const behaviorConditionFailure = (error: unknown): string =>
  `condition-provider-failed: ${error instanceof Error ? error.message : 'unknown error'}`.slice(0, 256);

export function behaviorConditionFailureReason(
  record: CharacterRecord,
  consumerId: string,
  error: unknown,
): string | null {
  const reason = behaviorConditionFailure(error);
  return record.events.some(
    (event) => event.type === 'activity-failed' && event.nodeId === consumerId && event.reason === reason,
  )
    ? null
    : reason;
}

export function behaviorMilestoneState(id: string, evaluate: boolean, evaluator: () => boolean) {
  if (!evaluate) return { id, satisfied: false };
  try {
    return { id, satisfied: evaluator() };
  } catch (error) {
    return { id, satisfied: false, failure: behaviorConditionFailure(error) };
  }
}

const utf8Bytes = (text: string): number => {
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
  const walk = (node: BehaviorNode): void => {
    if (node.type === 'action') result.push(node);
    else if (node.type === 'selector' || node.type === 'sequence') node.children.forEach(walk);
  };
  walk(definition.root);
  return result;
}

export const behaviorActionArgs = (definition: BehaviorDefinition, nodeId: string): BehaviorArguments | undefined =>
  behaviorActionNodes(definition).find((node) => node.id === nodeId)?.args;

export const latestBehaviorDialogueCursor = (record: CharacterRecord): number =>
  [...record.events].reverse().find((event) => event.type === 'dialogue-heard')?.cursor ?? 0;

const namedCondition = (condition: BehaviorCondition | undefined, name: string): boolean =>
  Boolean(condition && 'name' in condition && condition.name === name && condition.args === undefined);

/** Recognizes only the pre-v1 canonical life recipe, not arbitrary Pack nodes with matching local ids. */
function isLegacyLifeTree(definition: BehaviorDefinition): boolean {
  const root = definition.root;
  if (root.id !== 'life' || root.type !== 'selector' || root.children.length !== 4 || root.guard) return false;
  const [threat, hunger, night, day] = root.children;
  if (
    threat.type !== 'sequence' ||
    threat.id !== 'threat-response' ||
    threat.children.length !== 2 ||
    !namedCondition(threat.guard, 'threat-visible')
  )
    return false;
  const [check, action] = threat.children;
  const [hungerCheck, hungerAction] = hunger.type === 'sequence' ? hunger.children : [];
  const [nightCheck, nightAction] = night.type === 'sequence' ? night.children : [];
  return (
    check.type === 'condition' &&
    check.id === 'threat-check' &&
    namedCondition(check.condition, 'threat-visible') &&
    action.type === 'action' &&
    action.id === 'threat-action' &&
    action.skill === 'flee-threat' &&
    Object.keys(action.args ?? {}).length === 0 &&
    namedCondition(action.guard, 'threat-visible') &&
    hunger.type === 'sequence' &&
    hunger.id === 'hunger' &&
    hunger.children.length === 2 &&
    hungerCheck?.type === 'condition' &&
    hungerCheck.id === 'hunger-check' &&
    'name' in hungerCheck.condition &&
    hungerCheck.condition.name === 'hunger-at-least' &&
    hungerAction?.type === 'action' &&
    hungerAction.id === 'hunger-action' &&
    hungerAction.skill === 'satisfy-hunger' &&
    night.type === 'sequence' &&
    night.id === 'night-rest' &&
    night.children.length === 2 &&
    nightCheck?.type === 'condition' &&
    nightCheck.id === 'night-check' &&
    namedCondition(nightCheck.condition, 'is-night') &&
    nightAction?.type === 'action' &&
    nightAction.id === 'night-action' &&
    nightAction.skill === 'rest-at-home' &&
    day.type === 'action' &&
    day.id === 'day-patrol' &&
    day.skill === 'patrol' &&
    definition.monitors?.map((entry) => entry.id).join(',') ===
      'danger-monitor,hunger-monitor,night-monitor,dialogue-monitor'
  );
}

/** Keeps the recognized legacy life recipe's already-committed retreat alive across perception loss. */
export const behaviorRetainsLegacyThreatGuard = (
  record: CharacterRecord,
  consumerId: string,
  condition: BehaviorCondition,
): boolean =>
  isLegacyLifeTree(record.behaviorTree.definition) &&
  (consumerId === '$guard:threat-response' || consumerId === '$guard:threat-action') &&
  namedCondition(condition, 'threat-visible') &&
  record.behaviorTree.skills.some(
    (entry) => entry.nodeId === 'threat-action' && entry.skill === 'flee-threat' && entry.status === 'running',
  );

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

/** External capabilities acquire registered operations, not raw Authority Action capacity. */
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
  const walk = (node: BehaviorNode): void => {
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

export function behaviorActionContexts(definition: BehaviorDefinition): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const walk = (node: BehaviorNode, context: readonly unknown[]): void => {
    if (node.type === 'action') {
      result.set(node.id, JSON.stringify(context));
      return;
    }
    if (node.type === 'selector' || node.type === 'sequence')
      node.children.forEach((child, index) =>
        walk(child, [
          ...context,
          { id: node.id, type: node.type, guard: node.guard ?? null, preceding: node.children.slice(0, index) },
        ]),
      );
  };
  walk(definition.root, []);
  return result;
}

export const behaviorMovementSkill = (skill: string): boolean =>
  ['flee-threat', 'satisfy-hunger', 'rest-at-home', 'patrol', 'wander', 'move-to', 'follow'].includes(skill);

export function walkBehaviorConditions(
  node: BehaviorNode,
  add: (key: string, condition: BehaviorCondition) => void,
): void {
  if ('guard' in node && node.guard) add(`guard_${node.id}`, node.guard);
  if (node.type === 'condition') add(`condition_${node.id}`, node.condition);
  else if (node.type === 'selector' || node.type === 'sequence')
    node.children.forEach((child) => walkBehaviorConditions(child, add));
}

const compileBehaviorChild = (node: BehaviorNode): Record<string, unknown> => {
  const guard = 'guard' in node && node.guard ? { while: { call: `guard_${node.id}` } } : {};
  if (node.type === 'selector' || node.type === 'sequence')
    return { type: node.type, children: node.children.map(compileBehaviorChild), ...guard };
  if (node.type === 'condition') return { type: 'condition', call: `condition_${node.id}` };
  return { type: 'action', call: `action_${node.id}`, exit: { call: `exit_${node.id}` }, ...guard };
};

export function compileBehaviorTree(node: BehaviorNode): Record<string, unknown> {
  const guard = 'guard' in node && node.guard ? { while: { call: `guard_${node.id}` } } : {};
  if (node.type === 'selector' || node.type === 'sequence')
    return { type: 'root', child: { type: node.type, children: node.children.map(compileBehaviorChild), ...guard } };
  return { type: 'root', child: compileBehaviorChild(node) };
}

export function validateBehavior(
  goal: BehaviorGoal,
  definition: BehaviorDefinition,
  registry: BehaviorCapabilityRegistry,
): void {
  if (
    !goal ||
    typeof goal !== 'object' ||
    typeof goal.description !== 'string' ||
    !goal.description.trim() ||
    goal.description.length > 2_000 ||
    utf8Bytes(JSON.stringify({ goal, definition })) > BEHAVIOR_MAX_BYTES
  )
    throw new TypeError('Behavior goal is invalid or too large.');
  registry.validateDefinition(definition);
  for (const milestone of goal.milestones ?? []) {
    if (
      typeof milestone.id !== 'string' ||
      !milestone.id.trim() ||
      typeof milestone.description !== 'string' ||
      !milestone.description.trim()
    )
      throw new TypeError('Behavior milestone is invalid.');
    registry.validateDefinition({
      version: definition.version,
      root: { id: milestone.id, type: 'condition', condition: milestone.condition },
    });
    if (behaviorConditionContainsDialogue(milestone.condition))
      throw new TypeError('Behavior milestone cannot use the edge-triggered dialogue-received condition.');
  }
}

export const behaviorCapabilities = (registry: BehaviorCapabilityRegistry): readonly BehaviorCapability[] =>
  registry.catalog();
export const behaviorArgs = (args?: BehaviorArguments): Record<string, unknown> => ({ ...(args ?? {}) });

export function registeredBehaviorCapability(
  registry: BehaviorCapabilityRegistry,
  kind: BehaviorCapability['kind'],
  id: string,
): BehaviorCapability {
  const capability = registry.catalog().find((entry) => entry.kind === kind && entry.id === id);
  if (!capability) throw new TypeError(`Behavior ${kind} is not registered: ${id}`);
  return capability;
}

export function behaviorExecutionProviderCompatible(
  registry: BehaviorCapabilityRegistry,
  execution: CharacterSkillExecution,
): boolean {
  const capability = registeredBehaviorCapability(registry, 'skill', execution.skill);
  return (
    (!execution.providerId || execution.providerId === capability.id) &&
    (!execution.providerVersion || execution.providerVersion === capability.version) &&
    (!execution.providerModuleId || execution.providerModuleId === capability.provider.moduleId) &&
    (!execution.stateVersion || execution.stateVersion === capability.state?.version)
  );
}

export function assertBehaviorExecutionProviderRestorable(
  registry: BehaviorCapabilityRegistry,
  execution: CharacterSkillExecution,
): void {
  if (
    !execution.providerId ||
    !execution.providerModuleId ||
    !execution.providerVersion ||
    !execution.stateVersion ||
    execution.providerState === undefined ||
    !behaviorExecutionProviderCompatible(registry, execution)
  )
    throw new TypeError('Character behavior ledger provider is incompatible.');
  const checkpoint = registry.checkpoint(execution.providerId, execution.providerState);
  if (checkpoint.state.version !== execution.stateVersion)
    throw new TypeError('Character behavior ledger provider state version is incompatible.');
  registry.assertRestorable(checkpoint);
}

export function restoreBehaviorProviderIdentity(
  registry: BehaviorCapabilityRegistry,
  execution: CharacterSkillExecution,
): void {
  const capability = registeredBehaviorCapability(registry, 'skill', execution.skill);
  const complete = [
    execution.providerId,
    execution.providerVersion,
    execution.providerModuleId,
    execution.stateVersion,
  ].every((value) => value !== undefined);
  if (!complete && capability.provider.moduleId !== STANDARD_BEHAVIOR_PROVIDER_MODULE_ID)
    throw new TypeError('Character behavior ledger external provider identity is missing.');
  execution.providerId ??= capability.id;
  execution.providerVersion ??= capability.version;
  execution.providerModuleId ??= capability.provider.moduleId;
  execution.stateVersion ??= capability.state?.version;
  if (!behaviorExecutionProviderCompatible(registry, execution))
    throw new TypeError('Character behavior ledger provider is incompatible.');
  if (execution.status === 'running' && execution.providerState === undefined) execution.providerState = {};
}

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
    action = { id: 'legacy-goal', type: 'action', skill: 'move-to', args: { position: home } };
  else if ('position' in goal)
    action = { id: 'legacy-goal', type: 'action', skill: 'move-to', args: { position: goal.position } };
  else throw new TypeError('Character goal is invalid.');
  return { version: 1, root: action };
}
