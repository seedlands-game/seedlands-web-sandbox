import type { FluidCandidate } from '@seedlands/stdlib/server/fluid/fluid-transaction';
import type { WorldCommitResult } from '@seedlands/stdlib/server/game-server-types';
import { PROTOCOL_VERSION, type SessionEpoch } from '@seedlands/stdlib/runtime/session-protocol';
import type { AuthorityCommitMessage } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';

type PendingCommitSource = Readonly<{
  takeCommits(): WorldCommitResult[];
}>;

type FluidCandidateCommitSource = PendingCommitSource &
  Readonly<{
    commitFluidCandidate(candidate: FluidCandidate): Readonly<{ accepted: boolean }>;
  }>;

export function publishPendingAuthorityCommits(
  epoch: SessionEpoch,
  source: PendingCommitSource,
  post: (message: AuthorityCommitMessage) => void,
): boolean {
  const commits = source.takeCommits();
  if (!commits.length) return false;
  post({ kind: 'authority-commits', protocolVersion: PROTOCOL_VERSION, epoch, commits });
  return true;
}

export function commitFluidCandidateAndPublish(
  epoch: SessionEpoch,
  source: FluidCandidateCommitSource,
  candidate: FluidCandidate,
  post: (message: AuthorityCommitMessage) => void,
): boolean {
  if (!source.commitFluidCandidate(candidate).accepted) return false;
  return publishPendingAuthorityCommits(epoch, source, post);
}
