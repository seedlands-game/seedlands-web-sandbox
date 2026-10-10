import type { PROTOCOL_VERSION, SessionEpoch } from '../../runtime/session-protocol';

/** Existing renderer reads and the bounded metadata companion; all stay within the current session world. */
export type AuthorityRendererReadRequest =
  | Readonly<{
      kind: 'prepare-mesh';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      cx: number;
      cy: number;
      cz: number;
    }>
  | Readonly<{
      kind: 'request-column-source';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      cx: number;
      cz: number;
    }>
  | Readonly<{
      kind: 'request-collision-baseline';
      protocolVersion: typeof PROTOCOL_VERSION;
      epoch: SessionEpoch;
      requestId: number;
      key: string;
      minimumRevision: number;
    }>;
