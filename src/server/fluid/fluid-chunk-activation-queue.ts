import { CHUNK_SIZE, Voxel } from '../../world/voxel';
import type { ServerChunk } from '../game-server-types';

type Position = [number, number, number];
type Job = { chunk: ServerChunk; cursor: number };
const CELL_COUNT = CHUNK_SIZE ** 3;
const BOUNDARY_COUNT = 6 * CHUNK_SIZE ** 2;
const SCAN_BUDGET = 2_048;

export class FluidChunkActivationQueue {
  private readonly jobs = new Map<string, Job>();
  private activeKeys = new Set<string>();
  private rotation = 0;

  setActiveKeys(keys: readonly string[]): void {
    this.activeKeys = new Set(keys);
    for (const key of this.jobs.keys()) if (!this.activeKeys.has(key)) this.jobs.delete(key);
  }
  sync(keys: readonly string[], chunks: Map<string, ServerChunk>): void {
    this.setActiveKeys(keys);
    keys.forEach((key) => {
      const chunk = chunks.get(key);
      if (chunk) this.schedule(chunk);
    });
  }
  schedule(chunk: ServerChunk): void {
    if (this.activeKeys.has(chunk.key) && !this.jobs.has(chunk.key)) this.jobs.set(chunk.key, { chunk, cursor: 0 });
  }
  pump(activate: (position: Position) => boolean, peekVoxel: (...position: Position) => number | undefined): void {
    const jobs = [...this.jobs.entries()];
    if (!jobs.length) return;
    let remaining = SCAN_BUDGET;
    let index = this.rotation++ % jobs.length;
    while (remaining-- > 0 && jobs.length) {
      const [key, job] = jobs[index];
      const position = this.positionAt(job, peekVoxel);
      if (position && !activate(position)) break;
      job.cursor += 1;
      if (job.cursor >= BOUNDARY_COUNT + CELL_COUNT) {
        this.jobs.delete(key);
        jobs.splice(index, 1);
        if (!jobs.length) break;
        index %= jobs.length;
      } else index = (index + 1) % jobs.length;
    }
  }
  pumpRuntime(
    runtime: { activate: (position: Position) => boolean },
    access: { peekVoxel: (...position: Position) => number | undefined },
  ): void {
    this.pump(
      (position) => runtime.activate(position),
      (...position) => access.peekVoxel(...position),
    );
  }
  private positionAt(
    { cursor, chunk }: Job,
    peekVoxel: (...position: Position) => number | undefined,
  ): Position | null {
    if (cursor < BOUNDARY_COUNT) {
      const face = Math.floor(cursor / CHUNK_SIZE ** 2);
      const offset = cursor % CHUNK_SIZE ** 2;
      const a = offset % CHUNK_SIZE;
      const b = Math.floor(offset / CHUNK_SIZE);
      const min = [chunk.cx * CHUNK_SIZE, chunk.cy * CHUNK_SIZE, chunk.cz * CHUNK_SIZE] as Position;
      let position: Position;
      if (face === 0) position = [min[0] - 1, min[1] + a, min[2] + b];
      else if (face === 1) position = [min[0] + CHUNK_SIZE, min[1] + a, min[2] + b];
      else if (face === 2) position = [min[0] + a, min[1] - 1, min[2] + b];
      else if (face === 3) position = [min[0] + a, min[1] + CHUNK_SIZE, min[2] + b];
      else if (face === 4) position = [min[0] + a, min[1] + b, min[2] - 1];
      else position = [min[0] + a, min[1] + b, min[2] + CHUNK_SIZE];
      return peekVoxel(...position) === Voxel.Water ? position : null;
    }
    const cell = cursor - BOUNDARY_COUNT;
    if (chunk.voxels[cell] !== Voxel.Water) return null;
    const y = Math.floor(cell / (CHUNK_SIZE * CHUNK_SIZE));
    const remainder = cell - y * CHUNK_SIZE * CHUNK_SIZE;
    const z = Math.floor(remainder / CHUNK_SIZE);
    const x = remainder - z * CHUNK_SIZE;
    return [chunk.cx * CHUNK_SIZE + x, chunk.cy * CHUNK_SIZE + y, chunk.cz * CHUNK_SIZE + z];
  }
}
