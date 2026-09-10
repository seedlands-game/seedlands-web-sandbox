import type {
  BehaviorArgumentRule,
  BehaviorArguments,
  BehaviorCapability,
  BehaviorJson,
} from '../../runtime/behavior-control-protocol';
import { behaviorArgumentRuleIssue } from '../../runtime/behavior-capability-descriptor';

const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 2_048;

export const behaviorObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const behaviorUtf8Bytes = (text: string): number => {
  let total = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    total += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return total;
};

export const behaviorJsonBytes = (value: unknown): number => behaviorUtf8Bytes(JSON.stringify(value));
export const cloneBehaviorValue = <Value>(value: Value): Value => JSON.parse(JSON.stringify(value)) as Value;

const freezeBehaviorValue = (value: unknown): void => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeBehaviorValue(child);
  Object.freeze(value);
};

export const frozenBehaviorValue = <Value>(value: Value): Value => {
  const clone = cloneBehaviorValue(value);
  freezeBehaviorValue(clone);
  return clone;
};

export function assertBehaviorJson(value: unknown, label: string): asserts value is BehaviorJson {
  const seen = new Set<unknown>();
  let nodes = 0;
  const visit = (entry: unknown, depth: number): void => {
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH)
      throw new TypeError(`${label} must contain bounded JSON data.`);
    if (entry === null || typeof entry === 'string' || typeof entry === 'boolean') return;
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new TypeError(`${label} must contain finite JSON numbers.`);
      return;
    }
    if (typeof entry !== 'object' || seen.has(entry)) throw new TypeError(`${label} must contain bounded JSON data.`);
    seen.add(entry);
    if (Array.isArray(entry)) entry.forEach((item) => visit(item, depth + 1));
    else if (behaviorObject(entry))
      for (const [key, item] of Object.entries(entry)) {
        if (!key || item === undefined) throw new TypeError(`${label} must contain bounded JSON data.`);
        visit(item, depth + 1);
      }
    else throw new TypeError(`${label} must contain bounded JSON data.`);
    seen.delete(entry);
  };
  visit(value, 0);
}

export function validateBehaviorArgumentRule(rule: BehaviorArgumentRule, label: string): void {
  const issue = behaviorArgumentRuleIssue(rule);
  if (!issue) return;
  if (issue === 'minimum') throw new TypeError(`${label} minimum is invalid.`);
  if (issue === 'maximum') throw new TypeError(`${label} maximum is invalid.`);
  if (issue === 'bounds') throw new TypeError(`${label} bounds are invalid.`);
  if (issue === 'values') throw new TypeError(`${label} values are invalid.`);
  throw new TypeError(`${label} argument schema is invalid.`);
}

export function validateBehaviorArguments(capability: BehaviorCapability, raw: unknown): BehaviorArguments {
  const args = raw === undefined ? {} : raw;
  if (!behaviorObject(args) || Object.keys(args).length > 24)
    throw new TypeError(`Behavior ${capability.id} arguments are invalid.`);
  for (const key of Object.keys(args))
    if (!(key in capability.arguments))
      throw new TypeError(`Behavior ${capability.id} argument ${key} is unsupported.`);
  for (const [key, rule] of Object.entries(capability.arguments)) {
    const value = args[key];
    if (value === undefined) {
      if (rule.required) throw new TypeError(`Behavior ${capability.id} argument ${key} is required.`);
      continue;
    }
    const isPosition =
      Array.isArray(value) &&
      value.length >= 3 &&
      value.length % 3 === 0 &&
      value.length <= 192 &&
      value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
    const valid =
      rule.type === 'position'
        ? isPosition
        : (rule.type === 'entity-reference' ? typeof value === 'string' : typeof value === rule.type) &&
          (rule.type !== 'number' || Number.isFinite(value)) &&
          (!Array.isArray(rule.values) || (typeof value === 'string' && rule.values.includes(value)));
    if (!valid) throw new TypeError(`Behavior ${capability.id} argument ${key} is invalid.`);
    if (
      typeof value === 'number' &&
      ((rule.minimum !== undefined && value < rule.minimum) ||
        (rule.maximum !== undefined && value > rule.maximum) ||
        (rule.integer === true && !Number.isSafeInteger(value)))
    )
      throw new TypeError(`Behavior ${capability.id} argument ${key} is out of range.`);
    if (
      typeof value === 'string' &&
      (value.length > 2_000 ||
        (rule.minimum !== undefined && value.length < rule.minimum) ||
        (rule.maximum !== undefined && value.length > rule.maximum))
    )
      throw new TypeError(`Behavior ${capability.id} argument ${key} is out of range.`);
  }
  return frozenBehaviorValue(args) as BehaviorArguments;
}
