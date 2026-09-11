import { BEHAVIOR_PROVIDER_CALLBACK_INVOKE_BUDGET } from '../composition/behavior-capability-dispatch';
import type { CharacterRecord } from './character-runtime-types';

const MAX_PROVIDER_CALLBACKS_PER_ACTION_STEP = 2;

type BehaviorDefinition = CharacterRecord['behaviorTree']['definition'];
type BehaviorNodeCounts = Readonly<{ nodes: number; actions: number }>;

function behaviorNodeCounts(node: BehaviorDefinition['root']): BehaviorNodeCounts {
  if (node.type !== 'selector' && node.type !== 'sequence')
    return { nodes: 1, actions: Number(node.type === 'action') };
  return node.children.reduce<BehaviorNodeCounts>(
    (total, child) => {
      const childCounts = behaviorNodeCounts(child);
      return { nodes: total.nodes + childCounts.nodes, actions: total.actions + childCounts.actions };
    },
    { nodes: 1, actions: 0 },
  );
}

function behaviorDirectCommits(definition: BehaviorDefinition, stepCount: number): number {
  const { nodes } = behaviorNodeCounts(definition.root);
  const monitors = definition.monitors?.length ?? 0;
  return stepCount * (nodes + monitors * 2 + 1);
}

function behaviorCallbackCount(definition: BehaviorDefinition, stepCount: number): number {
  return behaviorNodeCounts(definition.root).actions * stepCount * MAX_PROVIDER_CALLBACKS_PER_ACTION_STEP;
}

export function characterBehaviorCommitUpperBound(definition: BehaviorDefinition, stepCount: number): number {
  const callbacks = behaviorCallbackCount(definition, stepCount);
  return behaviorDirectCommits(definition, stepCount) + callbacks * BEHAVIOR_PROVIDER_CALLBACK_INVOKE_BUDGET * 2;
}

export function characterAdvanceCommitUpperBound(
  records: Iterable<CharacterRecord>,
  stepCount: number,
  externalOperationCount = 0,
): number {
  if (!Number.isSafeInteger(stepCount) || stepCount < 0)
    throw new RangeError('Character advance step count is invalid.');
  if (!Number.isSafeInteger(externalOperationCount) || externalOperationCount < 0)
    throw new RangeError('Registered operation count is invalid.');
  const active = [...records].filter(({ lifecycle }) => lifecycle === 'active');
  const runningSkills = active.reduce(
    (total, record) => total + record.behaviorTree.skills.filter(({ status }) => status === 'running').length,
    0,
  );
  const stepCallbacks = active.reduce(
    (total, record) => total + behaviorCallbackCount(record.behaviorTree.definition, stepCount),
    0,
  );
  const directCommits = active.reduce(
    (total, record) => total + behaviorDirectCommits(record.behaviorTree.definition, stepCount),
    0,
  );
  const providerOperations = (stepCallbacks + runningSkills) * BEHAVIOR_PROVIDER_CALLBACK_INVOKE_BUDGET;
  const operationCommits = (externalOperationCount + providerOperations) * 2;
  const lifecycleCommits = active.length * 2 + stepCallbacks + runningSkills;
  return directCommits + operationCommits + lifecycleCommits;
}
