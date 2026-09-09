import type { WorldComposition, WorldDefinitionMap } from './contracts';

export type CompositionCheckpointIdentity = Readonly<{
  version: 1;
  playbookId: string;
  packLock: WorldComposition['packLock'];
  definitionMap: WorldDefinitionMap;
}>;

function canonicalData(input: unknown): string {
  let budget = 1_048_576;
  const active = new Set<object>();
  const visit = (value: unknown, depth: number): string => {
    if (--budget < 0 || depth > 32) throw new TypeError('Composition identity exceeds data limits.');
    if (value === null || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'string') {
      budget -= value.length;
      return JSON.stringify(value);
    }
    if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
    if (typeof value !== 'object' || value === null || active.has(value))
      throw new TypeError('Composition identity must be JSON data.');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value))
      throw new TypeError('Invalid composition identity object.');
    active.add(value);
    const keys = Object.keys(value).sort();
    const entries = keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) throw new TypeError('Composition identity accessors are forbidden.');
      budget -= key.length;
      return [key, descriptor.value] as const;
    });
    let result: string;
    if (Array.isArray(value)) {
      if (keys.length !== value.length) throw new TypeError('Composition identity arrays must be dense.');
      result = `[${value.map((entry) => visit(entry, depth + 1)).join(',')}]`;
    } else
      result = `{${entries
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => `${JSON.stringify(key)}:${visit(entry, depth + 1)}`)
        .join(',')}}`;
    active.delete(value);
    return result;
  };
  const result = visit(input, 0);
  if (budget < 0) throw new TypeError('Composition identity exceeds data limits.');
  return result;
}

export function createCompositionCheckpointGuard(composition: WorldComposition, allowLegacy = false) {
  const identity: CompositionCheckpointIdentity = {
    version: 1,
    playbookId: composition.playbookId,
    packLock: composition.packLock,
    definitionMap: composition.definitionMap,
  };
  const expected = canonicalData(identity);
  return Object.freeze({
    snapshot: (): CompositionCheckpointIdentity => JSON.parse(expected) as CompositionCheckpointIdentity,
    validateGameplay(raw: unknown) {
      if (!raw || typeof raw !== 'object' || !('version' in raw))
        throw new TypeError('Composition gameplay input is invalid.');
      if ([1, 2, 3].includes(raw.version as number)) {
        if (!allowLegacy || composition.playbookId !== 'seedlands:overworld')
          throw new TypeError('Composition does not admit legacy gameplay migration.');
        return;
      }
      if (!('composition' in raw) || canonicalData(raw.composition) !== expected)
        throw new TypeError('Gameplay composition identity is missing or incompatible.');
    },
  });
}
