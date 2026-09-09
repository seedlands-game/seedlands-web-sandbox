import { describe, expect, it } from 'vitest';
import { assembleOverworldPacks } from '@seedlands/game-core/server/composition/host-api';
import { pack } from '../../../packages/game-core/src/server/gameplay/playbooks/overworld/pack';
import { GameplayRuntime } from '../../../packages/game-core/src/server/gameplay/gameplay-runtime';
import { WorldResourceAuthorizer } from '../../../packages/game-core/src/server/harness/world-authorization';
import { testCorePlatform } from '../../support/core-platform';

function setup() {
  const composition = assembleOverworldPacks([
    {
      ...pack,
      integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
    },
  ]);
  const gameplay = new GameplayRuntime({
    composition,
    platform: testCorePlatform,
    getWorldTime: () => 0,
    getVoxel: ([, y]) => (y === 0 ? 3 : 0),
    prepareVoxelEdit: () => {
      throw new Error('unexpected edit');
    },
  });
  gameplay.spawnPlayer({ id: 'alice', position: [0.5, 1, 0.5] });
  gameplay.spawnPlayer({ id: 'bob', position: [2.5, 1, 0.5] });
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'human', boundEntityId: 'alice' }],
      rules: [
        { effect: 'allow', resources: ['seedlands.mode'], operations: ['read', 'write', 'execute'], scope: 'self' },
        { effect: 'allow', resources: ['seedlands.ruleset'], operations: ['read'], scope: 'any' },
      ],
    },
    composition.resources,
  );
  const binding = gameplay.bindModuleOperations(authorizer, {
    moduleId: 'seedlands:mode-module',
    principalId: 'human',
    originalActorId: 'alice',
  });
  return { composition, gameplay, binding };
}

describe('world Ruleset and actor mode have separate owners', () => {
  it('registers an explicit world Ruleset and mode commits observe its revision without changing it', () => {
    const { composition, gameplay, binding } = setup();
    const ruleset = gameplay.createSnapshot().ruleset;
    expect(ruleset).toEqual({
      version: 1,
      definitionId: 'seedlands:overworld-rules',
      definitionVersion: '1.0.0',
      revision: 0,
    });
    expect(composition.definitionMap.stateCodecs.some((entry) => entry.id === 'seedlands:world-ruleset')).toBe(true);
    let observed: readonly unknown[] = [];
    binding.subscribe((fact) => {
      observed = fact.observed;
    });
    expect(
      binding.invoke({
        operationId: 'seedlands:set-mode',
        target: { kind: 'entity', entityId: 'alice' },
        input: { mode: 'creative' },
      }),
    ).toMatchObject({ ok: true });
    expect(observed).toContainEqual({
      address: { componentId: 'seedlands:world-ruleset', target: { kind: 'world' } },
      revision: 0,
    });
    expect(gameplay.createSnapshot().ruleset).toEqual(ruleset);
    expect(gameplay.getActorModeState('alice')!.mode).toBe('creative');
    expect(gameplay.getActorModeState('bob')!.mode).toBe('survival');
    gameplay.applyDamage('test', 'alice', 3, 'test');
    gameplay.applyDamage('test', 'bob', 3, 'test');
    expect(gameplay.getPlayerState('alice').health).toBe(20);
    expect(gameplay.getPlayerState('bob').health).toBe(17);
  });
  it('rejects missing or incompatible world Ruleset before replacing any live state', () => {
    const { gameplay } = setup();
    const before = gameplay.createSnapshot();
    for (const ruleset of [
      undefined,
      { version: 1 as const, definitionId: 'seedlands:overworld-rules', definitionVersion: '1.0.0', revision: 1 },
    ]) {
      const bad = structuredClone(before);
      bad.ruleset = ruleset;
      expect(() => gameplay.restoreSnapshot(bad)).toThrow(/ruleset/i);
      expect(gameplay.createSnapshot()).toEqual(before);
    }
    gameplay.restoreSnapshot(before);
    expect(gameplay.createSnapshot().ruleset).toEqual(before.ruleset);
  });
});
