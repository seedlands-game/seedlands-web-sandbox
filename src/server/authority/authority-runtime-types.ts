import type { WorkerCanonicalResult, WorldCommitResult } from '../game-server-types';
import type { AuthorityGameplayView } from '../../worker/authority-worker-protocol';
import type { AuthoritySnapshot } from './authority-session';

export type AuthorityFrequencies = Readonly<{
  physicsHz: 30 | 60 | 120;
  gameplayHz: 10 | 20;
  fluidHz: 20 | 30;
}>;

export type AuthorityAdvanceResult = Readonly<{
  snapshot: AuthoritySnapshot;
  lanes: Readonly<{ physicsSteps: number; gameplayPeriods: number; fluidPeriods: number }>;
  gameplay: AuthorityGameplayView;
  commits: readonly WorldCommitResult[];
}>;

export type AuthorityInitialWorldBootstrap = Readonly<{
  playerBodyPosition: [number, number, number];
  starterChunks: readonly WorkerCanonicalResult[];
}>;

export type AuthorityTransactionIdentity = Readonly<{
  epoch: string;
  issuer: string;
  stream: string;
  sequence: number;
  expectedCommitSequence?: number;
}>;

export type AuthorityTransactionReceipt<T> = Readonly<
  | { status: 'executed'; commitSequence: number; result: T }
  | { status: 'conflict' | 'expired' | 'capacity'; commitSequence: number }
>;
