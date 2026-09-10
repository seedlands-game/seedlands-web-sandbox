import type { ModModule } from '../../composition/contracts';

export const RULESET_COMPONENT = 'seedlands:world-ruleset';
export const RULESET_RESOURCE = 'seedlands.ruleset';
export type WorldRulesetDefinition = Readonly<{ id: string; version: string }>;
export type WorldRulesetV1 = Readonly<{
  version: 1;
  definitionId: string;
  definitionVersion: string;
  revision: number;
}>;
export const rulesetSnapshot = (definition: WorldRulesetDefinition): WorldRulesetV1 =>
  Object.freeze({ version: 1, definitionId: definition.id, definitionVersion: definition.version, revision: 0 });

/** This version admits immutable world rules; actor modes have their own revisions. */
export function validateWorldRuleset(raw: unknown, definition: WorldRulesetDefinition): WorldRulesetV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('World Ruleset snapshot is invalid.');
  const expected = rulesetSnapshot(definition);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Object.keys(descriptors).length !== Object.keys(expected).length)
    throw new TypeError('World Ruleset fields are invalid.');
  for (const [key, value] of Object.entries(expected))
    if (!descriptors[key] || !('value' in descriptors[key]) || descriptors[key].value !== value)
      throw new TypeError(`World Ruleset identity or revision is incompatible: ${key}.`);
  return expected;
}

export function defineRulesetModule(input: WorldRulesetDefinition): ModModule {
  if (!/^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/.test(input.id) || !/^\d+\.\d+\.\d+$/.test(input.version))
    throw new TypeError('World Ruleset definition is invalid.');
  const definition = Object.freeze({ id: input.id, version: input.version });
  return Object.freeze({
    descriptor: {
      id: 'seedlands:ruleset-module',
      version: '1.0.0',
      provides: [{ id: RULESET_COMPONENT, version: '1.0.0' }],
      resources: [{ id: RULESET_RESOURCE, operations: ['read'] }],
      permissions: [{ resource: RULESET_RESOURCE, operations: ['read'] }],
    },
    register(api) {
      api.provideCapability(RULESET_COMPONENT, definition);
      api.registerState({
        id: RULESET_COMPONENT,
        version: '1.0.0',
        resource: RULESET_RESOURCE,
        validate(value) {
          try {
            validateWorldRuleset(value, definition);
            return true;
          } catch {
            return false;
          }
        },
      });
    },
  } satisfies ModModule);
}
