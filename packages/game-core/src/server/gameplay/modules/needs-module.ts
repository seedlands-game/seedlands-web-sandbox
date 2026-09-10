import type { ModModule, ModuleInvocationValue } from '../../composition/contracts';
import {
  RULESET_COMPONENT,
  RULESET_RESOURCE,
  validateWorldRuleset,
  type WorldRulesetDefinition,
} from './ruleset-module';
import {
  NEEDS_CAPABILITY,
  NEEDS_COMPONENT,
  NEEDS_PARTITIONS,
  NEEDS_RESOURCE,
  advanceNeedsEntry,
  needsData,
  validateNeedsPartition,
  validateNeedsProfiles,
} from './needs-model';

export const needsAddress = (partition: number) => ({
  componentId: NEEDS_COMPONENT,
  target: { kind: 'world' as const },
  partition,
});
export function needsSeconds(value: ModuleInvocationValue | undefined): number {
  const input = needsData(value, ['seconds']);
  if (typeof input.seconds !== 'number' || !Number.isFinite(input.seconds) || input.seconds < 0 || input.seconds > 1)
    throw new TypeError('Needs step must be between 0 and 1 second.');
  return input.seconds;
}

export function defineNeedsModule(): ModModule {
  return {
    descriptor: {
      id: 'seedlands:needs-module',
      version: '1.0.0',
      requires: [{ id: RULESET_COMPONENT, version: '1.0.0' }],
      provides: [{ id: NEEDS_CAPABILITY, version: '1.0.0' }],
      resources: [{ id: NEEDS_RESOURCE, operations: ['read', 'write', 'execute'] }],
      permissions: [
        { resource: NEEDS_RESOURCE, operations: ['read', 'write', 'execute'] },
        { resource: RULESET_RESOURCE, operations: ['read'] },
      ],
    },
    register(api) {
      const ruleset = api.requireCapability<WorldRulesetDefinition>(RULESET_COMPONENT);
      api.provideCapability(
        NEEDS_CAPABILITY,
        Object.freeze({ partitions: NEEDS_PARTITIONS, operationId: 'seedlands:advance-needs' }),
      );
      api.registerState({
        id: NEEDS_COMPONENT,
        version: '1.0.0',
        resource: NEEDS_RESOURCE,
        partitions: NEEDS_PARTITIONS,
        validate(value) {
          try {
            validateNeedsPartition(value);
            return true;
          } catch {
            return false;
          }
        },
      });
      api.registerOperation({
        id: 'seedlands:advance-needs',
        executionKind: 'system',
        resource: NEEDS_RESOURCE,
        run(_context, input, state) {
          const policy = needsData(input, ['seconds', 'ruleset', 'profiles']);
          const seconds = needsSeconds({ seconds: policy.seconds as number });
          const selectedRuleset = validateWorldRuleset(policy.ruleset, ruleset);
          const currentRuleset = validateWorldRuleset(
            state.read({ componentId: RULESET_COMPONENT, target: { kind: 'world' } }),
            ruleset,
          );
          if (JSON.stringify(currentRuleset) !== JSON.stringify(selectedRuleset))
            throw new TypeError('Needs ruleset changed.');
          const profiles = validateNeedsProfiles(policy.profiles);
          let count = 0;
          for (let partition = 0; partition < NEEDS_PARTITIONS; partition++) {
            const address = needsAddress(partition);
            const before = validateNeedsPartition(state.read(address));
            const entries = before.entries.map((entry) =>
              advanceNeedsEntry(entry, profiles[entry.needs.hungerMeaning], seconds),
            );
            state.write(address, { ...before, entries });
            count += entries.length;
          }
          return { actors: count, seconds, rulesetRevision: selectedRuleset.revision };
        },
      });
      api.registerSystem({
        id: 'seedlands:needs-system',
        operationId: 'seedlands:advance-needs',
        cadence: 'every-advance',
      });
    },
  };
}
