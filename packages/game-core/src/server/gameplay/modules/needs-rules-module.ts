import type { ModModule } from '../../composition/contracts';
import {
  RULESET_COMPONENT,
  RULESET_RESOURCE,
  validateWorldRuleset,
  type WorldRulesetDefinition,
} from './ruleset-module';
import {
  NEEDS_CAPABILITY,
  NEEDS_PARTITIONS,
  NEEDS_RESOURCE,
  validateNeedsPartition,
  validateNeedsProfiles,
  needsData,
  type NeedsProfiles,
} from './needs-model';
import { needsAddress, needsSeconds } from './needs-module';

export function defineNeedsRulesModule(options: Readonly<{ moduleId: string; profiles: NeedsProfiles }>): ModModule {
  const profiles = validateNeedsProfiles(options.profiles);
  const ownedProfiles = JSON.parse(JSON.stringify(profiles)) as NeedsProfiles;
  return {
    descriptor: {
      id: options.moduleId,
      version: '1.0.0',
      requires: [
        { id: RULESET_COMPONENT, version: '1.0.0' },
        { id: NEEDS_CAPABILITY, version: '1.0.0' },
      ],
      permissions: [
        { resource: NEEDS_RESOURCE, operations: ['read', 'execute'] },
        { resource: RULESET_RESOURCE, operations: ['read'] },
      ],
    },
    register(api) {
      const ruleset = api.requireCapability<WorldRulesetDefinition>(RULESET_COMPONENT);
      api.requireCapability(NEEDS_CAPABILITY);
      api.registerRule({
        id: `${options.moduleId}/before`,
        operationId: 'seedlands:advance-needs',
        stage: 'before',
        apply(_context, input, state) {
          const seconds = needsSeconds(input);
          const current = validateWorldRuleset(
            state.read({ componentId: RULESET_COMPONENT, target: { kind: 'world' } }),
            ruleset,
          );
          return { input: { seconds, ruleset: current, profiles: ownedProfiles } };
        },
      });
      api.registerRule({
        id: `${options.moduleId}/after`,
        operationId: 'seedlands:advance-needs',
        stage: 'after',
        apply(_context, input, state) {
          const policy = needsData(input, ['seconds', 'ruleset', 'profiles']);
          validateWorldRuleset(policy.ruleset, ruleset);
          if (JSON.stringify(policy.profiles) !== JSON.stringify(ownedProfiles))
            return { reject: 'needs-ruleset-policy-changed' };
          for (let partition = 0; partition < NEEDS_PARTITIONS; partition++) {
            const address = needsAddress(partition);
            const before = validateNeedsPartition(state.readOriginal(address));
            const after = validateNeedsPartition(state.read(address));
            if (before.entries.length !== after.entries.length) return { reject: 'needs-membership-changed' };
            for (let index = 0; index < before.entries.length; index++) {
              const previous = before.entries[index],
                current = after.entries[index];
              const profile = ownedProfiles[previous.needs.hungerMeaning];
              if (
                (previous.lifecycle !== 'alive' || !profile.enabledModes.includes(previous.mode.value)) &&
                JSON.stringify(previous) !== JSON.stringify(current)
              )
                return { reject: 'needs-exempt-actor-changed' };
            }
          }
        },
      });
    },
  };
}
