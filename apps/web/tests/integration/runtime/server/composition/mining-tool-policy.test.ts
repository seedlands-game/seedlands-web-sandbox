import { describe, expect, it } from 'vitest';
import {
  createItemDefinitionRegistry,
  type ItemDefinitionInput,
} from '../../../../../../../packages/stdlib/src/server/gameplay/item-registry';
import { createMiningToolUseCandidate } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/mining-tool-policy';

const durableMiningTool = (overrides: Partial<ItemDefinitionInput> = {}): ItemDefinitionInput => ({
  id: 'mod:copper-drill',
  name: 'An Unfamiliar Custom Tool',
  itemType: 'tool',
  stackLimit: 1,
  durability: { max: 8 },
  capabilities: [{ type: 'mine', tool: 'pickaxe', multiplier: 2.5, tier: 2 }],
  ...overrides,
});

const items = () =>
  createItemDefinitionRegistry([
    durableMiningTool(),
    durableMiningTool({
      id: 'mod:wooden-hatchet',
      name: 'Looks Nothing Like An Axe',
      durability: { max: 3 },
      capabilities: [{ type: 'mine', tool: 'axe', multiplier: 3 }],
    }),
    durableMiningTool({
      id: 'mod:utility-tool',
      name: 'Utility Tool',
      durability: { max: 5 },
      capabilities: [],
    }),
    {
      id: 'mod:ore',
      name: 'Ore',
      itemType: 'resource',
      stackLimit: 64,
      capabilities: [],
    },
  ]);

describe('mining capability definition', () => {
  it('keeps the existing multiplier floor and accepts legacy omitted tier as tier zero', () => {
    const registry = createItemDefinitionRegistry([
      durableMiningTool({
        capabilities: [{ type: 'mine', tool: 'axe', multiplier: 1.5 }],
      }),
    ]);

    expect(registry.capability('mod:copper-drill', 'mine')).toEqual({
      type: 'mine',
      tool: 'axe',
      multiplier: 1.5,
    });
  });

  it.each([
    { type: 'mine', tool: 'hammer', multiplier: 2, tier: 0 },
    { type: 'mine', tool: 'pickaxe', multiplier: 0, tier: 0 },
    { type: 'mine', tool: 'pickaxe', multiplier: 1, tier: 0 },
    { type: 'mine', tool: 'pickaxe', multiplier: Number.NaN, tier: 0 },
    { type: 'mine', tool: 'pickaxe', multiplier: 2, tier: -1 },
    { type: 'mine', tool: 'pickaxe', multiplier: 2, tier: 1.5 },
    { type: 'mine', tool: 'pickaxe', multiplier: 2, tier: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects a malformed mining capability: %j', (capability) => {
    expect(() => createItemDefinitionRegistry([durableMiningTool({ capabilities: [capability as never] })])).toThrow(
      /mine capability/i,
    );
  });
});

describe('createMiningToolUseCandidate', () => {
  it('uses a registered custom capability and returns one detached durability step', () => {
    const registry = items();
    const selected = {
      itemId: 'mod:copper-drill',
      count: 1,
      instance: { durability: 6 },
    };

    const candidate = createMiningToolUseCandidate(registry, selected, {
      preferredTool: 'pickaxe',
      minimumTier: 2,
    });

    expect(candidate).toEqual({
      multiplier: 2.5,
      nextStack: {
        itemId: 'mod:copper-drill',
        count: 1,
        instance: { durability: 5 },
      },
    });
    expect(candidate.nextStack).not.toBe(selected);
    expect(candidate.nextStack?.instance).not.toBe(selected.instance);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.nextStack)).toBe(true);
    expect(Object.isFrozen(candidate.nextStack?.instance)).toBe(true);
    expect(selected).toEqual({
      itemId: 'mod:copper-drill',
      count: 1,
      instance: { durability: 6 },
    });
  });

  it('applies speed only to a matching preferred tool but wears any mining tool on success', () => {
    const selected = {
      itemId: 'mod:wooden-hatchet',
      count: 1,
      instance: { durability: 3 },
    };

    expect(
      createMiningToolUseCandidate(items(), selected, {
        preferredTool: 'pickaxe',
        minimumTier: 0,
      }),
    ).toEqual({
      multiplier: 1,
      nextStack: {
        itemId: 'mod:wooden-hatchet',
        count: 1,
        instance: { durability: 2 },
      },
    });
    expect(selected.instance.durability).toBe(3);
  });

  it('treats omitted tier as zero and enforces positive minimum tier without wear on failure', () => {
    const registry = items();
    const selected = {
      itemId: 'mod:wooden-hatchet',
      count: 1,
      instance: { durability: 2 },
    };

    expect(
      createMiningToolUseCandidate(registry, selected, {
        preferredTool: 'axe',
        minimumTier: 0,
      }),
    ).toMatchObject({ multiplier: 3, nextStack: { instance: { durability: 1 } } });
    expect(() =>
      createMiningToolUseCandidate(registry, selected, {
        preferredTool: 'axe',
        minimumTier: 1,
      }),
    ).toThrow(/mining-tool-requirement-not-met/);
    expect(selected.instance.durability).toBe(2);
  });

  it.each([
    { preferredTool: 'axe' as const, minimumTier: 2 },
    { preferredTool: 'pickaxe' as const, minimumTier: 3 },
  ])('rejects a mismatched or under-tier tool without mutating it: %j', (requirement) => {
    const selected = {
      itemId: 'mod:copper-drill',
      count: 1,
      instance: { durability: 4 },
    };

    expect(() => createMiningToolUseCandidate(items(), selected, requirement)).toThrow(
      /mining-tool-requirement-not-met/,
    );
    expect(selected.instance.durability).toBe(4);
  });

  it('returns null after the last durability and leaves non-mining selections and bare hand unchanged', () => {
    const registry = items();
    expect(
      createMiningToolUseCandidate(
        registry,
        { itemId: 'mod:copper-drill', count: 1, instance: { durability: 1 } },
        { preferredTool: 'pickaxe', minimumTier: 1 },
      ),
    ).toEqual({ multiplier: 2.5, nextStack: null });

    const utility = {
      itemId: 'mod:utility-tool',
      count: 1,
      instance: { durability: 4 },
    };
    const utilityCandidate = createMiningToolUseCandidate(registry, utility, {
      preferredTool: null,
      minimumTier: 0,
    });
    expect(utilityCandidate).toEqual({ multiplier: 1, nextStack: utility });
    expect(utilityCandidate.nextStack).not.toBe(utility);
    expect(utilityCandidate.nextStack?.instance).not.toBe(utility.instance);
    expect(utility.instance.durability).toBe(4);

    expect(
      createMiningToolUseCandidate(registry, null, {
        preferredTool: null,
        minimumTier: 0,
      }),
    ).toEqual({ multiplier: 1, nextStack: null });
  });

  it('validates selected stacks through the supplied registry', () => {
    expect(() =>
      createMiningToolUseCandidate(
        items(),
        { itemId: 'mod:missing', count: 1 },
        { preferredTool: null, minimumTier: 0 },
      ),
    ).toThrow(/unknown item/i);
  });

  it.each([
    { preferredTool: null, minimumTier: 1 },
    { preferredTool: 'hammer', minimumTier: 0 },
    { preferredTool: 'axe', minimumTier: -1 },
    { preferredTool: 'axe', minimumTier: 1.5 },
    { preferredTool: 'axe', minimumTier: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects malformed mining requirements: %j', (requirement) => {
    expect(() => createMiningToolUseCandidate(items(), null, requirement as never)).toThrow(/mining tool requirement/i);
  });
});
