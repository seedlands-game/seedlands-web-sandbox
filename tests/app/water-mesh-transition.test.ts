import { describe, expect, it } from 'vitest';
import { WaterMeshTransitionTracker } from '../../src/app/water-mesh-transition';

describe('WaterMeshTransitionTracker', () => {
  it('records a revision-bound monotonic transition across multiple rendered frames', () => {
    const tracker = new WaterMeshTransitionTracker();
    const identity = { chunkKey: '0,0,0', targetRevision: 12, traceId: 'trace-12' };
    tracker.begin(identity, 0.12);
    tracker.advance(identity.traceId, 0.35);
    tracker.advance(identity.traceId, 0.72);
    tracker.complete(identity.traceId);

    expect(tracker.snapshot()).toMatchObject({ activeCount: 0 });
    expect(tracker.snapshot().recent[0]).toMatchObject({
      ...identity,
      progress: 1,
      frameCount: 4,
      completed: true,
      superseded: false,
    });
    expect(tracker.snapshot().recent[0].progressSamples).toEqual([0.12, 0.35, 0.72, 1]);
  });

  it('never lets an out-of-order frame move visual authority backwards', () => {
    const tracker = new WaterMeshTransitionTracker();
    tracker.begin({ chunkKey: '1,0,0', targetRevision: 3, traceId: 'trace-3' }, 0.2);
    tracker.advance('trace-3', 0.6);
    tracker.advance('trace-3', 0.4);

    expect(tracker.snapshot().active[0].progressSamples).toEqual([0.2, 0.6, 0.6]);
  });
});
