import { describe, expect, it, vi } from 'vitest';
import type { MediaPlaybackFactV1, MediaPlaybackProjectionV1 } from '@seedlands/stdlib/mod-api';
import { BrowserMediaFrontier } from '../../../src/client/authority/browser-media-frontier';

const device = (x: number) => ({ kind: 'voxel' as const, position: [x, 2, 3] as const, definitionId: 'sample:device' });
const resource = { packId: 'sample:pack', path: 'assets/audio/track.mp3' } as const;
const projection = (x: number, revision: number): MediaPlaybackProjectionV1 => ({
  version: 1,
  device: device(x),
  revision,
  slot: { itemId: 'sample:disc', trackId: 'sample:track' },
  resource,
  playing: true,
  resumePending: false,
});
const fact = (x: number, revision: number): MediaPlaybackFactV1 => ({
  version: 1,
  kind: 'activate',
  device: device(x),
  revision,
  previousTrackId: 'sample:track',
  trackId: 'sample:track',
  resource,
  playing: true,
  resumePending: false,
});
const batch = (facts: readonly MediaPlaybackFactV1[], epoch = 'world:1') => ({
  version: 1 as const,
  worldEpoch: epoch,
  worldRevision: 0,
  gameplayRevision: 3,
  facts,
});

describe('BrowserMediaFrontier', () => {
  it('keeps projection and fact cursors separate for the same instance revision', () => {
    const projections = vi.fn();
    const facts = vi.fn();
    const frontier = new BrowserMediaFrontier('world:1', projections, facts);

    frontier.replaceEpoch('world:1', [projection(1, 4)]);
    expect(frontier.acceptFacts('world:1', batch([fact(1, 4)]))).toBe(true);
    expect(frontier.acceptFacts('world:1', batch([fact(1, 4)]))).toBe(false);

    expect(projections).toHaveBeenCalledOnce();
    expect(facts).toHaveBeenCalledOnce();
  });

  it('rejects facts older or newer than current state while allowing one matching fact per instance', () => {
    const facts = vi.fn();
    const frontier = new BrowserMediaFrontier('world:1', undefined, facts);
    frontier.replaceEpoch('world:1', [projection(1, 3), projection(9, 1)]);

    expect(frontier.acceptFacts('world:1', batch([fact(1, 1), fact(1, 4)]))).toBe(false);
    expect(frontier.acceptFacts('world:1', batch([fact(1, 3), fact(9, 1)]))).toBe(true);
    expect(frontier.acceptFacts('world:1', batch([fact(1, 3), fact(9, 1)]))).toBe(false);

    expect(facts).toHaveBeenCalledOnce();
    expect(facts.mock.calls[0]![0].facts).toEqual([fact(1, 3), fact(9, 1)]);
  });

  it('rejects an equal-revision fact that does not describe the projected state', () => {
    const facts = vi.fn();
    const frontier = new BrowserMediaFrontier('world:1', undefined, facts);
    frontier.replaceEpoch('world:1', [projection(1, 3)]);

    expect(
      frontier.acceptFacts(
        'world:1',
        batch([{ ...fact(1, 3), trackId: 'sample:other', resource: { ...resource, path: 'other.mp3' } }]),
      ),
    ).toBe(false);
    expect(facts).not.toHaveBeenCalled();
  });

  it('blocks playback for an absent instance without retaining removed cursors', () => {
    const facts = vi.fn();
    const frontier = new BrowserMediaFrontier('world:1', undefined, facts);
    frontier.replaceEpoch('world:1', [projection(1, 2)]);
    expect(frontier.acceptFacts('world:1', batch([fact(1, 2)]))).toBe(true);

    expect(frontier.acceptProjections('world:1', [])).toBe(true);
    expect(frontier.acceptFacts('world:1', batch([fact(1, 2)]))).toBe(false);
    expect(
      frontier.acceptFacts(
        'world:1',
        batch([{ ...fact(1, 3), kind: 'eject', trackId: null, resource: null, playing: false }]),
      ),
    ).toBe(true);
    expect(
      frontier.acceptProjections('world:1', [
        { ...projection(1, 4), slot: null, resource: null, playing: false, resumePending: false },
      ]),
    ).toBe(true);
    expect(frontier.acceptFacts('world:1', batch([fact(1, 2)]))).toBe(false);
    expect(facts).toHaveBeenCalledTimes(2);
  });

  it('accepts an advancing instance projection independently of unrelated global revisions', () => {
    const projections = vi.fn();
    const frontier = new BrowserMediaFrontier('world:1', projections);
    frontier.replaceEpoch('world:1', [projection(1, 1)]);

    expect(frontier.acceptProjections('world:1', [projection(1, 2)])).toBe(true);
    expect(projections).toHaveBeenLastCalledWith([projection(1, 2)]);
  });

  it('tracks equal revisions independently for two positions sharing one definition', () => {
    const facts = vi.fn();
    const frontier = new BrowserMediaFrontier('world:1', undefined, facts);
    frontier.replaceEpoch('world:1', [projection(1, 2), projection(9, 2)], false);

    expect(frontier.acceptFacts('world:1', batch([fact(1, 2), fact(9, 2)]))).toBe(true);
    expect(facts.mock.calls[0]![0].facts.map((entry: MediaPlaybackFactV1) => entry.device.position[0])).toEqual([1, 9]);
    expect(frontier.acceptProjections('world:1', [projection(1, 2), projection(9, 3)])).toBe(true);
    expect(frontier.acceptFacts('world:1', batch([fact(1, 2), fact(9, 3)]))).toBe(true);
    expect(facts.mock.calls[1]![0].facts).toEqual([fact(9, 3)]);
  });

  it('validates a complete projection before replacing the old epoch', () => {
    const projections = vi.fn();
    const frontier = new BrowserMediaFrontier('world:1', projections);
    frontier.replaceEpoch('world:1', [projection(1, 3)]);
    const malformed = [projection(9, 1), { ...projection(10, 1), resource: null }];

    expect(() => frontier.replaceEpoch('world:2', malformed)).toThrow(/slot and resource/i);
    expect(frontier.current).toEqual([projection(1, 3)]);
    expect(projections).toHaveBeenCalledOnce();
  });

  it('rejects a malformed or stale fact anywhere in a batch without advancing any cursor', () => {
    const facts = vi.fn();
    const frontier = new BrowserMediaFrontier('world:1', undefined, facts);
    const malformed = [fact(1, 1), { ...fact(2, 1), device: { ...device(2), definitionId: 'bad' } }];

    expect(() => frontier.acceptFacts('world:1', batch(malformed))).toThrow();
    expect(facts).not.toHaveBeenCalled();
    frontier.replaceEpoch('world:1', [projection(1, 1), projection(2, 1)], false);
    expect(frontier.acceptFacts('world:1', batch([fact(1, 1), fact(2, 1)]))).toBe(true);
    expect(frontier.acceptFacts('old', batch([fact(1, 2)], 'old'))).toBe(false);
    expect(facts).toHaveBeenCalledOnce();
  });
});
