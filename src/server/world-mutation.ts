import { CHUNK_SIZE, Voxel, floorDiv } from '../world/voxel';

export type VoxelEdit = { x: number; y: number; z: number; value: number };
export type WorldMutationBufferOptions = {
  sourceId: string;
  priority?: number;
  initialCapacity?: number;
};
export type MutationChunkRun = {
  cx: number;
  cy: number;
  cz: number;
  start: number;
  end: number;
};

const COORDINATE_COMPONENTS = 3;
const MIN_INT32 = -(2 ** 31);
const MAX_INT32 = 2 ** 31 - 1;
const BYTES_PER_MUTATION = Int32Array.BYTES_PER_ELEMENT * COORDINATE_COMPONENTS + Uint16Array.BYTES_PER_ELEMENT;

export function assertMutationCoordinate(value: number): void {
  if (!Number.isInteger(value) || value < MIN_INT32 || value > MAX_INT32)
    throw new RangeError(`Mutation coordinate must be an int32, received ${String(value)}.`);
}

export function assertVoxelValue(value: number): void {
  if (!Number.isInteger(value) || value < Voxel.Air || value > Voxel.Water)
    throw new RangeError(`Mutation voxel must be a registered voxel id, received ${String(value)}.`);
}

export class WorldMutationBuffer {
  readonly sourceId: string;
  readonly priority: number;
  private coordinates: Int32Array;
  private values: Uint16Array;
  private length = 0;
  private coordinateUniquenessGuaranteed = false;
  private readonly runs: MutationChunkRun[] = [];

  constructor({ sourceId, priority = 0, initialCapacity = 16 }: WorldMutationBufferOptions) {
    if (!sourceId.trim()) throw new TypeError('Mutation buffer sourceId must not be empty.');
    if (!Number.isSafeInteger(priority)) throw new RangeError('Mutation buffer priority must be a safe integer.');
    if (!Number.isSafeInteger(initialCapacity) || initialCapacity < 0)
      throw new RangeError('Mutation buffer initialCapacity must be a non-negative safe integer.');
    this.sourceId = sourceId;
    this.priority = priority;
    this.coordinates = new Int32Array(initialCapacity * COORDINATE_COMPONENTS);
    this.values = new Uint16Array(initialCapacity);
  }

  get count(): number {
    return this.length;
  }

  get payloadBytes(): number {
    return this.length * BYTES_PER_MUTATION;
  }

  get capacityBytes(): number {
    return this.values.length * BYTES_PER_MUTATION;
  }

  get hasUniqueCoordinates(): boolean {
    return this.coordinateUniquenessGuaranteed;
  }

  get chunkRuns(): readonly MutationChunkRun[] {
    return this.runs;
  }

  static forUniqueCoordinates(options: WorldMutationBufferOptions): WorldMutationBuffer {
    const buffer = new WorldMutationBuffer(options);
    buffer.coordinateUniquenessGuaranteed = true;
    return buffer;
  }

  write(x: number, y: number, z: number, value: number): this {
    assertMutationCoordinate(x);
    assertMutationCoordinate(y);
    assertMutationCoordinate(z);
    assertVoxelValue(value);
    this.ensureCapacity(this.length + 1);
    const offset = this.length * COORDINATE_COMPONENTS;
    this.coordinates[offset] = x;
    this.coordinates[offset + 1] = y;
    this.coordinates[offset + 2] = z;
    this.values[this.length] = value;
    if (this.coordinateUniquenessGuaranteed) {
      const cx = floorDiv(x, CHUNK_SIZE);
      const cy = floorDiv(y, CHUNK_SIZE);
      const cz = floorDiv(z, CHUNK_SIZE);
      const run = this.runs.at(-1);
      if (run && run.cx === cx && run.cy === cy && run.cz === cz) run.end = this.length + 1;
      else this.runs.push({ cx, cy, cz, start: this.length, end: this.length + 1 });
    }
    this.length += 1;
    return this;
  }

  forEach(callback: (x: number, y: number, z: number, value: number, index: number) => void): void {
    this.forEachRange(0, this.length, callback);
  }

  forEachRange(
    start: number,
    end: number,
    callback: (x: number, y: number, z: number, value: number, index: number) => void,
  ): void {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > this.length)
      throw new RangeError('Mutation buffer range is outside the populated payload.');
    for (let index = start; index < end; index += 1) {
      const offset = index * COORDINATE_COMPONENTS;
      callback(
        this.coordinates[offset],
        this.coordinates[offset + 1],
        this.coordinates[offset + 2],
        this.values[index],
        index,
      );
    }
  }

  private ensureCapacity(required: number): void {
    if (required <= this.values.length) return;
    const capacity = Math.max(required, Math.max(1, this.values.length * 2));
    const coordinates = new Int32Array(capacity * COORDINATE_COMPONENTS);
    const values = new Uint16Array(capacity);
    coordinates.set(this.coordinates);
    values.set(this.values);
    this.coordinates = coordinates;
    this.values = values;
  }
}
