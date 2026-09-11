import type { WorldComposition } from '../../composition/contracts';
import type { ModStateAddress, RegisteredStatePort } from '../../composition/operation-contracts';
import {
  RULESET_COMPONENT,
  rulesetSnapshot,
  validateWorldRuleset,
  type WorldRulesetDefinition,
} from './ruleset-module';

export function createWorldRulesetState(composition: WorldComposition | undefined) {
  const present = composition?.definitionMap.capabilities.some((entry) => entry.id === RULESET_COMPONENT);
  const definition = present ? composition!.capability<WorldRulesetDefinition>(RULESET_COMPONENT) : null;
  const snapshot = () => (definition ? rulesetSnapshot(definition) : undefined);
  const read = (address: ModStateAddress) => {
    if (!definition || address.componentId !== RULESET_COMPONENT || address.target.kind !== 'world')
      throw new TypeError('World Ruleset address is unavailable.');
    return { revision: 0, value: rulesetSnapshot(definition) };
  };
  const port: RegisteredStatePort = Object.freeze({
    read,
    commit(observed, writes) {
      if (writes.length) return { ok: false, reason: 'world-ruleset-immutable' };
      if (observed.some((entry) => read(entry.address).revision !== entry.revision))
        return { ok: false, reason: 'world-ruleset-stale' };
      return { ok: true, revision: 0 };
    },
  });
  return Object.freeze({
    port,
    snapshot,
    validateGameplay(raw: unknown) {
      if (!raw || typeof raw !== 'object' || !('version' in raw))
        throw new TypeError('World Ruleset gameplay input is invalid.');
      if (raw.version === 1 || raw.version === 2 || raw.version === 3) return;
      const saved = 'ruleset' in raw ? raw.ruleset : undefined;
      if (definition) validateWorldRuleset(saved, definition);
      else if (saved !== undefined) throw new TypeError('World Ruleset requires its registered provider.');
    },
  });
}
