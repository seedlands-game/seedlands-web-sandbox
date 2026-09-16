import { describe, expect, it } from 'vitest';
import { CombatRuntime } from '../../../fixtures/classic/content';

const host = () => {
  let available = true;
  let damage = 0;
  const runtime = new CombatRuntime(
    {
      actorAvailable: () => true,
      targetAvailable: () => available,
      validateHit: () => null,
      applyDamage: (_a, _t, amount) => {
        damage += amount;
        return amount;
      },
    },
    undefined,
    {
      referenceFor: (id) => (available || id === 'a' ? { entityId: id, lifetime: 1, epoch: 1 } : null),
      resolve: (ref) => (available || ref.entityId === 'a' ? ref.entityId : null),
      rebind: (ref) => (available || ref.entityId === 'a' ? ref : null),
    },
  );
  return {
    runtime,
    damage: () => damage,
    remove: () => {
      available = false;
    },
  };
};

describe('combat result sequence exhaustion', () => {
  it('rejects restoration cancellation overflow before replacing current state', () => {
    const world = host();
    world.runtime.request('a', 't', 'wood-sword');
    const exhausted = { ...world.runtime.snapshot(), resultSequence: Number.MAX_SAFE_INTEGER };
    world.remove();
    const before = world.runtime.snapshot();
    expect(() => world.runtime.restore(exhausted)).toThrow(/exhaust/i);
    expect(world.runtime.snapshot()).toEqual(before);
  });
  it('rejects advance and explicit cancellation before any phase, damage or event change', () => {
    const world = host();
    world.runtime.request('a', 't', 'wood-sword');
    world.runtime.restore({ ...world.runtime.snapshot(), resultSequence: Number.MAX_SAFE_INTEGER });
    const before = world.runtime.snapshot();
    expect(() => world.runtime.advance(1)).toThrow(/exhaust/i);
    expect(world.runtime.snapshot()).toEqual(before);
    expect(world.damage()).toBe(0);
    expect(() => world.runtime.cancelActor('a', 'test')).toThrow(/exhaust/i);
    expect(world.runtime.snapshot()).toEqual(before);
  });
});
