import { describe, expect, it } from 'vitest';
import type { AuthorityGameplayView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { BrowserGameplay } from '../../../src/app/gameplay/browser-gameplay';

const item = (id: string, fluid: 'empty' | 'water' | 'lava' | null) => ({
  id,
  name: id,
  itemType: 'resource' as const,
  stackLimit: 1,
  capabilities: fluid ? [{ type: 'fluid-container' as const, fluid }] : [],
});

const view = (
  input: Readonly<{
    mode: 'survival' | 'creative';
    survival?: string | null;
    creative?: string | null;
    items?: AuthorityGameplayView['items'];
  }>,
): AuthorityGameplayView =>
  ({
    items: input.items ?? [item('sample:bucket', 'empty'), item('sample:water-bucket', 'water')],
    player: {
      mode: { version: 1, value: input.mode, revision: 1 },
      inventory: [input.survival ? { itemId: input.survival, count: 1 } : null],
      selectedSlot: 0,
      creativeCatalog: { version: 1, hotbar: [input.creative ?? null], selectedSlot: 0, revision: 1 },
    },
  }) as AuthorityGameplayView;

describe('BrowserGameplay fluid source target selection', () => {
  it('reads the current survival and creative selection without caching an old view', () => {
    let current = view({ mode: 'survival', survival: 'sample:bucket' });
    const gameplay = Object.create(BrowserGameplay.prototype) as BrowserGameplay;
    Object.defineProperty(gameplay, 'options', {
      value: {
        authority: {
          get gameplay() {
            return current;
          },
        },
      },
    });

    expect(gameplay.canTargetFluidSource()).toBe(true);
    current = view({ mode: 'survival', survival: 'sample:water-bucket' });
    expect(gameplay.canTargetFluidSource()).toBe(false);
    current = view({ mode: 'creative', creative: 'sample:bucket' });
    expect(gameplay.canTargetFluidSource()).toBe(true);
    current = view({ mode: 'creative', creative: 'sample:water-bucket' });
    expect(gameplay.canTargetFluidSource()).toBe(false);
  });

  it('fails closed when the current world item projection removes or changes the capability', () => {
    let current = view({ mode: 'survival', survival: 'sample:bucket' });
    const gameplay = Object.create(BrowserGameplay.prototype) as BrowserGameplay;
    Object.defineProperty(gameplay, 'options', {
      value: {
        authority: {
          get gameplay() {
            return current;
          },
        },
      },
    });

    expect(gameplay.canTargetFluidSource()).toBe(true);
    current = view({ mode: 'survival', survival: 'sample:bucket', items: [item('sample:bucket', null)] });
    expect(gameplay.canTargetFluidSource()).toBe(false);
    current = view({ mode: 'survival', survival: 'sample:bucket', items: [] });
    expect(gameplay.canTargetFluidSource()).toBe(false);
  });
});
