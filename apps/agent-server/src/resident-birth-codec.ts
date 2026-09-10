import type { ResidentBirthPackage } from '@seedlands/cognition-protocol';

const UTF8_MAX_BYTES_PER_CODE_POINT = 4;
const NON_BLANK_PATTERN = '\\S';
const encoder = new TextEncoder();
const RESIDENT_BIRTH_KEYS = Object.freeze(['birthId', 'profile', 'agent', 'soul', 'memory', 'goal', 'definition']);

export const RESIDENT_BIRTH_LIMITS = Object.freeze({
  birthIdCharacters: 160,
  profileNameCharacters: 48,
  profileNameBytes: 192,
  personalityCharacters: 400,
  personalityBytes: 1600,
  backgroundCharacters: 800,
  backgroundBytes: 3200,
  agentSoulBytes: 4 * 1024,
  agentSoulSchemaCharacters: (4 * 1024) / UTF8_MAX_BYTES_PER_CODE_POINT,
  memoryCharacters: 4000,
  memoryBytes: 16 * 1024,
  goalCharacters: 2000,
  goalBytes: 8 * 1024,
  definitionBytes: 32 * 1024,
  packageBytes: 64 * 1024,
});

export type ResidentBirthValidationReason = 'type' | 'blank' | 'utf8-bytes';

export class ResidentBirthValidationError extends TypeError {
  readonly field: string;
  readonly reason: ResidentBirthValidationReason;
  readonly actualBytes?: number;
  readonly maximumBytes?: number;

  constructor(
    field: string,
    reason: ResidentBirthValidationReason,
    byteMetadata?: Readonly<{ actualBytes: number; maximumBytes: number }>,
  ) {
    const bytes = byteMetadata
      ? ` (UTF-8 bytes ${byteMetadata.actualBytes}; maximum ${byteMetadata.maximumBytes})`
      : '';
    super(`Pro birth field ${field} is invalid: ${reason}${bytes}.`);
    this.name = 'ResidentBirthValidationError';
    this.field = field;
    this.reason = reason;
    this.actualBytes = byteMetadata?.actualBytes;
    this.maximumBytes = byteMetadata?.maximumBytes;
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const utf8Bytes = (value: string): number => encoder.encode(value).byteLength;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

function requiredText(value: unknown, field: string, maximumBytes: number): string {
  if (typeof value !== 'string') throw new ResidentBirthValidationError(field, 'type');
  const actualBytes = utf8Bytes(value);
  if (value.trim().length === 0) throw new ResidentBirthValidationError(field, 'blank', { actualBytes, maximumBytes });
  if (actualBytes > maximumBytes)
    throw new ResidentBirthValidationError(field, 'utf8-bytes', { actualBytes, maximumBytes });
  return value;
}

function assertBirthId(value: string): void {
  if (value.length === 0 || value.length > RESIDENT_BIRTH_LIMITS.birthIdCharacters)
    throw new TypeError('Birth request id is invalid.');
}

export function createResidentBirthSchema(definitionGuide: string) {
  const requiredDocument = (maxLength: number, description?: string) => ({
    type: 'string',
    minLength: 1,
    maxLength,
    pattern: NON_BLANK_PATTERN,
    ...(description ? { description } : {}),
  });
  return {
    type: 'object',
    properties: {
      profile: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: RESIDENT_BIRTH_LIMITS.profileNameCharacters },
          personality: {
            type: 'string',
            minLength: 1,
            maxLength: RESIDENT_BIRTH_LIMITS.personalityCharacters,
          },
          background: { type: 'string', maxLength: RESIDENT_BIRTH_LIMITS.backgroundCharacters },
          riskTolerance: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['name', 'personality'],
        additionalProperties: false,
      },
      soul: requiredDocument(RESIDENT_BIRTH_LIMITS.agentSoulSchemaCharacters),
      agent: requiredDocument(RESIDENT_BIRTH_LIMITS.agentSoulSchemaCharacters),
      memory: requiredDocument(
        RESIDENT_BIRTH_LIMITS.memoryCharacters,
        'State honestly that this new resident has no prior experiences; do not invent events or memories.',
      ),
      goal: {
        type: 'object',
        properties: { description: requiredDocument(RESIDENT_BIRTH_LIMITS.goalCharacters) },
        required: ['description'],
      },
      definition: { type: 'object', description: definitionGuide },
    },
    required: ['profile', 'agent', 'soul', 'memory', 'goal', 'definition'],
    additionalProperties: false,
  } as const;
}

/** Parses untrusted structured model output without retaining rejected document contents. */
export function parseResidentBirthPackage(value: unknown, birthId: string): ResidentBirthPackage {
  assertBirthId(birthId);
  if (!object(value) || !object(value.profile) || !object(value.goal) || !object(value.definition))
    throw new TypeError('Pro birth package is invalid.');
  const profile = value.profile;
  requiredText(profile.name, 'profile.name', RESIDENT_BIRTH_LIMITS.profileNameBytes);
  requiredText(profile.personality, 'profile.personality', RESIDENT_BIRTH_LIMITS.personalityBytes);
  if (
    profile.background !== undefined &&
    (typeof profile.background !== 'string' || utf8Bytes(profile.background) > RESIDENT_BIRTH_LIMITS.backgroundBytes)
  )
    throw new TypeError('Pro birth background is invalid.');
  if (
    profile.riskTolerance !== undefined &&
    (typeof profile.riskTolerance !== 'number' || profile.riskTolerance < 0 || profile.riskTolerance > 1)
  )
    throw new TypeError('Pro birth risk tolerance is invalid.');

  const agent = requiredText(value.agent, 'agent', RESIDENT_BIRTH_LIMITS.agentSoulBytes);
  const soul = requiredText(value.soul, 'soul', RESIDENT_BIRTH_LIMITS.agentSoulBytes);
  const memory = requiredText(value.memory, 'memory', RESIDENT_BIRTH_LIMITS.memoryBytes);
  requiredText(value.goal.description, 'goal.description', RESIDENT_BIRTH_LIMITS.goalBytes);
  const definition = value.definition;
  if (
    definition.version !== 1 ||
    !object(definition.root) ||
    utf8Bytes(JSON.stringify(definition)) > RESIDENT_BIRTH_LIMITS.definitionBytes
  )
    throw new TypeError('Pro birth behavior is invalid.');

  const birth = JSON.parse(
    JSON.stringify({
      birthId,
      profile,
      agent,
      soul,
      memory,
      goal: value.goal,
      definition,
    }),
  ) as ResidentBirthPackage;
  const actualBytes = utf8Bytes(JSON.stringify(birth));
  if (actualBytes > RESIDENT_BIRTH_LIMITS.packageBytes)
    throw new ResidentBirthValidationError('package', 'utf8-bytes', {
      actualBytes,
      maximumBytes: RESIDENT_BIRTH_LIMITS.packageBytes,
    });
  return birth;
}

export function isResidentBirthPackage(value: unknown): value is ResidentBirthPackage {
  if (!object(value) || !exactKeys(value, RESIDENT_BIRTH_KEYS) || typeof value.birthId !== 'string') return false;
  try {
    if (utf8Bytes(JSON.stringify(value)) > RESIDENT_BIRTH_LIMITS.packageBytes) return false;
    parseResidentBirthPackage(value, value.birthId);
    return true;
  } catch {
    return false;
  }
}
