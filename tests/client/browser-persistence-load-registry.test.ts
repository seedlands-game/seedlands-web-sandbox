import { describe, expect, it } from 'vitest';
import { BrowserPersistenceLoadRegistry } from '../../src/client/persistence/browser-persistence-load-registry';

describe('BrowserPersistenceLoadRegistry', () => {
  it('releases only the addressed neighborhood generation and preserves overlapping owners', () => {
    const registry = new BrowserPersistenceLoadRegistry();
    const first = registry.beginNeighborhood('center-a', ['shared', 'a-only']);
    const overlap = registry.beginNeighborhood('center-b', ['shared', 'b-only']);
    const shared = registry.beginLoad('shared');
    const aOnly = registry.beginLoad('a-only');

    expect(registry.releaseNeighborhood('center-a', first)).toEqual(['a-only']);
    expect(registry.shouldPublish('shared', shared)).toBe(true);
    expect(registry.shouldPublish('a-only', aOnly)).toBe(false);

    const successor = registry.beginNeighborhood('center-a', ['shared', 'a-only']);
    expect(registry.releaseNeighborhood('center-a', first)).toEqual([]);
    expect(registry.isNeighborhoodCurrent(successor)).toBe(true);
    expect(registry.releaseNeighborhood('center-b', overlap)).toEqual(['b-only']);
  });

  it('keeps an exact claim across neighborhood release and fences only older loads', () => {
    const registry = new BrowserPersistenceLoadRegistry();
    const lease = registry.beginNeighborhood('center', ['exact']);
    const oldLoad = registry.beginLoad('exact');
    registry.claimExact('exact');
    const fence = registry.captureSaveFence();

    expect(registry.releaseNeighborhood('center', lease)).toEqual([]);
    expect(registry.shouldPublish('exact', oldLoad)).toBe(true);
    expect(registry.applySaveFence(['exact'], fence)).toEqual(['exact']);
    const laterLoad = registry.beginLoad('exact');
    expect(laterLoad.generation).toBeGreaterThan(fence);
    expect(registry.applySaveFence(['exact'], fence)).toEqual([]);
    expect(registry.shouldPublish('exact', laterLoad)).toBe(true);
  });
});
