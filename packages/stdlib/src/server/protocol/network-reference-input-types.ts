import type { InputCommand, SequenceDecision } from '../../runtime/session-protocol';
import { NETWORK_REFERENCE_PROJECTION_VERSION } from './network-reference-projection-types';

export type PlayerInputReference = Readonly<{
  kind: 'player-input-reference';
  projectionVersion: typeof NETWORK_REFERENCE_PROJECTION_VERSION;
  input: InputCommand;
}>;

export type InputDecisionReference = Readonly<{
  kind: 'input-decision-reference';
  projectionVersion: typeof NETWORK_REFERENCE_PROJECTION_VERSION;
  /** 服务端 snapshot 的 epoch，与 input.epoch 分开以保留 wrong-epoch 决定。 */
  epoch: string;
  input: Readonly<{
    epoch: string;
    stream: string;
    sequence: number;
    targetPhysicsTick: number;
  }>;
  decision: SequenceDecision;
  /** receiveInput 返回后、后续物理 tick 消费前的实际观测。 */
  observedPhysicsTick: number;
  /** -1 表示尚未消费任何真实入站 input。 */
  observedAcknowledgedInputSequence: number;
  inputResyncRequired: boolean;
}>;
