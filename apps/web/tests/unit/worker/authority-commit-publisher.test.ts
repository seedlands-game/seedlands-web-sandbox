import { describe, expect, it, vi } from 'vitest';
import type { FluidCandidate } from '../../../../../packages/stdlib/src/server/fluid/fluid-transaction';
import type { WorldCommitResult } from '../../../../../packages/stdlib/src/server/game-server-types';
import {
  commitFluidCandidateAndPublish,
  publishPendingAuthorityCommits,
} from '../../../src/worker/authority-commit-publisher';

const commit = (worldRevision: number) =>
  ({ committed: true, worldRevision, structuralChange: null }) as WorldCommitResult;

const candidate = { workId: 'fluid-1' } as FluidCandidate;

describe('Authority 结构提交即时发布', () => {
  it('一次性按原顺序发布当前提交并让后续快照无重复可取', () => {
    const pending = [commit(7), commit(8)];
    const runtime = { takeCommits: () => pending.splice(0) };
    const post = vi.fn();

    expect(publishPendingAuthorityCommits('world:1', runtime, post)).toBe(true);
    expect(post).toHaveBeenCalledWith({
      kind: 'authority-commits',
      protocolVersion: 1,
      epoch: 'world:1',
      commits: [expect.objectContaining({ worldRevision: 7 }), expect.objectContaining({ worldRevision: 8 })],
    });
    expect(runtime.takeCommits()).toEqual([]);
    expect(publishPendingAuthorityCommits('world:1', runtime, post)).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('真实候选入口仅在接纳后发布已提交队列，不推进Authority时钟', () => {
    const pending: WorldCommitResult[] = [];
    const source = {
      commitFluidCandidate: vi.fn(() => {
        pending.push(commit(7), commit(8));
        return { accepted: true as const, commitSequence: 3 };
      }),
      takeCommits: vi.fn(() => pending.splice(0)),
      wake: vi.fn(),
    };
    const post = vi.fn();

    expect(commitFluidCandidateAndPublish('world:1', source, candidate, post)).toBe(true);
    expect(source.commitFluidCandidate).toHaveBeenCalledWith(candidate);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'authority-commits', commits: expect.any(Array) }),
    );
    expect(source.commitFluidCandidate.mock.invocationCallOrder[0]).toBeLessThan(
      source.takeCommits.mock.invocationCallOrder[0]!,
    );
    expect(source.takeCommits.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]!);
    expect(pending).toEqual([]);
    expect(source.wake).not.toHaveBeenCalled();
  });

  it('拒绝候选与接纳后空提交均不发送独立消息', () => {
    const rejected = {
      commitFluidCandidate: vi.fn(() => ({ accepted: false as const, reason: 'work-id' as const })),
      takeCommits: vi.fn(() => [commit(9)]),
    };
    const empty = {
      commitFluidCandidate: vi.fn(() => ({ accepted: true as const, commitSequence: 4 })),
      takeCommits: vi.fn(() => []),
    };
    const post = vi.fn();

    expect(commitFluidCandidateAndPublish('world:1', rejected, candidate, post)).toBe(false);
    expect(rejected.takeCommits).not.toHaveBeenCalled();
    expect(commitFluidCandidateAndPublish('world:1', empty, candidate, post)).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });
});
