import type {
  AuthorityActionResult,
  AuthorityRequest,
  AuthorityResponse,
} from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { PROTOCOL_VERSION } from '@seedlands/stdlib/runtime/session-protocol';

export type PointerAttackDirection = readonly [number, number, number];
export type PointerAttackInput = Readonly<{
  sequence: number;
  gesture: number;
  capturedAtTimeOriginMs: number;
  direction: PointerAttackDirection | null;
}>;
export type PointerAttackRequest = Readonly<{
  kind: 'pointer-attack-input';
  protocolVersion: typeof PROTOCOL_VERSION;
  epoch: string;
  runtimeEpoch: string;
  input: PointerAttackInput;
}>;
export type PointerAttackResponse = Readonly<{
  kind: 'pointer-attack-result';
  protocolVersion: typeof PROTOCOL_VERSION;
  epoch: string;
  runtimeEpoch: string;
  sequence: number;
  result: AuthorityActionResult;
}>;
/** Browser-local input envelopes; they do not extend the public gameplay action or save protocol. */
export type BrowserAuthorityRequest = AuthorityRequest | PointerAttackRequest;
export type BrowserAuthorityResponse = AuthorityResponse | PointerAttackResponse;
