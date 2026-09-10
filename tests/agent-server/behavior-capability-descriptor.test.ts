import { describe, expect, it } from 'vitest';

import {
  BEHAVIOR_MAX_ARGUMENT_VALUES,
  BEHAVIOR_MAX_DESCRIPTOR_TEXT_LENGTH,
} from '@seedlands/game-core/runtime/behavior-control-protocol';
import {
  BEHAVIOR_REGISTRY_CAPABILITY,
  defineBehaviorCapabilityModule,
  definePack,
  type BehaviorCapabilityRegistry,
  type BehaviorSkillProviderDefinition,
} from '@seedlands/game-core/mod-api';
import { assembleWorldPacks, OVERWORLD_PRODUCT_PERMISSIONS } from '@seedlands/game-core/server/composition/host-api';
import { pack as overworld } from '../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { validCapabilities } from '../../apps/agent-server/src/node/resident-host-validation';
import { verifiedBehaviorPack } from '../support/behavior-capability-fixtures';

const moduleId = `example:${'m'.repeat(BEHAVIOR_MAX_DESCRIPTOR_TEXT_LENGTH - 'example:'.length)}`;
const exactVersion = `1.0.0-${'v'.repeat(BEHAVIOR_MAX_DESCRIPTOR_TEXT_LENGTH - '1.0.0-'.length)}`;
const maximumValue = 'x'.repeat(BEHAVIOR_MAX_DESCRIPTOR_TEXT_LENGTH);
const values = Object.freeze([
  maximumValue,
  ...Array.from({ length: BEHAVIOR_MAX_ARGUMENT_VALUES - 1 }, () => 'value'),
]);

const skill = (overrides: Partial<BehaviorSkillProviderDefinition> = {}): BehaviorSkillProviderDefinition => ({
  kind: 'skill',
  id: 'example:bounded-descriptor',
  version: exactVersion,
  description: 'Exercises the shared serialized descriptor boundary.',
  arguments: {
    choice: { type: 'string', required: true, values },
    count: { type: 'number', minimum: 0, maximum: 1, integer: true },
  },
  requiredOperations: [],
  state: { version: exactVersion, maximumBytes: 32 },
  start: () => ({ status: 'succeeded', phase: 'done' }),
  continue: () => ({ status: 'failed', reason: 'unexpected' }),
  ...overrides,
});

function catalogFor(
  capability: BehaviorSkillProviderDefinition,
  providerId = moduleId,
  providerVersion = exactVersion,
) {
  const extension = definePack({
    id: 'example:descriptor-pack',
    version: '1.0.0',
    kind: 'extension',
    dependencies: [{ id: 'seedlands:overworld', version: '1.0.0' }],
    modules: [
      defineBehaviorCapabilityModule({
        id: providerId,
        version: providerVersion,
        capabilities: [capability],
      }),
    ],
  });
  const composition = assembleWorldPacks([verifiedBehaviorPack(overworld), verifiedBehaviorPack(extension)], {
    approvedPermissions: {
      'seedlands:overworld': OVERWORLD_PRODUCT_PERMISSIONS,
      'example:descriptor-pack': [],
    },
  });
  return composition.capability<BehaviorCapabilityRegistry>(BEHAVIOR_REGISTRY_CAPABILITY).catalog();
}

describe('shared behavior capability descriptor boundary', () => {
  it('publishes all 160-character and 128-value limits through a real assembly catalog and wire codec', () => {
    const catalog = catalogFor(skill());
    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'example:bounded-descriptor',
          version: exactVersion,
          provider: { moduleId, version: exactVersion },
          arguments: {
            choice: { type: 'string', required: true, values },
            count: { type: 'number', minimum: 0, maximum: 1, integer: true },
          },
          state: { version: exactVersion, maximumBytes: 32 },
        }),
      ]),
    );
    expect(validCapabilities(catalog)).toBe(true);
  });

  it('rejects 161-character descriptor identities and versions in core before they can diverge from wire', () => {
    expect(() => catalogFor(skill(), `${moduleId}x`)).toThrow(/identity|descriptor/i);
    expect(() => catalogFor(skill(), moduleId, `${exactVersion}x`)).toThrow(/identity|descriptor/i);
    expect(() => catalogFor(skill({ version: `${exactVersion}x` }))).toThrow(/version|descriptor/i);
    expect(() => catalogFor(skill({ state: { version: `${exactVersion}x`, maximumBytes: 32 } }))).toThrow(
      /state|descriptor/i,
    );
  });

  it('rejects invalid enum bounds and argument-rule semantics in both core and wire', () => {
    const descriptor = catalogFor(skill()).find(({ id }) => id === 'example:bounded-descriptor')!;
    for (const invalidRule of [
      { type: 'string', values: Array.from({ length: BEHAVIOR_MAX_ARGUMENT_VALUES + 1 }, () => 'value') },
      [`${maximumValue}x`],
      { type: 'string', values: [1] },
      { type: 'string', required: 'yes' },
      { type: 'number', integer: 1 },
      { type: 'number', minimum: 2, maximum: 1 },
      { type: 'boolean', minimum: 0 },
    ]) {
      const rule = Array.isArray(invalidRule) ? { type: 'string', values: invalidRule } : invalidRule;
      const capability = skill({ arguments: { choice: rule as never } });
      expect(() => catalogFor(capability)).toThrow(/argument|descriptor/i);
      expect(
        validCapabilities([
          {
            ...descriptor,
            arguments: { choice: rule },
          },
        ]),
      ).toBe(false);
    }
  });
});
