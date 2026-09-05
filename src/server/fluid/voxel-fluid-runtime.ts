import { Voxel } from '../../world/voxel';
import type { WorldCommitResult } from '../game-server-types';

export type FluidCell = { level: number; source: boolean };
export type FluidAdvanceResult = { steps: number; processed: number; pending: number; commits: WorldCommitResult[] };
type Position = readonly [number, number, number];
const STEP_SECONDS = 0.1;
const MAX_STEPS = 8;
const STEP_BUDGET = 128;
const MAX_QUEUE = 8_192;
const MIN_ACTIVE_Y = 0;
const MAX_ACTIVE_Y = 63;
const keyOf = (p: Position) => `${p[0]},${p[1]},${p[2]}`;
const horizontal = ([x, y, z]: Position): Position[] => [
  [x - 1, y, z],
  [x + 1, y, z],
  [x, y, z - 1],
  [x, y, z + 1],
];
const neighborhood = ([x, y, z]: Position): Position[] => [
  [x, y, z],
  [x, y - 1, z],
  [x, y + 1, z],
  ...horizontal([x, y, z]),
];

export class VoxelFluidRuntime {
  private readonly queue: Position[] = [];
  private readonly queued = new Set<string>();
  private readonly cleanupQueue: Position[] = [];
  private readonly cleanupQueued = new Set<string>();
  private accumulator = 0;
  constructor(
    private readonly callbacks: {
      getVoxel(position: Position): number | undefined;
      getCell(position: Position): FluidCell | null;
      setCell(position: Position, cell: FluidCell | null): void;
      edit(position: Position, value: number): WorldCommitResult;
    },
  ) {}
  activate(position: Position): boolean {
    return neighborhood(position).every((candidate) => this.enqueue(candidate));
  }
  removeSource(position: Position): void {
    for (const candidate of horizontal(position)) this.enqueueCleanup(candidate);
  }
  advance(seconds: number): FluidAdvanceResult {
    this.accumulator += Math.max(0, seconds);
    const requested = Math.floor(this.accumulator / STEP_SECONDS);
    const steps = Math.min(requested, MAX_STEPS);
    this.accumulator = requested > MAX_STEPS ? 0 : this.accumulator - steps * STEP_SECONDS;
    const commits: WorldCommitResult[] = [];
    let processed = 0;
    for (let step = 0; step < steps; step += 1) {
      let remaining = STEP_BUDGET;
      while (remaining > 0 && this.cleanupQueue.length) {
        const position = this.cleanupQueue.shift()!;
        this.cleanupQueued.delete(keyOf(position));
        remaining -= 1;
        processed += 1;
        const cell = this.callbacks.getCell(position);
        if (this.callbacks.getVoxel(position) !== Voxel.Water || !cell) continue;
        if (cell.source) {
          this.activate(position);
          continue;
        }
        this.callbacks.setCell(position, null);
        const commit = this.callbacks.edit(position, Voxel.Air);
        if (commit.committed) commits.push(commit);
        for (const candidate of neighborhood(position)) this.enqueueCleanup(candidate);
      }
      const count = Math.min(this.queue.length, remaining);
      for (let index = 0; index < count; index += 1) {
        const position = this.queue.shift()!;
        this.queued.delete(keyOf(position));
        processed += 1;
        this.process(position, commits);
      }
    }
    return { steps, processed, pending: this.queue.length + this.cleanupQueue.length, commits };
  }
  private process(position: Position, commits: WorldCommitResult[]): void {
    if (this.callbacks.getVoxel(position) !== Voxel.Water) return;
    const cell = this.callbacks.getCell(position) ?? { level: 8, source: true };
    if (!cell.source) {
      let desired = this.suppliedLevel(position);
      const [x, y, z] = position;
      const above: Position = [x, y + 1, z];
      const verticallySupplied = this.callbacks.getVoxel(above) === Voxel.Water;
      const hasStrongerSide = horizontal(position).some((candidate) => {
        if (this.callbacks.getVoxel(candidate) !== Voxel.Water) return false;
        return (this.callbacks.getCell(candidate)?.level ?? 8) > cell.level;
      });
      if (!verticallySupplied && !hasStrongerSide) desired = Math.min(desired, cell.level - 1);
      if (desired <= 0) {
        this.callbacks.setCell(position, null);
        const commit = this.callbacks.edit(position, Voxel.Air);
        if (commit.committed) commits.push(commit);
        this.activate(position);
        return;
      }
      if (desired !== cell.level) {
        this.callbacks.setCell(position, { level: desired, source: false });
        const commit = this.callbacks.edit(position, Voxel.Water);
        if (commit.committed) commits.push(commit);
      }
    }
    const [x, y, z] = position;
    const below: Position = [x, y - 1, z];
    if (this.callbacks.getVoxel(below) === Voxel.Air) {
      this.place(below, 8, commits);
      this.enqueue(position);
      return;
    }
    if (this.callbacks.getVoxel(below) === Voxel.Water) return;
    const level = this.callbacks.getCell(position)?.level ?? 8;
    if (level <= 1) return;
    for (const target of horizontal(position)) {
      const voxel = this.callbacks.getVoxel(target);
      const targetCell = voxel === Voxel.Water ? this.callbacks.getCell(target) : null;
      if (voxel === Voxel.Air || (targetCell && !targetCell.source && targetCell.level < level - 1))
        this.place(target, level - 1, commits);
    }
  }
  private suppliedLevel([x, y, z]: Position): number {
    const above: Position = [x, y + 1, z];
    if (this.callbacks.getVoxel(above) === Voxel.Water) return 8;
    let best = 0;
    for (const candidate of horizontal([x, y, z])) {
      if (this.callbacks.getVoxel(candidate) !== Voxel.Water) continue;
      const neighbor = this.callbacks.getCell(candidate) ?? { level: 8, source: true };
      best = Math.max(best, neighbor.level - 1);
    }
    return best;
  }
  private place(position: Position, level: number, commits: WorldCommitResult[]): void {
    this.callbacks.setCell(position, { level, source: false });
    const commit = this.callbacks.edit(position, Voxel.Water);
    if (commit.committed) commits.push(commit);
    this.activate(position);
  }
  private enqueue(position: Position): boolean {
    if (position[1] < MIN_ACTIVE_Y || position[1] > MAX_ACTIVE_Y) return true;
    const key = keyOf(position);
    if (this.queued.has(key)) return true;
    if (this.queue.length >= MAX_QUEUE) return false;
    this.queued.add(key);
    this.queue.push(position);
    return true;
  }
  private enqueueCleanup(position: Position): void {
    if (position[1] < MIN_ACTIVE_Y || position[1] > MAX_ACTIVE_Y || this.cleanupQueue.length >= MAX_QUEUE) return;
    const key = keyOf(position);
    if (!this.cleanupQueued.has(key)) {
      this.cleanupQueued.add(key);
      this.cleanupQueue.push(position);
    }
  }
}
