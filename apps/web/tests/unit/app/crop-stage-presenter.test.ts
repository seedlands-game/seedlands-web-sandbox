import { describe, expect, it, vi } from 'vitest';
import { CHUNK_SIZE, chunkKey } from '@seedlands/stdlib/world/voxel';
import type { AuthorityCropStageProjection } from '../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import type {
  PackPresentationCrop,
  PackPresentationCropStage,
} from '../../../src/client/presentation/pack-presentation-loader';
import { CropStagePresenter } from '../../../src/app/world/crop-stage-presenter';

type Batch = Readonly<{
  chunkKey: string;
  cx: number;
  cy: number;
  cz: number;
  presentationId: string;
  stage: number;
  definition: PackPresentationCropStage;
  positions: readonly (readonly [number, number, number])[];
}>;
type Resource = Readonly<{ id: number; batch: Batch }>;

const definition = (id = 'sample:crop'): PackPresentationCrop => ({
  id,
  stages: Array.from({ length: 8 }, (_, stage) => ({
    texture: `crop/${stage}.svg`,
    height: 0.4 + stage / 10,
    width: 0.3,
  })),
});
const projection = (
  position: readonly [number, number, number],
  stage = 0,
  presentationId = 'sample:crop',
): AuthorityCropStageProjection => ({ position, stage, presentationId });
const catalog = { 'sample:crop': definition() };

function fixture(createResource?: (batch: Batch, id: number) => Resource) {
  let nextId = 1;
  const live = new Map<number, Resource>();
  const create = vi.fn((batch: Batch) => {
    const resource = createResource?.(batch, nextId) ?? { id: nextId, batch };
    nextId += 1;
    live.set(resource.id, resource);
    return resource;
  });
  const destroy = vi.fn((resource: Resource) => {
    live.delete(resource.id);
  });
  return {
    presenter: new CropStagePresenter(catalog, { create, destroy }),
    create,
    destroy,
    live,
  };
}

describe('CropStagePresenter', () => {
  it('ignores empty, legacy, and nonresident projections', () => {
    const test = fixture();
    test.presenter.update('epoch-a', [], []);
    test.presenter.update('epoch-a', [{ position: [1, 2, 3], stage: 0 }, projection([1, 2, 3])], []);

    expect(test.create).not.toHaveBeenCalled();
    expect(test.destroy).not.toHaveBeenCalled();
    expect(test.live.size).toBe(0);
  });

  it('batches resident same-stage crops, copies positions, and reuses an unchanged signature', () => {
    const test = fixture();
    const first: [number, number, number] = [1, 4, 2];
    const second: [number, number, number] = [2, 4, 3];
    const stage1: [number, number, number] = [3, 4, 4];
    const projections = [projection(first), projection(second), projection(stage1, 1)];
    const resident = new Set([chunkKey(0, 0, 0)]);
    test.presenter.update('epoch-a', projections, resident);
    expect(test.create).toHaveBeenCalledTimes(2);
    const stage0 = test.create.mock.calls.find(([batch]) => batch.stage === 0)?.[0];
    expect(stage0).toMatchObject({
      chunkKey: chunkKey(0, 0, 0),
      cx: 0,
      cy: 0,
      cz: 0,
      presentationId: 'sample:crop',
      stage: 0,
      definition: catalog['sample:crop'].stages[0],
      positions: [first, second],
    });
    expect(Object.isFrozen(stage0?.positions)).toBe(true);
    first[0] = 29;
    projections.splice(0, projections.length);

    test.presenter.update('epoch-a', [projection([1, 4, 2]), projection([2, 4, 3]), projection(stage1, 1)], resident);

    expect(test.create).toHaveBeenCalledTimes(2);
    expect(test.destroy).not.toHaveBeenCalled();
    expect(test.live.size).toBe(2);
    expect(stage0?.positions).toEqual([
      [1, 4, 2],
      [2, 4, 3],
    ]);
  });

  it('uses floor-divided negative and boundary chunk coordinates and unloads absent chunks', () => {
    const test = fixture();
    const positions: readonly (readonly [number, number, number])[] = [
      [-1, 0, -CHUNK_SIZE],
      [0, 0, 0],
      [CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE - 1],
      [CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE],
    ];
    const resident = new Set([chunkKey(-1, 0, -1), chunkKey(0, 0, 0), chunkKey(0, 1, 0), chunkKey(1, 1, 1)]);
    test.presenter.update(
      'epoch-a',
      positions.map((position) => projection(position)),
      resident,
    );

    expect(test.create.mock.calls.map(([batch]) => batch.chunkKey).sort()).toEqual([...resident].sort());
    expect(test.create.mock.calls.map(([batch]) => [batch.cx, batch.cy, batch.cz]).sort()).toEqual(
      [
        [-1, 0, -1],
        [0, 0, 0],
        [0, 1, 0],
        [1, 1, 1],
      ].sort(),
    );

    test.presenter.update(
      'epoch-a',
      positions.map((position) => projection(position)),
      new Set([chunkKey(0, 0, 0)]),
    );

    expect(test.live.size).toBe(1);
    expect(test.destroy).toHaveBeenCalledTimes(3);
  });

  it('rebuilds for growth, deletes removed crops, and clears resources on epoch changes', () => {
    const test = fixture();
    const resident = new Set([chunkKey(0, 0, 0)]);
    test.presenter.update('epoch-a', [projection([4, 2, 5], 0)], resident);
    const stage0 = test.create.mock.calls[0]![0];

    test.presenter.update('epoch-a', [projection([4, 2, 5], 7)], resident);
    expect(test.destroy).toHaveBeenCalledWith(expect.objectContaining({ batch: stage0 }));
    expect(test.create).toHaveBeenCalledTimes(2);
    expect(test.create.mock.calls[1]![0].stage).toBe(7);

    test.presenter.update('epoch-a', [], resident);
    expect(test.live.size).toBe(0);
    expect(test.destroy).toHaveBeenCalledTimes(2);

    test.presenter.update('epoch-a', [projection([4, 2, 5])], resident);
    test.presenter.update('epoch-b', [projection([4, 2, 5])], resident);
    expect(test.live.size).toBe(1);
    expect(test.destroy).toHaveBeenCalledTimes(3);

    test.presenter.clear();
    expect(test.live.size).toBe(0);
    expect(test.destroy).toHaveBeenCalledTimes(4);
    test.presenter.dispose();
    test.presenter.update('epoch-c', [projection([4, 2, 5])], resident);
    expect(test.live.size).toBe(0);
    expect(test.create).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['unknown presentation', [projection([0, 0, 0], 0, 'sample:unknown')]],
    ['invalid stage', [projection([0, 0, 0], 8)]],
    ['noninteger position', [projection([0.5, 0, 0])]],
    ['nonfinite position', [projection([Number.NaN, 0, 0])]],
  ])('fails closed and clears prior resources for %s', (_label, invalid) => {
    const test = fixture();
    const resident = new Set([chunkKey(0, 0, 0)]);
    test.presenter.update('epoch-a', [projection([1, 0, 0])], resident);

    expect(() => test.presenter.update('epoch-a', invalid, resident)).toThrow();

    expect(test.live.size).toBe(0);
    expect(test.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys old and partially-created batches when adapter creation fails', () => {
    const test = fixture((batch, id) => {
      if (batch.stage === 7) throw new Error('adapter creation failed');
      return { id, batch };
    });
    test.presenter.update('epoch-a', [projection([0, 0, 0], 0)], [chunkKey(0, 0, 0)]);

    expect(() =>
      test.presenter.update('epoch-a', [projection([1, 0, 0], 0), projection([2, 0, 0], 7)], [chunkKey(0, 0, 0)]),
    ).toThrow('adapter creation failed');

    expect(test.live.size).toBe(0);
    expect(test.destroy).toHaveBeenCalledTimes(2);
  });
});
