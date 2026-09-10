import {
  BEHAVIOR_MAX_ARGUMENT_VALUES,
  BEHAVIOR_MAX_CAPABILITIES,
  BEHAVIOR_MAX_CAPABILITY_STATE_BYTES,
  BEHAVIOR_MAX_DESCRIPTOR_TEXT_LENGTH,
  BEHAVIOR_MAX_OPERATION_ID_LENGTH,
  BEHAVIOR_MAX_REQUIRED_OPERATIONS,
  type BehaviorArgumentRule,
  type BehaviorCapability,
  type BehaviorOperationRequirement,
} from './behavior-control-protocol';

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const EXACT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

const object = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= BEHAVIOR_MAX_DESCRIPTOR_TEXT_LENGTH;
const exactVersion = (value: unknown): value is string => boundedText(value) && EXACT_VERSION.test(value);

export type BehaviorArgumentRuleIssue = 'schema' | 'minimum' | 'maximum' | 'bounds' | 'values';

export function behaviorArgumentRuleIssue(value: unknown): BehaviorArgumentRuleIssue | null {
  if (
    !object(value) ||
    !['number', 'string', 'boolean', 'position', 'entity-reference'].includes(String(value.type)) ||
    (value.required !== undefined && typeof value.required !== 'boolean') ||
    (value.integer !== undefined && typeof value.integer !== 'boolean')
  )
    return 'schema';
  if (value.minimum !== undefined && (!Number.isFinite(value.minimum) || value.type === 'boolean')) return 'minimum';
  if (value.maximum !== undefined && (!Number.isFinite(value.maximum) || value.type === 'boolean')) return 'maximum';
  if (value.minimum !== undefined && value.maximum !== undefined && Number(value.minimum) > Number(value.maximum))
    return 'bounds';
  if (
    value.values !== undefined &&
    (value.type !== 'string' ||
      !Array.isArray(value.values) ||
      value.values.length === 0 ||
      value.values.length > BEHAVIOR_MAX_ARGUMENT_VALUES ||
      value.values.some((entry) => !boundedText(entry)))
  )
    return 'values';
  return null;
}

export const isBehaviorArgumentRuleDescriptor = (value: unknown): value is BehaviorArgumentRule =>
  behaviorArgumentRuleIssue(value) === null;

const validRequiredOperations = (value: unknown): value is readonly BehaviorOperationRequirement[] => {
  if (!Array.isArray(value) || value.length > BEHAVIOR_MAX_REQUIRED_OPERATIONS) return false;
  const ids = new Set<string>();
  return value.every((entry) => {
    if (
      !object(entry) ||
      typeof entry.operationId !== 'string' ||
      entry.operationId.length > BEHAVIOR_MAX_OPERATION_ID_LENGTH ||
      !NAMESPACE_ID.test(entry.operationId) ||
      (entry.authorization !== 'self' && entry.authorization !== 'any') ||
      ids.has(entry.operationId)
    )
      return false;
    ids.add(entry.operationId);
    return true;
  });
};

export function isBehaviorCapabilityDescriptor(value: unknown): value is BehaviorCapability {
  if (
    !object(value) ||
    typeof value.id !== 'string' ||
    !IDENTIFIER.test(value.id) ||
    value.name !== value.id ||
    !exactVersion(value.version) ||
    !object(value.provider) ||
    !boundedText(value.provider.moduleId) ||
    !NAMESPACE_ID.test(value.provider.moduleId) ||
    !exactVersion(value.provider.version) ||
    (value.kind !== 'condition' && value.kind !== 'skill') ||
    typeof value.description !== 'string' ||
    !value.description.trim() ||
    value.description.length > 512 ||
    !object(value.arguments) ||
    Object.keys(value.arguments).length > 24 ||
    !Object.entries(value.arguments).every(
      ([name, rule]) => IDENTIFIER.test(name) && isBehaviorArgumentRuleDescriptor(rule),
    ) ||
    !validRequiredOperations(value.requiredOperations)
  )
    return false;
  if (value.kind === 'condition') return value.requiredOperations.length === 0 && value.state === undefined;
  return (
    object(value.state) &&
    exactVersion(value.state.version) &&
    Number.isSafeInteger(value.state.maximumBytes) &&
    Number(value.state.maximumBytes) >= 2 &&
    Number(value.state.maximumBytes) <= BEHAVIOR_MAX_CAPABILITY_STATE_BYTES
  );
}

export function isBehaviorCapabilityCatalog(value: unknown): value is readonly BehaviorCapability[] {
  if (!Array.isArray(value) || value.length > BEHAVIOR_MAX_CAPABILITIES) return false;
  const ids = new Set<string>();
  return value.every((entry) => {
    if (!isBehaviorCapabilityDescriptor(entry) || ids.has(entry.id)) return false;
    ids.add(entry.id);
    return true;
  });
}

export function assertBehaviorCapabilityDescriptor(value: unknown): asserts value is BehaviorCapability {
  if (!isBehaviorCapabilityDescriptor(value)) throw new TypeError('Behavior capability descriptor is invalid.');
}
