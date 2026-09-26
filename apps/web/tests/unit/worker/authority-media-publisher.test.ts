import { describe, expect, it, vi } from 'vitest';
import type { MediaPlaybackCommittedBatchV1 } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { publishPendingAuthorityMediaFacts } from '../../../src/worker/authority-media-publisher';

const batch = (revision: number): MediaPlaybackCommittedBatchV1 => ({
  version: 1,
  worldEpoch: 'runtime:2',
  worldRevision: 0,
  gameplayRevision: 7,
  facts: [
    {
      version: 1,
      kind: 'activate',
      device: { kind: 'voxel', position: [revision, 2, 3], definitionId: 'sample:device' },
      revision,
      previousTrackId: 'sample:track',
      trackId: 'sample:track',
      resource: { packId: 'sample:pack', path: 'assets/audio/track.mp3' },
      playing: true,
      resumePending: false,
    },
  ],
});

describe('authority media publisher', () => {
  it('drains all committed batches once and preserves outer/runtime epoch separation', () => {
    const second = batch(2);
    const pending = [
      batch(1),
      {
        ...second,
        facts: [...second.facts, { ...second.facts[0]!, device: { ...second.facts[0]!.device, position: [9, 2, 3] } }],
      },
    ];
    const source = { takeMediaFacts: vi.fn(() => pending.splice(0)) };
    const post = vi.fn();

    expect(publishPendingAuthorityMediaFacts('session:1', 'runtime:2', source, post)).toBe(2);
    expect(source.takeMediaFacts).toHaveBeenCalledWith('runtime:2');
    expect(
      post.mock.calls.map(([message]) => [message.epoch, message.batch.worldEpoch, message.batch.facts[0].revision]),
    ).toEqual([
      ['session:1', 'runtime:2', 1],
      ['session:1', 'runtime:2', 2],
    ]);
    expect(publishPendingAuthorityMediaFacts('session:1', 'runtime:2', source, post)).toBe(0);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1]![0]).toMatchObject({
      batch: { facts: [{ device: { position: [2, 2, 3] } }, { device: { position: [9, 2, 3] } }] },
    });
  });
});
