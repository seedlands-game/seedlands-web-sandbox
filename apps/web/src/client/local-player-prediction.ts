import {
  bodyConfigFor,
  isBodyPositionReachable,
  stepBody,
  type BodyState,
  type PhysicsWorld,
  type Vec3,
} from '@seedlands/stdlib/physics';
import type { InputCommand, SessionEpoch } from '@seedlands/stdlib/runtime/session-protocol';
import { PlayerInputStream, type PlayerInputKeys } from './player-input-stream';
import { PredictionBuffer, type PredictionReconciliationResult } from './prediction-buffer';

export type RevisionedPredictionWorld = PhysicsWorld & {
  revisionVector(keys?: Iterable<string>): Readonly<Record<string, number>>;
};

/** Validated authority state consumed by prediction, independent of the transport snapshot. */
export type PredictionAuthorityState = Readonly<{
  physicsTick: number;
  acknowledgedInputSequence: number;
  inputResyncRequired: boolean;
  player: Readonly<{
    body: BodyState;
    grounded: boolean;
    movement?: Readonly<{ revision: string; flightSpeed: number | null }>;
  }>;
  chunkRevisions: Readonly<Record<string, number>>;
}>;

export type LocalPredictionAdvance = Readonly<{
  elapsedSeconds: number;
  snapshot: PredictionAuthorityState;
  world: RevisionedPredictionWorld;
  issuedAtMs: number;
  forward: Readonly<{ x: number; z: number }>;
  right: Readonly<{ x: number; z: number }>;
  keys: PlayerInputKeys;
}>;

const cloneVector = (value: Vec3): Vec3 => ({ ...value });
const cloneBody = (value: BodyState): BodyState => ({
  position: cloneVector(value.position),
  velocity: cloneVector(value.velocity),
});
const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export class LocalPlayerPrediction {
  private readonly inputStream: PlayerInputStream;
  private readonly prediction: PredictionBuffer;
  private accumulator = 0;
  private movementRevision: string | undefined;
  private bodyValue: BodyState | null = null;
  private offsetValue: Vec3 = cloneVector(ZERO);
  private groundedValue = false;
  private lastResetReasonValue: string | null = null;
  private readonly resetCountsValue: Record<string, number> = {};

  constructor(
    epoch: SessionEpoch,
    readonly physicsHz: 30 | 60 | 120,
    options: Readonly<{ estimatedInputTransitMs?: number; maxSmoothError?: number }> = {},
  ) {
    const estimatedInputTransitMs = options.estimatedInputTransitMs ?? 0;
    if (!Number.isFinite(estimatedInputTransitMs) || estimatedInputTransitMs < 0)
      throw new RangeError('Estimated input transit time must be non-negative and finite.');
    const transitLeadTicks = Math.ceil((estimatedInputTransitMs * physicsHz) / 1_000);
    this.inputStream = new PlayerInputStream(epoch, transitLeadTicks + 2);
    this.prediction = new PredictionBuffer({ maxSmoothError: options.maxSmoothError });
  }

  get physicalBody(): BodyState | null {
    return this.bodyValue ? cloneBody(this.bodyValue) : null;
  }

  get presentationOffset(): Vec3 {
    return cloneVector(this.offsetValue);
  }

  get grounded(): boolean {
    return this.groundedValue;
  }

  get pendingFrames() {
    return this.prediction.frames;
  }

  get lastResetReason(): string | null {
    return this.lastResetReasonValue;
  }

  get resetCounts(): Readonly<Record<string, number>> {
    return { ...this.resetCountsValue };
  }

  advance(request: LocalPredictionAdvance): Readonly<{ commands: InputCommand[]; body: BodyState }> {
    if (!Number.isFinite(request.elapsedSeconds) || request.elapsedSeconds < 0)
      throw new RangeError('Prediction elapsed seconds must be non-negative and finite.');
    this.synchronizeMovement(request.snapshot);
    this.bodyValue ??= cloneBody(request.snapshot.player.body);
    const stepSeconds = 1 / this.physicsHz;
    this.accumulator = Math.min(stepSeconds * 4, this.accumulator + request.elapsedSeconds);
    const commands: InputCommand[] = [];
    while (this.accumulator + Number.EPSILON >= stepSeconds) {
      this.accumulator -= stepSeconds;
      const sample = this.inputStream.sample({
        physicsTick: request.snapshot.physicsTick,
        issuedAtMs: request.issuedAtMs,
        forward: request.forward,
        right: request.right,
        keys: request.keys,
      });
      if (!sample) continue;
      const command = {
        ...sample,
        ...(request.snapshot.player.movement ? { movementRevision: request.snapshot.player.movement.revision } : {}),
      };
      const result = stepBody({
        state: this.bodyValue,
        config: bodyConfigFor('player'),
        input: {
          wish: { x: command.state.moveX, z: command.state.moveZ },
          jumpPressed: command.state.jumpHeld || command.edges.jumpPressed,
          verticalIntent: command.state.verticalIntent,
          ...(request.snapshot.player.movement?.flightSpeed
            ? { controlledFlight: { verticalSpeed: request.snapshot.player.movement.flightSpeed } }
            : {}),
        },
        world: request.world,
        dt: stepSeconds,
      });
      this.bodyValue = result.state;
      this.groundedValue = result.grounded;
      this.prediction.record({
        sequence: command.sequence,
        targetPhysicsTick: command.targetPhysicsTick,
        input: command,
        predictedBody: result.state,
        collisionRevisionVector: request.world.revisionVector(),
      });
      commands.push(command);
    }
    return { commands, body: cloneBody(this.bodyValue) };
  }

  applyAuthoritySnapshot(
    snapshot: PredictionAuthorityState,
    world: RevisionedPredictionWorld,
  ): PredictionReconciliationResult {
    this.synchronizeMovement(snapshot);
    const result = this.prediction.reconcile({
      acknowledgedInputSequence: snapshot.acknowledgedInputSequence,
      authoritativeBody: snapshot.player.body,
      collisionRevisionVector: snapshot.chunkRevisions,
      // The authority reports its contact window; prediction can already touch the next chunk.
      availableCollisionRevisionVector: world.revisionVector(
        new Set([
          ...Object.keys(snapshot.chunkRevisions),
          ...this.prediction.collisionChunkKeys(snapshot.acknowledgedInputSequence),
        ]),
      ),
      replay: (body, command) =>
        stepBody({
          state: body,
          config: bodyConfigFor('player'),
          input: {
            wish: { x: command.state.moveX, z: command.state.moveZ },
            jumpPressed: command.state.jumpHeld || command.edges.jumpPressed,
            verticalIntent: command.state.verticalIntent,
            ...(snapshot.player.movement?.flightSpeed
              ? { controlledFlight: { verticalSpeed: snapshot.player.movement.flightSpeed } }
              : {}),
          },
          world,
          dt: 1 / this.physicsHz,
        }).state,
    });
    this.bodyValue = cloneBody(result.body);
    this.offsetValue = cloneVector(result.presentationOffset);
    this.groundedValue = snapshot.player.grounded;
    if (result.resetReason) this.recordReset(result.resetReason);
    if (snapshot.inputResyncRequired) {
      if (!result.resetReason) this.recordReset('authority-resync');
      this.inputStream.resynchronize(snapshot.physicsTick);
    }
    if (snapshot.inputResyncRequired || result.resetReason) {
      this.accumulator = 0;
    }
    return result;
  }

  presentedBody(world: PhysicsWorld, elapsedSeconds: number): BodyState {
    if (!this.bodyValue) throw new Error('Prediction body is not initialized.');
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0)
      throw new RangeError('Presentation elapsed seconds must be non-negative and finite.');
    const decay = Math.max(0, 1 - elapsedSeconds * 12);
    const offset = {
      x: this.offsetValue.x * decay,
      y: this.offsetValue.y * decay,
      z: this.offsetValue.z * decay,
    };
    const candidate: BodyState = {
      position: {
        x: this.bodyValue.position.x + offset.x,
        y: this.bodyValue.position.y + offset.y,
        z: this.bodyValue.position.z + offset.z,
      },
      velocity: cloneVector(this.bodyValue.velocity),
    };
    if (!isBodyPositionReachable(this.bodyValue, bodyConfigFor('player'), world, candidate.position)) {
      this.offsetValue = cloneVector(ZERO);
      return cloneBody(this.bodyValue);
    }
    this.offsetValue = offset;
    return candidate;
  }

  interrupt(snapshot: PredictionAuthorityState, issuedAtMs: number): InputCommand {
    this.recordReset('input-interrupted');
    this.prediction.clear('input-interrupted');
    this.accumulator = 0;
    this.offsetValue = cloneVector(ZERO);
    return {
      ...this.inputStream.release(snapshot.physicsTick, issuedAtMs),
      ...(snapshot.player.movement ? { movementRevision: snapshot.player.movement.revision } : {}),
    };
  }

  reset(): void {
    this.recordReset('external-position-change');
    this.prediction.clear('external-position-change');
    this.bodyValue = null;
    this.offsetValue = cloneVector(ZERO);
    this.accumulator = 0;
  }

  resynchronize(snapshot: PredictionAuthorityState): void {
    this.recordReset('authority-resync');
    this.inputStream.resynchronize(snapshot.physicsTick);
    this.prediction.clear('authority-resync');
    this.bodyValue = cloneBody(snapshot.player.body);
    this.offsetValue = cloneVector(ZERO);
    this.accumulator = 0;
  }

  private synchronizeMovement(snapshot: PredictionAuthorityState) {
    const revision = snapshot.player.movement?.revision;
    if (this.movementRevision !== undefined && revision !== this.movementRevision) {
      this.resynchronize(snapshot);
      this.recordReset('movement-mode-changed');
    }
    this.movementRevision = revision;
  }

  private recordReset(reason: string): void {
    this.lastResetReasonValue = reason;
    this.resetCountsValue[reason] = (this.resetCountsValue[reason] ?? 0) + 1;
  }
}
