import { PROTOCOL_VERSION, type InputCommand, type SessionEpoch } from '@seedlands/stdlib/runtime/session-protocol';

export type PlayerInputKeys = Readonly<{
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  crouch: boolean;
}>;

export type PlayerInputSample = Readonly<{
  physicsTick: number;
  issuedAtMs: number;
  forward: Readonly<{ x: number; z: number }>;
  right: Readonly<{ x: number; z: number }>;
  keys: PlayerInputKeys;
}>;

export class PlayerInputStream {
  private sequence = -1;
  private lastTargetPhysicsTick = -1;
  private jumpWasHeld = false;

  constructor(
    private readonly epoch: SessionEpoch,
    private readonly inputLeadTicks = 2,
  ) {
    if (!Number.isSafeInteger(inputLeadTicks) || inputLeadTicks < 1)
      throw new RangeError('Input lead must be a positive integer number of ticks.');
  }

  sample(sample: PlayerInputSample): InputCommand | null {
    if (!Number.isSafeInteger(sample.physicsTick) || sample.physicsTick < 0)
      throw new RangeError('Authority physics tick must be a non-negative safe integer.');
    if (!Number.isFinite(sample.issuedAtMs)) throw new RangeError('Input sample time must be finite.');
    const targetPhysicsTick = Math.max(sample.physicsTick + this.inputLeadTicks, this.lastTargetPhysicsTick + 1);
    let moveX =
      sample.forward.x * Number(sample.keys.forward) -
      sample.forward.x * Number(sample.keys.back) +
      sample.right.x * Number(sample.keys.right) -
      sample.right.x * Number(sample.keys.left);
    let moveZ =
      sample.forward.z * Number(sample.keys.forward) -
      sample.forward.z * Number(sample.keys.back) +
      sample.right.z * Number(sample.keys.right) -
      sample.right.z * Number(sample.keys.left);
    const length = Math.hypot(moveX, moveZ);
    if (length > 1) {
      moveX /= length;
      moveZ /= length;
    }
    const command: InputCommand = {
      kind: 'input',
      protocolVersion: PROTOCOL_VERSION,
      epoch: this.epoch,
      stream: 'player-input',
      sequence: ++this.sequence,
      targetPhysicsTick,
      issuedAtMs: sample.issuedAtMs,
      state: {
        moveX,
        moveZ,
        verticalIntent: sample.keys.jump ? 1 : sample.keys.crouch ? -1 : 0,
        jumpHeld: sample.keys.jump,
      },
      edges: { jumpPressed: sample.keys.jump && !this.jumpWasHeld },
    };
    this.lastTargetPhysicsTick = targetPhysicsTick;
    this.jumpWasHeld = sample.keys.jump;
    return command;
  }

  resynchronize(physicsTick: number): void {
    if (!Number.isSafeInteger(physicsTick) || physicsTick < 0)
      throw new RangeError('Authority physics tick must be a non-negative safe integer.');
    this.lastTargetPhysicsTick = physicsTick;
    this.jumpWasHeld = false;
  }

  release(physicsTick: number, issuedAtMs: number): InputCommand {
    this.jumpWasHeld = false;
    return this.sample({
      physicsTick,
      issuedAtMs,
      forward: { x: 0, z: -1 },
      right: { x: 1, z: 0 },
      keys: { forward: false, back: false, left: false, right: false, jump: false, crouch: false },
    })!;
  }
}
