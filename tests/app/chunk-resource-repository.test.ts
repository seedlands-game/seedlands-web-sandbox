import { describe, expect, it, vi } from 'vitest';
import { ChunkResourceRepository, type ChunkResourceAdapter } from '../../src/app/chunk-resource-repository';

type Task = {
  taskId: number;
  chunkKey: string;
  cx: number;
  cy: number;
  cz: number;
};

type Resource = {
  destroyed: number;
  postrender: (() => void) | null;
  transitionDone: (() => void) | null;
};

const task = (taskId: number): Task => ({ taskId, chunkKey: '0,0,0', cx: 0, cy: 0, cz: 0 });

const createAdapter = (): ChunkResourceAdapter<Task, string, Resource> => ({
  create: () => ({ destroyed: 0, postrender: null, transitionDone: null }),
  commitPart: () => undefined,
  attach: (resource, _task, onPostrender) => {
    resource.postrender = onPostrender;
  },
  destroy: (resource) => {
    resource.destroyed += 1;
  },
});

const createRepository = (adapter: ChunkResourceAdapter<Task, string, Resource>, isCurrent = () => true) =>
  new ChunkResourceRepository({
    adapter,
    isCurrent,
    profile: { maxMeshCommitsPerFrame: 2, maxMeshPartsPerFrame: 8, maxCommitMs: 10 },
    now: () => 0,
    summarize: () => ({ triangles: 0, drawCalls: 0, meshBytes: 0 }),
    onVisible: vi.fn(),
    onDiscard: vi.fn(),
  });

describe('ChunkResourceRepository', () => {
  it('does not attach after dispose wins a postrender race and destroys once', () => {
    const adapter = createAdapter();
    const repository = createRepository(adapter);
    const resource = repository.enqueue(task(1), ['mesh']);
    repository.beginFrame();
    repository.drain();
    expect(resource.postrender).not.toBeNull();

    repository.dispose();
    resource.postrender?.();
    repository.dispose();

    expect(repository.chunks.size).toBe(0);
    expect(resource.destroyed).toBe(1);
  });

  it('destroys an attached resource once across repeated unload and dispose', () => {
    const adapter = createAdapter();
    const repository = createRepository(adapter);
    const resource = repository.enqueue(task(1), ['mesh']);
    repository.beginFrame();
    repository.drain();
    resource.postrender?.();
    expect(repository.chunks.size).toBe(1);

    repository.unload('0,0,0');
    repository.unload('0,0,0');
    repository.dispose();

    expect(resource.destroyed).toBe(1);
  });

  it('keeps the previous resource alive until a replacement transition completes', () => {
    const prepared = vi.fn();
    const transitioned = vi.fn();
    const adapter = createAdapter();
    adapter.prepareReplacement = (previous, current) => {
      prepared(previous, current);
      return true;
    };
    adapter.transitionReplacement = (previous, current, _task, done) => {
      transitioned(previous, current);
      current.transitionDone = done;
    };
    const repository = createRepository(adapter);
    const previous = repository.enqueue(task(1), ['mesh']);
    repository.beginFrame();
    repository.drain();
    previous.postrender?.();

    const current = repository.enqueue(task(2), ['mesh']);
    repository.beginFrame();
    repository.drain();
    expect(prepared).toHaveBeenCalledWith(previous, current);
    current.postrender?.();

    expect(transitioned).toHaveBeenCalledWith(previous, current);
    expect(previous.destroyed).toBe(0);
    expect(repository.chunks.get('0,0,0')?.resource).toBe(current);
    current.transitionDone?.();
    expect(previous.destroyed).toBe(1);
  });
});
