import type {
  CharacterGoal,
  CharacterObservation,
  CharacterTargetRef,
} from '@seedlands/stdlib/runtime/character-control-protocol';
import type { DeepSeekTool, DeepSeekToolCall } from './model-types.js';

export const COGNITION_TOOLS: readonly DeepSeekTool[] = [
  {
    type: 'function',
    function: {
      name: 'inspect_visible',
      description: 'Read whitelisted fields from one currently visible entity or point of interest.',
      parameters: {
        type: 'object',
        properties: {
          ref: { type: 'string', minLength: 1, maxLength: 128 },
          fields: {
            type: 'array',
            items: { enum: ['type', 'distance', 'position', 'stack'] },
            minItems: 1,
            maxItems: 4,
            uniqueItems: true,
          },
        },
        required: ['ref', 'fields'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inventory',
      description: 'Read the controlled character own inventory.',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'available_actions',
      description: 'List the bounded goal types available for the current observation.',
      parameters: {
        type: 'object',
        properties: { ref: { type: 'string', minLength: 1, maxLength: 128 } },
        required: [],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_intent',
      description: 'Propose exactly one bounded character goal, optionally with one short in-world utterance.',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            oneOf: [
              {
                type: 'object',
                properties: { kind: { const: 'idle' } },
                required: ['kind'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { kind: { const: 'forage' } },
                required: ['kind'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: { kind: { const: 'return-home' } },
                required: ['kind'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { const: 'follow' },
                  target: {
                    type: 'object',
                    properties: {
                      kind: { const: 'entity' },
                      ref: { type: 'string', minLength: 1, maxLength: 128 },
                      revision: { type: 'integer', minimum: 0 },
                    },
                    required: ['kind', 'ref', 'revision'],
                    additionalProperties: false,
                  },
                },
                required: ['kind', 'target'],
                additionalProperties: false,
              },
              {
                type: 'object',
                properties: {
                  kind: { const: 'move-to' },
                  position: {
                    type: 'array',
                    items: { type: 'number', minimum: -30000000, maximum: 30000000 },
                    minItems: 3,
                    maxItems: 3,
                  },
                },
                required: ['kind', 'position'],
                additionalProperties: false,
              },
            ],
          },
          say: { type: 'string', minLength: 1, maxLength: 280 },
        },
        required: ['goal'],
        additionalProperties: false,
      },
    },
  },
];

export type IntentProposal = Readonly<{ goal: CharacterGoal; say?: string }>;
export type ValidatedToolCall =
  | Readonly<{ kind: 'read'; call: DeepSeekToolCall; result: string }>
  | Readonly<{ kind: 'intent'; call: DeepSeekToolCall; proposal: IntentProposal }>;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function exactKeys(source: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(source).every((key) => allowed.includes(key));
}

function targetByRef(observation: CharacterObservation, ref: string) {
  return (
    observation.visibleEntities.find((entry) => entry.target.ref === ref) ??
    observation.visiblePois.find((entry) => entry.target.ref === ref)
  );
}

function finitePosition(value: unknown): readonly [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!value.every((entry) => typeof entry === 'number' && Number.isFinite(entry) && Math.abs(entry) <= 30_000_000))
    return null;
  return [value[0] as number, value[1] as number, value[2] as number];
}

function targetRef(value: unknown, observation: CharacterObservation): CharacterTargetRef | null {
  const source = record(value);
  if (!source || !exactKeys(source, ['kind', 'ref', 'revision'])) return null;
  if (
    source.kind !== 'entity' ||
    typeof source.ref !== 'string' ||
    !source.ref ||
    source.ref.length > 128 ||
    !Number.isSafeInteger(source.revision) ||
    (source.revision as number) < 0
  )
    return null;
  const visible = observation.visibleEntities.find((entry) => entry.target.ref === source.ref);
  if (!visible || visible.target.kind !== 'entity' || visible.target.revision !== source.revision) return null;
  return { kind: 'entity', ref: source.ref, revision: source.revision as number };
}

function goal(value: unknown, observation: CharacterObservation): CharacterGoal | null {
  const source = record(value);
  if (!source || typeof source.kind !== 'string') return null;
  if (source.kind === 'idle' || source.kind === 'forage' || source.kind === 'return-home')
    return exactKeys(source, ['kind']) ? { kind: source.kind } : null;
  if (source.kind === 'follow' && exactKeys(source, ['kind', 'target'])) {
    const target = targetRef(source.target, observation);
    return target ? { kind: 'follow', target } : null;
  }
  if (source.kind === 'move-to' && exactKeys(source, ['kind', 'position'])) {
    const position = finitePosition(source.position);
    return position ? { kind: 'move-to', position } : null;
  }
  return null;
}

function parseArguments(call: DeepSeekToolCall): Record<string, unknown> {
  const parsed = JSON.parse(call.function.arguments) as unknown;
  const source = record(parsed);
  if (!source) throw new Error('tool arguments must be an object');
  return source;
}

function readResult(call: DeepSeekToolCall, args: Record<string, unknown>, observation: CharacterObservation): string {
  if (call.function.name === 'inventory') {
    if (!exactKeys(args, [])) throw new Error('inventory does not accept arguments');
    return JSON.stringify({ inventory: observation.character.inventory });
  }
  if (call.function.name === 'available_actions') {
    if (!exactKeys(args, ['ref']) || (args.ref !== undefined && typeof args.ref !== 'string'))
      throw new Error('invalid available_actions arguments');
    const target = typeof args.ref === 'string' ? targetByRef(observation, args.ref) : undefined;
    if (typeof args.ref === 'string' && !target) throw new Error('target is not visible');
    return JSON.stringify({
      goals: ['idle', 'forage', 'return-home', ...(target?.target.kind === 'poi' ? [] : ['follow']), 'move-to'],
    });
  }
  if (call.function.name !== 'inspect_visible') throw new Error('unknown read tool');
  if (!exactKeys(args, ['ref', 'fields']) || typeof args.ref !== 'string' || !Array.isArray(args.fields))
    throw new Error('invalid inspect_visible arguments');
  const allowed = new Set(['type', 'distance', 'position', 'stack']);
  if (
    !args.ref ||
    args.ref.length > 128 ||
    args.fields.length < 1 ||
    args.fields.length > 4 ||
    !args.fields.every((field) => typeof field === 'string' && allowed.has(field)) ||
    new Set(args.fields).size !== args.fields.length
  )
    throw new Error('invalid inspect_visible fields');
  const visible = targetByRef(observation, args.ref);
  if (!visible) throw new Error('target is not visible');
  const result: Record<string, unknown> = { target: visible.target };
  for (const field of args.fields as string[]) {
    if (field in visible) result[field] = visible[field as keyof typeof visible];
  }
  return JSON.stringify(result);
}

export function validateToolCall(call: DeepSeekToolCall, observation: CharacterObservation): ValidatedToolCall {
  const args = parseArguments(call);
  if (call.function.name !== 'propose_intent')
    return { kind: 'read', call, result: readResult(call, args, observation) };
  if (!exactKeys(args, ['goal', 'say'])) throw new Error('unexpected propose_intent argument');
  const candidate = goal(args.goal, observation);
  if (!candidate) throw new Error('invalid or unauthorized goal');
  if (args.say !== undefined && (typeof args.say !== 'string' || !args.say.trim() || args.say.length > 280))
    throw new Error('invalid say text');
  return {
    kind: 'intent',
    call,
    proposal: { goal: candidate, ...(typeof args.say === 'string' ? { say: args.say } : {}) },
  };
}
