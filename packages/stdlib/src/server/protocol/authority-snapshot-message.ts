import type { PROTOCOL_VERSION, SessionEpoch } from '../../runtime/session-protocol';
import type { AuthoritySnapshot } from '../authority/authority-session';
import type { WorldCommitResult } from '../game-server-types';
import type { AuthorityGameplayView } from './authority-worker-protocol';

export type AuthoritySnapshotMessage = Readonly<{
  kind: 'authority-snapshot';
  protocolVersion: typeof PROTOCOL_VERSION;
  epoch: SessionEpoch;
  snapshot: AuthoritySnapshot;
  /** Optional browser transport metadata, excluded from authority/save state. */
  capturedAtTimeOriginMs?: number;
  gameplay?: AuthorityGameplayView;
  commits?: readonly WorldCommitResult[];
}>;
