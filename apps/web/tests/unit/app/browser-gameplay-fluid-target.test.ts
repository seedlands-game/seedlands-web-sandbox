import { describe, expect, it } from 'vitest';
import type { AuthorityGameplayView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { BrowserGameplay } from '../../../src/app/gameplay/browser-gameplay';
import { createUiBridge } from '../../../src/app/ui/ui-bridge';
import { traceVoxelTarget } from '../../../src/client/presentation/voxel-target';
import { ready } from '../client/fixtures/browser-authority';

const item = (id: string, fluid: 'empty' | 'water' | 'lava' | null) => ({
  id,
  name: id,
  itemType: 'resource' as const,
  stackLimit: 1,
  capabilities: fluid ? [{ type: 'fluid-container' as const, fluid }] : [],
});

it('pointer aim publishes the retained target channel before advance without replacing other UI state', () => {
  const bridge = createUiBridge();
  const session = bridge.beginWorldSession('pointer-target');
  let sequence = 0;
  session.publishInteraction(++sequence, { breaking: { progress: 0.2, label: '石块' } });
  const hudBefore = bridge.hud.get();
  const breakingBefore = bridge.interaction.get().breaking;
  const authority = { gameplay: ready().gameplay };
  const gameplay = Object.assign(Object.create(BrowserGameplay.prototype), {
    options: { authority, session, nextInteractionSequence: () => ++sequence },
    inventoryOpen: false,
  }) as BrowserGameplay;
  const target = traceVoxelTarget([0.5, 1.5, 0.5], [1, 0, 0], (x, y, z) => (x === 2 && y === 1 && z === 0 ? 1 : 0));
  expect(target?.inRange).toBe(true);
  gameplay.setAimTarget(target);
  expect(bridge.interaction.get().target).toMatchObject({ kind: 'voxel', id: '2,1,0', voxel: 1 });
  expect(bridge.interaction.get().breaking).toBe(breakingBefore);
  expect(bridge.hud.get()).toBe(hudBefore);
  authority.gameplay = {
    ...authority.gameplay,
    player: { ...authority.gameplay.player, lifecycle: 'dead' },
  };
  gameplay.setAimTarget(target);
  expect(bridge.interaction.get().target).toBeNull();
  gameplay.setAimTarget(null);
  expect(bridge.interaction.get().target).toBeNull();
  session.dispose();
});

const view = (
  input: Readonly<{
    mode: 'survival' | 'creative';
    survival?: string | null;
    creative?: string | null;
    items?: AuthorityGameplayView['items'];
  }>,
): AuthorityGameplayView => ({
  ...ready().gameplay,
  items: input.items ?? [item('sample:bucket', 'empty'), item('sample:water-bucket', 'water')],
  player: {
    ...ready().gameplay.player,
    mode: { version: 1, value: input.mode, revision: 1 },
    inventory: [input.survival ? { itemId: input.survival, count: 1 } : null],
    selectedSlot: 0,
    creativeCatalog: { version: 1, hotbar: [input.creative ?? null], selectedSlot: 0, revision: 1 },
  },
});

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
