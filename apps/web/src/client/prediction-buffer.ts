import type { BodyState, Vec3 } from '@seedlands/game-core/physics';
import type { InputCommand } from '@seedlands/game-core/runtime/session-protocol';

export type PredictionFrame = Readonly<{
  sequence: number;
  targetPhysicsTick: number;
  input: InputCommand;
  predictedBody: BodyState;
  collisionRevisionVector: Readonly<Record<string, number>>;
}>;

export type PredictionReconciliation = Readonly<{
  acknowledgedInputSequence: number;
  authoritativeBody: BodyState;
  collisionRevisionVector: Readonly<Record<string, number>>;
  availableCollisionRevisionVector?: Readonly<Record<string, number>>;
  replay: (body: BodyState, input: InputCommand) => BodyState;
}>;

export type PredictionReconciliationResult = Readonly<{
  body: BodyState;
  replayed: number;
  presentationOffset: Vec3;
  resetReason: null | 'collision-history-missing' | 'large-error';
}>;

const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
const DEFAULT_MAX_FRAMES = 256;
const DEFAULT_MAX_SMOOTH_ERROR = 0.25;

const cloneVec3 = (value: Vec3): Vec3 => ({ x: value.x, y: value.y, z: value.z });
const cloneBody = (value: BodyState): BodyState => ({
  position: cloneVec3(value.position),
  velocity: cloneVec3(value.velocity),
});
const cloneInput = (value: InputCommand): InputCommand => ({
  kind: value.kind,
  protocolVersion: value.protocolVersion,
  epoch: value.epoch,
  stream: value.stream,
  sequence: value.sequence,
  targetPhysicsTick: value.targetPhysicsTick,
  ...(value.movementRevision === undefined ? {} : { movementRevision: value.movementRevision }),
  issuedAtMs: value.issuedAtMs,
  state: {
    moveX: value.state.moveX,
    moveZ: value.state.moveZ,
    verticalIntent: value.state.verticalIntent,
    jumpHeld: value.state.jumpHeld,
  },
  edges: { jumpPressed: value.edges.jumpPressed },
});
const cloneRevisionVector = (value: Readonly<Record<string, number>>): Readonly<Record<string, number>> => ({
  ...value,
});
const cloneFrame = (value: PredictionFrame): PredictionFrame => ({
  sequence: value.sequence,
  targetPhysicsTick: value.targetPhysicsTick,
  input: cloneInput(value.input),
  predictedBody: cloneBody(value.predictedBody),
  collisionRevisionVector: cloneRevisionVector(value.collisionRevisionVector),
});
const sameRevisionVector = (left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>) => {
  return Object.entries(left).every(([key, revision]) => right[key] === revision);
};
const offsetBetween = (oldPosition: Vec3, newPosition: Vec3): Vec3 => ({
  x: oldPosition.x - newPosition.x,
  y: oldPosition.y - newPosition.y,
  z: oldPosition.z - newPosition.z,
});
const length = (value: Vec3) => Math.hypot(value.x, value.y, value.z);
const finiteVec3 = (value: Vec3) => Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
const assertFiniteBody = (value: BodyState) => {
  if (!finiteVec3(value.position) || !finiteVec3(value.velocity))
    throw new RangeError('Prediction body must be finite.');
};
const assertFrame = (frame: PredictionFrame) => {
  if (!Number.isSafeInteger(frame.sequence) || frame.sequence < 0)
    throw new RangeError('Prediction frame sequence must be a non-negative safe integer.');
  if (!Number.isSafeInteger(frame.targetPhysicsTick) || frame.targetPhysicsTick < 0)
    throw new RangeError('Prediction frame tick must be a non-negative safe integer.');
  if (frame.sequence !== frame.input.sequence)
    throw new RangeError('Prediction frame sequence must match input sequence.');
  if (frame.targetPhysicsTick !== frame.input.targetPhysicsTick)
    throw new RangeError('Prediction frame tick must match input tick.');
  assertFiniteBody(frame.predictedBody);
};

/**
 * Local-player-only prediction history. Frames are copied at every ownership
 * boundary; callers can neither mutate buffered input nor alter a reconciliation
 * result through a shared vector/body object.
 */
export class PredictionBuffer {
  private readonly maxFrames: number;
  private readonly maxSmoothError: number;
  private storedFrames: PredictionFrame[] = [];

  constructor(options: Readonly<{ maxFrames?: number; maxSmoothError?: number }> = {}) {
    this.maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES;
    this.maxSmoothError = options.maxSmoothError ?? DEFAULT_MAX_SMOOTH_ERROR;
    if (!Number.isSafeInteger(this.maxFrames) || this.maxFrames < 1)
      throw new RangeError('Prediction frame capacity must be a positive integer.');
    if (!Number.isFinite(this.maxSmoothError) || this.maxSmoothError < 0)
      throw new RangeError('Prediction smoothing error must be a non-negative finite number.');
  }

  get frames(): readonly PredictionFrame[] {
    return this.storedFrames.map(cloneFrame);
  }

  /**
   * New frames are stored in sequence order even when arrival is out of order;
   * an identical sequence replaces the older local estimate. Capacity resets
   * prior history but retains the newest frame so prediction can resume.
   */
  record(frame: PredictionFrame): 'recorded' | 'replaced' | 'capacity-reset' {
    assertFrame(frame);
    const stored = cloneFrame(frame);
    const existingIndex = this.storedFrames.findIndex((candidate) => candidate.sequence === stored.sequence);
    if (existingIndex >= 0) {
      this.storedFrames[existingIndex] = stored;
      return 'replaced';
    }
    if (this.storedFrames.length >= this.maxFrames) {
      this.storedFrames = [stored];
      return 'capacity-reset';
    }
    this.storedFrames.push(stored);
    this.storedFrames.sort((left, right) => left.sequence - right.sequence);
    return 'recorded';
  }

  reconcile(request: PredictionReconciliation): PredictionReconciliationResult {
    assertFiniteBody(request.authoritativeBody);
    const authoritativeBody = cloneBody(request.authoritativeBody);
    const currentRevisions = cloneRevisionVector(request.collisionRevisionVector);
    const availableRevisions = cloneRevisionVector(request.availableCollisionRevisionVector ?? currentRevisions);
    const retained = this.storedFrames.filter((frame) => frame.sequence > request.acknowledgedInputSequence);
    if (
      retained.some(
        (frame) =>
          Object.entries(frame.collisionRevisionVector).some(
            ([key, revision]) => currentRevisions[key] !== undefined && currentRevisions[key] !== revision,
          ) || !sameRevisionVector(frame.collisionRevisionVector, availableRevisions),
      )
    ) {
      this.storedFrames = [];
      return {
        body: authoritativeBody,
        replayed: 0,
        presentationOffset: cloneVec3(ZERO),
        resetReason: 'collision-history-missing',
      };
    }

    const oldPredictedEnd = this.storedFrames.at(-1)?.predictedBody;
    let replayedBody = authoritativeBody;
    const replayedFrames: PredictionFrame[] = [];
    // The buffer is committed only after this complete replay. A throwing
    // callback therefore leaves the original input history untouched.
    for (const frame of retained) {
      replayedBody = cloneBody(request.replay(cloneBody(replayedBody), cloneInput(frame.input)));
      assertFiniteBody(replayedBody);
      replayedFrames.push({ ...cloneFrame(frame), predictedBody: cloneBody(replayedBody) });
    }

    const presentationOffset = oldPredictedEnd
      ? offsetBetween(oldPredictedEnd.position, replayedBody.position)
      : cloneVec3(ZERO);
    const resetReason = oldPredictedEnd && length(presentationOffset) > this.maxSmoothError ? 'large-error' : null;
    this.storedFrames = resetReason === 'large-error' ? [] : replayedFrames;
    if (resetReason === 'large-error')
      return {
        body: cloneBody(authoritativeBody),
        replayed: 0,
        presentationOffset: cloneVec3(ZERO),
        resetReason,
      };
    return {
      body: cloneBody(replayedBody),
      replayed: replayedFrames.length,
      presentationOffset: resetReason ? cloneVec3(ZERO) : presentationOffset,
      resetReason,
    };
  }

  clear(_reason?: string): void {
    this.storedFrames = [];
  }

  collisionChunkKeys(acknowledgedInputSequence: number): readonly string[] {
    const keys = new Set<string>();
    for (const frame of this.storedFrames)
      if (frame.sequence > acknowledgedInputSequence)
        for (const key of Object.keys(frame.collisionRevisionVector)) keys.add(key);
    return [...keys];
  }
}
