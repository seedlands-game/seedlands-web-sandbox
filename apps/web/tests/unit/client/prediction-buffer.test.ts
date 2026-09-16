import { describe, expect, it } from 'vitest';
import { PredictionBuffer, type PredictionFrame } from '../../../src/client/prediction-buffer';
import type { BodyState } from '../../../../../packages/stdlib/src/physics';
import { PROTOCOL_VERSION, type InputCommand } from '../../../../../packages/stdlib/src/runtime/session-protocol';

const body = (x: number, velocity = 0): BodyState => ({
  position: { x, y: 2, z: 0 },
  velocity: { x: velocity, y: 0, z: 0 },
});

const input = (sequence: number, moveX = 1): InputCommand => ({
  kind: 'input',
  protocolVersion: PROTOCOL_VERSION,
  epoch: 'world:1',
  stream: 'player-input',
  sequence,
  targetPhysicsTick: sequence,
  issuedAtMs: sequence * 10,
  state: { moveX, moveZ: 0, verticalIntent: 0, jumpHeld: false },
  edges: { jumpPressed: false },
});

const frame = (
  sequence: number,
  predictedX = sequence,
  revisions: Readonly<Record<string, number>> = { '0,1,0': 4 },
): PredictionFrame => ({
  sequence,
  targetPhysicsTick: sequence,
  input: input(sequence),
  predictedBody: body(predictedX),
  collisionRevisionVector: revisions,
});

const replay = (state: BodyState, command: InputCommand): BodyState => body(state.position.x + command.state.moveX);

describe('PredictionBuffer', () => {
  it('replays a loaded neighboring chunk that prediction reaches before the authority does', () => {
    const buffer = new PredictionBuffer();
    buffer.record(frame(1, 1, { '0,1,0': 4, '1,1,0': 9 }));
    const result = buffer.reconcile({
      acknowledgedInputSequence: 0,
      authoritativeBody: body(0),
      collisionRevisionVector: { '0,1,0': 4 },
      availableCollisionRevisionVector: { '0,1,0': 4, '1,1,0': 9 },
      replay,
    });
    expect(result.resetReason).toBeNull();
    expect(result.replayed).toBe(1);
    expect(result.body.position.x).toBe(1);
  });

  it.each<{ authority: Record<string, number>; available: Record<string, number> }>([
    { authority: { '0,1,0': 5 }, available: { '0,1,0': 4, '1,1,0': 9 } },
    { authority: { '0,1,0': 4 }, available: { '0,1,0': 4, '1,1,0': 10 } },
    { authority: { '0,1,0': 4 }, available: { '0,1,0': 4 } },
  ])('still rejects missing or changed neighboring collision history: %j', ({ authority, available }) => {
    const buffer = new PredictionBuffer();
    buffer.record(frame(1, 1, { '0,1,0': 4, '1,1,0': 9 }));
    expect(
      buffer.reconcile({
        acknowledgedInputSequence: 0,
        authoritativeBody: body(0),
        collisionRevisionVector: authority,
        availableCollisionRevisionVector: available,
        replay,
      }).resetReason,
    ).toBe('collision-history-missing');
  });
  it('copies frames defensively, replaces duplicate sequences, and replays novel out-of-order frames in sequence order', () => {
    const buffer = new PredictionBuffer({ maxSmoothError: 2 });
    const first = frame(2, 2);
    expect(buffer.record(first)).toBe('recorded');
    (first.input.state as { moveX: number }).moveX = 99;
    (first.predictedBody.position as { x: number }).x = 99;
    expect(buffer.record(frame(1, 1))).toBe('recorded');
    expect(buffer.record(frame(2, 3))).toBe('replaced');

    const exposed = buffer.frames;
    (exposed[0]!.input.state as { moveX: number }).moveX = 77;
    expect(buffer.frames.map((item) => item.sequence)).toEqual([1, 2]);
    expect(buffer.frames[1]!.input.state.moveX).toBe(1);

    const result = buffer.reconcile({
      acknowledgedInputSequence: 0,
      authoritativeBody: body(0),
      collisionRevisionVector: { '0,1,0': 4 },
      replay,
    });

    expect(result).toMatchObject({ body: body(2), replayed: 2, presentationOffset: { x: 1, y: 0, z: 0 } });
  });

  it('compares old and new prediction at the same replay point instead of treating prediction lead as correction error', () => {
    const buffer = new PredictionBuffer({ maxSmoothError: 0.25 });
    buffer.record(frame(1, 1));
    buffer.record(frame(2, 2));

    const result = buffer.reconcile({
      acknowledgedInputSequence: 0,
      authoritativeBody: body(0),
      collisionRevisionVector: { '0,1,0': 4 },
      replay,
    });

    expect(result).toEqual({ body: body(2), replayed: 2, presentationOffset: { x: 0, y: 0, z: 0 }, resetReason: null });
  });

  it('returns a bounded presentation offset for a small replay correction without changing the physical body', () => {
    const buffer = new PredictionBuffer({ maxSmoothError: 0.25 });
    buffer.record(frame(1, 1.1));

    const result = buffer.reconcile({
      acknowledgedInputSequence: 0,
      authoritativeBody: body(0),
      collisionRevisionVector: { '0,1,0': 4 },
      replay,
    });

    expect(result).toEqual({
      body: body(1),
      replayed: 1,
      presentationOffset: { x: 0.10000000000000009, y: 0, z: 0 },
      resetReason: null,
    });
  });

  it('removes acknowledged frames before replaying only newer input', () => {
    const buffer = new PredictionBuffer();
    buffer.record(frame(1, 1));
    buffer.record(frame(2, 2));

    const result = buffer.reconcile({
      acknowledgedInputSequence: 1,
      authoritativeBody: body(1),
      collisionRevisionVector: { '0,1,0': 4 },
      replay,
    });

    expect(result).toEqual({ body: body(2), replayed: 1, presentationOffset: { x: 0, y: 0, z: 0 }, resetReason: null });
    expect(buffer.frames.map((item) => item.sequence)).toEqual([2]);
  });

  it('keeps prediction when the authority provides unrelated extra collision revisions', () => {
    const buffer = new PredictionBuffer();
    buffer.record(frame(1));

    expect(
      buffer.reconcile({
        acknowledgedInputSequence: 0,
        authoritativeBody: body(0),
        collisionRevisionVector: { '0,1,0': 4, '1,1,0': 9 },
        replay,
      }),
    ).toEqual({ body: body(1), replayed: 1, presentationOffset: { x: 0, y: 0, z: 0 }, resetReason: null });
  });

  it('clears history before replay when its collision revisions are missing or different', () => {
    const buffer = new PredictionBuffer();
    buffer.record(frame(1));
    const replayed: InputCommand[] = [];

    const result = buffer.reconcile({
      acknowledgedInputSequence: 0,
      authoritativeBody: body(0),
      collisionRevisionVector: {},
      replay: (state, command) => {
        replayed.push(command);
        return replay(state, command);
      },
    });

    expect(result).toEqual({
      body: body(0),
      replayed: 0,
      presentationOffset: { x: 0, y: 0, z: 0 },
      resetReason: 'collision-history-missing',
    });
    expect(replayed).toEqual([]);
    expect(buffer.frames).toEqual([]);
  });

  it('uses an immediate correction and drops history when the replay error exceeds the smoothing bound', () => {
    const buffer = new PredictionBuffer({ maxSmoothError: 0.25 });
    buffer.record(frame(1, 10));

    const result = buffer.reconcile({
      acknowledgedInputSequence: 0,
      authoritativeBody: body(0),
      collisionRevisionVector: { '0,1,0': 4 },
      replay,
    });

    expect(result).toEqual({
      body: body(0),
      replayed: 0,
      presentationOffset: { x: 0, y: 0, z: 0 },
      resetReason: 'large-error',
    });
    expect(buffer.frames).toEqual([]);
  });

  it('rejects incoherent frame metadata and non-finite replay output', () => {
    const buffer = new PredictionBuffer();
    expect(() => buffer.record({ ...frame(1), targetPhysicsTick: 2 })).toThrow(
      'Prediction frame tick must match input tick.',
    );
    expect(() => buffer.record({ ...frame(1), input: input(2) })).toThrow(
      'Prediction frame sequence must match input sequence.',
    );
    expect(() => buffer.record({ ...frame(1), predictedBody: body(Number.NaN) })).toThrow(
      'Prediction body must be finite.',
    );

    buffer.record(frame(1));
    expect(() =>
      buffer.reconcile({
        acknowledgedInputSequence: 0,
        authoritativeBody: body(0),
        collisionRevisionVector: { '0,1,0': 4 },
        replay: () => body(Number.NaN),
      }),
    ).toThrow('Prediction body must be finite.');
    expect(buffer.frames.map((item) => item.sequence)).toEqual([1]);
  });

  it('resets bounded history on capacity and never partially commits a throwing replay', () => {
    const buffer = new PredictionBuffer({ maxFrames: 2 });
    buffer.record(frame(1));
    buffer.record(frame(2));
    expect(buffer.record(frame(3))).toBe('capacity-reset');
    expect(buffer.frames.map((item) => item.sequence)).toEqual([3]);
    buffer.record(frame(4));

    expect(() =>
      buffer.reconcile({
        acknowledgedInputSequence: 3,
        authoritativeBody: body(3),
        collisionRevisionVector: { '0,1,0': 4 },
        replay: () => {
          throw new Error('fixture replay failure');
        },
      }),
    ).toThrow('fixture replay failure');
    expect(buffer.frames.map((item) => item.sequence)).toEqual([3, 4]);
  });
});
