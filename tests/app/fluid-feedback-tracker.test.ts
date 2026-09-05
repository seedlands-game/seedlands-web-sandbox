import { describe, expect, it } from 'vitest';
import { FluidFeedbackTracker } from '../../src/app/fluid-feedback-tracker';

describe('FluidFeedbackTracker', () => {
  it('reports edit, commit, worker, attach, and visible stages for warm samples', () => {
    let now = 10;
    const tracker = new FluidFeedbackTracker(() => now);
    tracker.begin({ mergedRequests: 1, supersededInFlight: 2 });
    now = 18;
    tracker.markFirstCommit(['0,0,0']);
    now = 42;
    tracker.completeVisible(
      '0,0,0',
      {
        traceId: 'trace-1',
        category: 'chunk-request',
        name: '0,0,0',
        lane: 'main',
        startMs: 0,
        complete: true,
        marks: [
          { name: 'worker-start', lane: 'worker-derived', timestampMs: 20 },
          { name: 'worker-complete', lane: 'worker-derived', timestampMs: 29 },
          { name: 'scene-attached', lane: 'main', timestampMs: 38 },
          { name: 'visible-postrender', lane: 'main', timestampMs: 42 },
        ],
      },
      { mergedRequests: 4, supersededInFlight: 3 },
    );

    expect(tracker.summary()).toMatchObject({ count: 1, p50Ms: 32, p95Ms: 32, p99Ms: 32, maxMs: 32 });
    expect(tracker.summary().samples[0]).toMatchObject({
      editToCommitMs: 8,
      commitToWorkerStartMs: 2,
      workerMs: 9,
      workerToAttachMs: 9,
      attachToVisibleMs: 4,
      totalMs: 32,
      mergedRequests: 3,
      supersededInFlight: 1,
    });
  });

  it('keeps the sample pending until a committed target chunk is visible', () => {
    let now = 0;
    const tracker = new FluidFeedbackTracker(() => now);
    tracker.begin({ mergedRequests: 0, supersededInFlight: 0 });
    now = 4;
    tracker.markFirstCommit(['1,0,1']);
    now = 7;
    tracker.completeVisible('2,0,2', null, { mergedRequests: 0, supersededInFlight: 0 });

    expect(tracker.summary()).toMatchObject({ count: 0, pending: true });
  });
});
