import { describe, expect, it } from 'vitest';
import { assembleWorldPacks, definePack } from '../../src/server/composition/assembly';
import type { PackDefinition, VerifiedPackArtifact } from '../../src/server/composition/contracts';
import {
  DEATH_INVENTORY_POLICY_CAPABILITY,
  defineDeathInventoryPolicyModuleV1,
  resolveDeathInventoryPolicyCapabilityV1,
  type DeathInventorySettlementPolicyV1,
  type DeathInventoryPolicyDefinitionV1,
} from '../../src/server/composition/mod-api';

const retain: DeathInventorySettlementPolicyV1 = {
  inventory: 'retain',
  cursor: 'retain',
  crafting: 'retain',
  armor: 'retain',
  actor: 'retain',
};
const dropAndDespawn: DeathInventorySettlementPolicyV1 = {
  inventory: 'drop',
  cursor: 'drop',
  crafting: 'drop',
  armor: 'drop',
  actor: 'despawn',
};
const definition = (): DeathInventoryPolicyDefinitionV1 => ({
  version: 1,
  actors: { player: retain, creature: dropAndDespawn, npc: dropAndDespawn },
});
const artifact = (pack: PackDefinition): VerifiedPackArtifact => ({
  ...pack,
  integrity: {
    algorithm: 'sha256',
    manifestDigest: 'a'.repeat(64),
    entryDigest: 'b'.repeat(64),
    resources: [],
  },
});

describe('death inventory policy capability', () => {
  it('strictly validates, detaches and deep-freezes the canonical definition', () => {
    const input = structuredClone(definition());
    const expected = structuredClone(input.actors.player);
    const module = defineDeathInventoryPolicyModuleV1({ moduleId: 'sample:death-policy', definition: input });
    (input.actors.player as { inventory: string }).inventory = 'drop';
    const pack = definePack({ id: 'sample:world', version: '1.0.0', kind: 'playbook', modules: [module] });
    const composition = assembleWorldPacks([artifact(pack)]);
    const capability = resolveDeathInventoryPolicyCapabilityV1(composition)!;
    expect(capability.policyFor('player')).toEqual(expected);
    expect(capability.definition).not.toBe(input);
    expect(Object.isFrozen(capability)).toBe(true);
    expect(Object.isFrozen(capability.definition.actors)).toBe(true);
    expect(Object.isFrozen(capability.policyFor('creature'))).toBe(true);
    expect(() => capability.policyFor('machine' as 'player')).toThrow(/actor policy kind/i);
    expect(module.descriptor).not.toHaveProperty('resources');
    expect(module.descriptor.provides).toEqual([
      {
        id: DEATH_INVENTORY_POLICY_CAPABILITY,
        version: '1.0.0',
        definitionIdentity: JSON.stringify(capability.definition),
      },
    ]);
  });

  it('rejects missing, extra, mistyped and impossible actor policies', () => {
    const valid = definition();
    for (const invalid of [
      { ...valid, extra: true },
      { version: 2, actors: valid.actors },
      { version: 1, actors: { player: retain, creature: dropAndDespawn } },
      { version: 1, actors: { ...valid.actors, machine: retain } },
      { version: 1, actors: { ...valid.actors, npc: { ...retain, inventory: 'erase' } } },
      { version: 1, actors: { ...valid.actors, npc: { ...retain, actor: 'despawn' } } },
    ])
      expect(() =>
        defineDeathInventoryPolicyModuleV1({
          moduleId: 'sample:invalid-death-policy',
          definition: invalid as DeathInventoryPolicyDefinitionV1,
        }),
      ).toThrow(/death inventory/i);
    expect(() =>
      defineDeathInventoryPolicyModuleV1({
        moduleId: 'not-qualified',
        definition: valid,
      }),
    ).toThrow(/module id/i);
    expect(() =>
      defineDeathInventoryPolicyModuleV1({
        moduleId: 'sample:extra',
        definition: valid,
        extra: true,
      } as Parameters<typeof defineDeathInventoryPolicyModuleV1>[0]),
    ).toThrow(/module input/i);
  });

  it('returns null when uncomposed and gives non-Classic alternatives distinct identity', () => {
    const empty = assembleWorldPacks([
      artifact(definePack({ id: 'sample:empty', version: '1.0.0', kind: 'playbook' })),
    ]);
    expect(resolveDeathInventoryPolicyCapabilityV1(empty)).toBeNull();

    const first = defineDeathInventoryPolicyModuleV1({ moduleId: 'sample:first', definition: definition() });
    const alternative = defineDeathInventoryPolicyModuleV1({
      moduleId: 'sample:alternative',
      definition: {
        ...definition(),
        actors: { ...definition().actors, creature: retain },
      },
    });
    expect(first.descriptor.provides![0]!.definitionIdentity).not.toBe(
      alternative.descriptor.provides![0]!.definitionIdentity,
    );
  });

  it('leaves duplicate capability providers fail-closed in existing assembly', () => {
    const first = defineDeathInventoryPolicyModuleV1({ moduleId: 'sample:first', definition: definition() });
    const second = defineDeathInventoryPolicyModuleV1({ moduleId: 'sample:second', definition: definition() });
    const pack = definePack({ id: 'sample:conflict', version: '1.0.0', kind: 'playbook', modules: [first, second] });
    expect(() => assembleWorldPacks([artifact(pack)])).toThrow(/provider replacement.*explicitly selected/i);
  });
});
