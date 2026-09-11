import { describe, expect, it, vi } from 'vitest';
import { World } from '../../../src/app/world/world-runtime';
import type { WorldCommitResult } from '../../../../../packages/stdlib/src/server/game-server-types';
import { FluidFeedbackTracker } from '../../../src/app/gameplay/fluid-feedback-tracker';

const commit = (actorId: string) =>
  ({
    structuralChange: {
      type: 'voxel-region-changed',
      actorId,
      worldRevision: 7,
      mutationCount: 2,
      chunks: ['0,0,0'],
      chunkRevisions: [{ key: '0,0,0', revision: 4 }],
      meshChunks: ['0,0,0'],
      bounds: { min: [1, 1, 1], max: [2, 1, 1] },
    },
  }) as WorldCommitResult;

const fixture = () => {
  let now = 0;
  const feedback = new FluidFeedbackTracker(() => now);
  feedback.begin({ mergedRequests: 0, supersededInFlight: 0 });
  const request = vi.fn(),
    protectVisibleRevision = vi.fn(),
    scheduleRemesh = vi.fn();
  const receiver = {
    aggregateStructuralEventCount: 0,
    latestCommitMutationCount: 0,
    latestCommitMeshChunkCount: 0,
    aggregateRemeshSchedulingCount: 0,
    dirtyChunks: new Set(),
    fluidDirtyChunks: new Set(),
    fluidFeedback: feedback,
    scheduler: { latestTask: () => ({ cx: 0, cy: 0, cz: 0 }), request, protectVisibleRevision },
    repository: { chunks: new Map() },
    scheduleRemesh,
  };
  const consume = (actorId: string) =>
    World.prototype.consumeServerCommit.call(receiver as unknown as World, commit(actorId));
  const visible = () => {
    now = 12;
    feedback.completeVisible(
      { chunkKey: '0,0,0', chunkRevision: 4, traceId: 'fluid-visible' },
      {
        traceId: 'fluid-visible',
        category: 'chunk',
        name: 'water',
        lane: 'main',
        startMs: 0,
        complete: true,
        marks: [
          { name: 'worker-start', lane: 'worker-derived', timestampMs: 3 },
          { name: 'worker-complete', lane: 'worker-derived', timestampMs: 6 },
          { name: 'scene-attached', lane: 'main', timestampMs: 9 },
          { name: 'visible-postrender', lane: 'main', timestampMs: 12 },
        ],
      },
      { mergedRequests: 0, supersededInFlight: 0 },
    );
  };
  return { consume, visible, feedback, request, protectVisibleRevision, scheduleRemesh };
};

describe('权威流体结果到真实客户端提交入口', () => {
  it('fluid-v2 使用流体优先队列并为可见延迟绑定提交版本', () => {
    const subject = fixture();
    subject.consume('fluid-v2');
    expect(subject.protectVisibleRevision).toHaveBeenCalledWith('0,0,0', 4);
    expect(subject.request).toHaveBeenCalledWith(0, 0, 0, { forceRemesh: true, priority: 'interactive-fluid' });
    expect(subject.scheduleRemesh).toHaveBeenCalledWith(0);
    subject.visible();
    expect(subject.feedback.summary()).toMatchObject({ count: 1, pending: false, p95Ms: 12 });
  });
  it('普通编辑不会错误完成传播样本或建立derived-fluid首见屏障', () => {
    const subject = fixture();
    subject.consume('player-edit');
    expect(subject.protectVisibleRevision).not.toHaveBeenCalled();
    expect(subject.request).toHaveBeenCalledWith(0, 0, 0, { forceRemesh: true, priority: 'interactive' });
    subject.visible();
    expect(subject.feedback.summary()).toMatchObject({ count: 0, pending: true });
  });
});
