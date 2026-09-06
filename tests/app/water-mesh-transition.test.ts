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

  it('bounds completed and superseded history while releasing every active record', () => {
    const tracker = new WaterMeshTransitionTracker();
    for (let revision = 0; revision < 40; revision += 1) {
      const traceId = `trace-${revision}`;
      tracker.begin({ chunkKey: '1,0,0', targetRevision: revision, traceId }, 0);
      tracker.advance(traceId, 0.25);
      tracker.cancel(traceId);
    }
    tracker.begin({ chunkKey: '1,0,0', targetRevision: 40, traceId: 'trace-terminal' }, 0);
    tracker.complete('trace-terminal');

    const snapshot = tracker.snapshot();
    expect(snapshot.activeCount).toBe(0);
    expect(snapshot.recent).toHaveLength(32);
    expect(snapshot.recent[0]).toMatchObject({ traceId: 'trace-9', superseded: true });
    expect(snapshot.recent.at(-1)).toMatchObject({
      traceId: 'trace-terminal',
      progress: 1,
      completed: true,
      superseded: false,
    });
  });
});
