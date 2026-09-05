import { bodyConfigFor, type BodyKind } from '../../physics/body-registry';
import {
  MAX_LOGIC_TERRAIN_AXIS,
  MAX_LOGIC_TERRAIN_CELLS,
  type LogicPosition,
  type TerrainWindow,
} from './logic-protocol';

const EPSILON = 1e-6;
const MAX_NAVIGATION_NODES = 128;

type CellSample = 'free' | 'solid' | 'unknown';
type Node = Readonly<{ x: number; y: number; z: number; g: number; f: number; parent: string | null }>;
export type NavigationStep = Readonly<{ wish: { x: number; z: number }; jumpRequested: boolean }>;

const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
const finiteTuple = (value: readonly number[]) => value.length === 3 && value.every(Number.isFinite);
const overlaps = (left: TerrainWindow, right: TerrainWindow) =>
  [0, 1, 2].every(
    (axis) =>
      left.origin[axis] < right.origin[axis] + right.size[axis] &&
      right.origin[axis] < left.origin[axis] + left.size[axis],
  );

export function validateTerrainWindows(terrainWindows: readonly TerrainWindow[]): void {
  const keys = new Set<string>();
  terrainWindows.forEach((terrainWindow, index) => {
    if (!terrainWindow.key.trim() || keys.has(terrainWindow.key))
      throw new TypeError('Terrain window key must be unique and non-empty.');
    keys.add(terrainWindow.key);
    if (!Number.isInteger(terrainWindow.chunkRevision) || terrainWindow.chunkRevision < 0)
      throw new TypeError('Terrain window revision must be a non-negative integer.');
    if (!finiteTuple(terrainWindow.origin) || !terrainWindow.origin.every(Number.isInteger))
      throw new TypeError('Terrain window origin must contain three integers.');
    if (
      !finiteTuple(terrainWindow.size) ||
      !terrainWindow.size.every((size) => Number.isInteger(size) && size > 0 && size <= MAX_LOGIC_TERRAIN_AXIS)
    )
      throw new TypeError('Terrain window size must contain positive axes no larger than 32.');
    const cells = terrainWindow.size[0] * terrainWindow.size[1] * terrainWindow.size[2];
    if (cells > MAX_LOGIC_TERRAIN_CELLS) throw new TypeError('Terrain window contains too many cells.');
    if (!(terrainWindow.occupancy instanceof Uint8Array) || terrainWindow.occupancy.length !== cells)
      throw new TypeError('Terrain window occupancy length does not match its size.');
    for (let other = 0; other < index; other += 1)
      if (overlaps(terrainWindow, terrainWindows[other])) throw new TypeError('Terrain windows must not overlap.');
  });
}

export class LogicTerrain {
  private readonly reads = new Map<string, number>();
  private missing = false;

  constructor(private readonly terrainWindows: readonly TerrainWindow[]) {
    validateTerrainWindows(terrainWindows);
  }

  get hasMissingData(): boolean {
    return this.missing;
  }

  readRevisions(): Array<{ key: string; revision: number }> {
    return [...this.reads.entries()]
      .map(([key, revision]) => ({ key, revision }))
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  sample(x: number, y: number, z: number): CellSample {
    const terrainWindow = this.terrainWindows.find(
      (candidate) =>
        x >= candidate.origin[0] &&
        x < candidate.origin[0] + candidate.size[0] &&
        y >= candidate.origin[1] &&
        y < candidate.origin[1] + candidate.size[1] &&
        z >= candidate.origin[2] &&
        z < candidate.origin[2] + candidate.size[2],
    );
    if (!terrainWindow) {
      this.missing = true;
      return 'unknown';
    }
    this.reads.set(terrainWindow.key, terrainWindow.chunkRevision);
    const localX = x - terrainWindow.origin[0];
    const localY = y - terrainWindow.origin[1];
    const localZ = z - terrainWindow.origin[2];
    const index = terrainOccupancyIndex(terrainWindow.size, localX, localY, localZ);
    return terrainWindow.occupancy[index] === 0 ? 'free' : 'solid';
  }

  lineOfSight(from: LogicPosition, to: LogicPosition): boolean {
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const samples = Math.max(1, Math.ceil(distance / 0.25));
    for (let index = 1; index < samples; index += 1) {
      const ratio = index / samples;
      if (
        this.sample(
          Math.floor(from[0] + (to[0] - from[0]) * ratio),
          Math.floor(from[1] + (to[1] - from[1]) * ratio + 0.8),
          Math.floor(from[2] + (to[2] - from[2]) * ratio),
        ) !== 'free'
      )
        return false;
    }
    return true;
  }

  nextStep(kind: BodyKind, start: LogicPosition, target: LogicPosition): NavigationStep | null {
    const resolvedStart = this.resolve(kind, start);
    const resolvedTarget = this.resolve(kind, target);
    if (!resolvedStart || !resolvedTarget || this.missing) return null;
    const targetKey = cellKey(resolvedTarget.x, resolvedTarget.y, resolvedTarget.z);
    const startKey = cellKey(resolvedStart.x, resolvedStart.y, resolvedStart.z);
    const open = new Map<string, Node>([
      [
        startKey,
        {
          ...resolvedStart,
          g: 0,
          f: this.heuristic(resolvedStart, resolvedTarget),
          parent: null,
        },
      ],
    ]);
    const visited = new Map<string, Node>();
    let expanded = 0;
    while (open.size > 0 && expanded < MAX_NAVIGATION_NODES) {
      const current = [...open.values()].sort(
        (left, right) =>
          left.f - right.f ||
          left.g - right.g ||
          cellKey(left.x, left.y, left.z).localeCompare(cellKey(right.x, right.y, right.z)),
      )[0];
      const currentKey = cellKey(current.x, current.y, current.z);
      open.delete(currentKey);
      visited.set(currentKey, current);
      expanded += 1;
      if (currentKey === targetKey) {
        this.missing = false;
        return this.firstStep(current, visited);
      }
      for (const next of this.neighbors(kind, current)) {
        const nextKey = cellKey(next.x, next.y, next.z);
        if (visited.has(nextKey)) continue;
        const g = current.g + 1 + Math.abs(next.y - current.y) * 0.25;
        const existing = open.get(nextKey);
        if (existing && existing.g <= g) continue;
        open.set(nextKey, {
          ...next,
          g,
          f: g + this.heuristic(next, resolvedTarget),
          parent: currentKey,
        });
      }
    }
    return null;
  }

  private resolve(kind: BodyKind, source: LogicPosition): Pick<Node, 'x' | 'y' | 'z'> | null {
    if (!finiteTuple(source)) throw new TypeError('Logic navigation position is invalid.');
    const x = Math.floor(source[0]);
    const z = Math.floor(source[2]);
    const baseY = Math.floor(source[1]);
    for (const offset of [0, -1, 1, -2, 2]) {
      const node = { x, y: baseY + offset, z };
      if (this.walkable(kind, node)) return node;
      if (this.missing) return null;
    }
    return null;
  }

  private neighbors(kind: BodyKind, current: Pick<Node, 'x' | 'y' | 'z'>) {
    const result: Array<Pick<Node, 'x' | 'y' | 'z'>> = [];
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      for (const dy of [0, 1, -1]) {
        const candidate = { x: current.x + dx, y: current.y + dy, z: current.z + dz };
        const previouslyMissing = this.missing;
        this.missing = false;
        if (!this.walkable(kind, candidate)) {
          this.missing ||= previouslyMissing;
          continue;
        }
        this.missing ||= previouslyMissing;
        result.push(candidate);
        break;
      }
    }
    return result;
  }

  private walkable(kind: BodyKind, node: Pick<Node, 'x' | 'y' | 'z'>): boolean {
    const config = bodyConfigFor(kind);
    const position = { x: node.x + 0.5, y: node.y, z: node.z + 0.5 };
    const minimum = {
      x: Math.floor(position.x + config.localAabb.min.x + EPSILON),
      y: Math.floor(position.y + config.localAabb.min.y + EPSILON),
      z: Math.floor(position.z + config.localAabb.min.z + EPSILON),
    };
    const maximum = {
      x: Math.floor(position.x + config.localAabb.max.x - EPSILON),
      y: Math.floor(position.y + config.localAabb.max.y - EPSILON),
      z: Math.floor(position.z + config.localAabb.max.z - EPSILON),
    };
    for (let y = minimum.y; y <= maximum.y; y += 1)
      for (let z = minimum.z; z <= maximum.z; z += 1)
        for (let x = minimum.x; x <= maximum.x; x += 1) if (this.sample(x, y, z) !== 'free') return false;

    const supportY = Math.floor(position.y + config.localAabb.min.y - EPSILON);
    for (let z = minimum.z; z <= maximum.z; z += 1)
      for (let x = minimum.x; x <= maximum.x; x += 1) {
        const sample = this.sample(x, supportY, z);
        if (sample === 'solid') return true;
        if (sample === 'unknown') return false;
      }
    return false;
  }

  private heuristic(left: Pick<Node, 'x' | 'y' | 'z'>, right: Pick<Node, 'x' | 'y' | 'z'>) {
    return Math.abs(left.x - right.x) + Math.abs(left.z - right.z) + Math.abs(left.y - right.y) * 0.25;
  }

  private firstStep(end: Node, visited: ReadonlyMap<string, Node>): NavigationStep {
    let current = end;
    let parent = current.parent ? visited.get(current.parent) : undefined;
    while (parent?.parent) {
      current = parent;
      parent = visited.get(parent.parent);
    }
    if (!parent) return { wish: { x: 0, z: 0 }, jumpRequested: false };
    const dx = current.x - parent.x;
    const dz = current.z - parent.z;
    const length = Math.hypot(dx, dz) || 1;
    return {
      wish: { x: dx / length, z: dz / length },
      jumpRequested: current.y > parent.y,
    };
  }
}

export function terrainOccupancyIndex(size: LogicPosition, localX: number, localY: number, localZ: number): number {
  return localX + size[0] * (localZ + size[2] * localY);
}
