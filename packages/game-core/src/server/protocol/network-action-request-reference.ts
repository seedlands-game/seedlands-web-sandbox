import type { AuthorityAction } from '../../compute/authority-worker-protocol';
import { copyAuthorityActionReference } from './network-action-reference-copy';
import { NETWORK_REFERENCE_PROJECTION_VERSION } from './network-reference-projection-types';
import { canonicalReferenceInteger } from './network-reference-integer';

export type ActionRequestReference = Readonly<{
  kind: 'action-request-reference';
  projectionVersion: typeof NETWORK_REFERENCE_PROJECTION_VERSION;
  action: AuthorityAction;
  sequence: number;
}>;

const sequence = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid sequence.');
  return canonicalReferenceInteger(value);
};

/** 参考 DTO 只含 DedicatedServerHost.performAction 的两个实参。 */
export function projectActionRequestReference(action: AuthorityAction, actionSequence: number): ActionRequestReference {
  return {
    kind: 'action-request-reference',
    projectionVersion: NETWORK_REFERENCE_PROJECTION_VERSION,
    action: copyAuthorityActionReference(action),
    sequence: sequence(actionSequence),
  };
}
