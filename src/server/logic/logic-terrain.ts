import { bodyConfigFor, type BodyKind } from '../../physics/body-registry';
import {
  MAX_LOGIC_TERRAIN_AXIS,
  MAX_LOGIC_TERRAIN_CELLS,
  type LogicPosition,
  type TerrainWindow,
} from './logic-protocol';

const EPSILON = 1e-6;
const MAX_NAVIGATION_NODES = 128;
const validatedTerrainSignatures = new WeakMap<readonly TerrainWindow[], string>();
const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

type CellSample = 'free' | 'solid' | 'unknown';
export type NavigationPriority = Readonly<{ f: number; g: number; key: string }>;
type Node = NavigationPriority & Readonly<{ x: number; y: number; z: number; parent: string | null }>;
export type NavigationStep = Readonly<{ wish: { x: number; z: number }; jumpRequested: boolean }>;

const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
const finiteTuple = (value: readonly number[]) => value.length === 3 && value.every(Number.isFinite);
const objectId = (value: object) => {
  const existing = objectIds.get(value);
  if (existing !== undefined) return existing;
  const created = nextObjectId++;
  objectIds.set(value, created);
  return created;
};
const terrainSignature = (terrainWindows: readonly TerrainWindow[]) =>
  terrainWindows
    .map((terrainWindow) =>
      JSON.stringify([
        objectId(terrainWindow),
        terrainWindow.key,
        terrainWindow.chunkRevision,
        terrainWindow.origin,
        terrainWindow.size,
        objectId(terrainWindow.occupancy),
        terrainWindow.occupancy.length,
      ]),
    )
    .join('|');

export const terrainWindowsOverlap = (left: TerrainWindow, right: TerrainWindow): boolean =>
  left.origin[0] < right.origin[0] + right.size[0] &&
  right.origin[0] < left.origin[0] + left.size[0] &&
  left.origin[1] < right.origin[1] + right.size[1] &&
  right.origin[1] < left.origin[1] + left.size[1] &&
  left.origin[2] < right.origin[2] + right.size[2] &&
  right.origin[2] < left.origin[2] + left.size[2];

export type TerrainOverlapValidationMode = 'pairs' | 'cell-set';

export function terrainOverlapValidationMode(windowCount: number, totalCells: number): TerrainOverlapValidationMode {
  if (!Number.isSafeInteger(windowCount) || windowCount < 0 || !Number.isSafeInteger(totalCells) || totalCells < 0)
    throw new TypeError('Terrain overlap validation counts must be non-negative safe integers.');
  const pairCount = (windowCount * (windowCount - 1)) / 2;
  return !Number.isSafeInteger(pairCount) || pairCount > totalCells ? 'cell-set' : 'pairs';
}

const addTerrainWindowCells = (terrainWindow: TerrainWindow, occupiedCells: Set<string>): boolean => {
  for (let z = terrainWindow.origin[2]; z < terrainWindow.origin[2] + terrainWindow.size[2]; z += 1)
    for (let y = terrainWindow.origin[1]; y < terrainWindow.origin[1] + terrainWindow.size[1]; y += 1)
      for (let x = terrainWindow.origin[0]; x < terrainWindow.origin[0] + terrainWindow.size[0]; x += 1) {
        const key = cellKey(x, y, z);
        if (occupiedCells.has(key)) return false;
        occupiedCells.add(key);
      }
  return true;
};

export const compareNavigationPriority = (left: NavigationPriority, right: NavigationPriority): number =>
  left.f - right.f || left.g - right.g || left.key.localeCompare(right.key);

export function selectNavigationOpenNode<T extends NavigationPriority>(nodes: Iterable<T>): T | undefined {
  let selected: T | undefined;
  for (const node of nodes) if (!selected || compareNavigationPriority(node, selected) < 0) selected = node;
  return selected;
}

export function validateTerrainWindows(terrainWindows: readonly TerrainWindow[]): void {
  const keys = new Set<string>();
  let occupiedCells: Set<string> | undefined;
  let totalCells = 0;
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
    totalCells += cells;
    if (totalCells > MAX_LOGIC_TERRAIN_CELLS) throw new TypeError('Terrain windows exceed the total cell budget.');
    if (!(terrainWindow.occupancy instanceof Uint8Array) || terrainWindow.occupancy.length !== cells)
      throw new TypeError('Terrain window occupancy length does not match its size.');
    if (occupiedCells) {
      if (!addTerrainWindowCells(terrainWindow, occupiedCells))
        throw new TypeError('Terrain windows must not overlap.');
    } else if (terrainOverlapValidationMode(index + 1, totalCells) === 'cell-set') {
      occupiedCells = new Set<string>();
      for (let populatedIndex = 0; populatedIndex <= index; populatedIndex += 1)
        if (!addTerrainWindowCells(terrainWindows[populatedIndex], occupiedCells))
          throw new TypeError('Terrain windows must not overlap.');
    } else
      for (let previousIndex = 0; previousIndex < index; previousIndex += 1)
        if (terrainWindowsOverlap(terrainWindow, terrainWindows[previousIndex]))
          throw new TypeError('Terrain windows must not overlap.');
  });
}

const validateTerrainWindowsOnce = (terrainWindows: readonly TerrainWindow[]) => {
  const signature = terrainSignature(terrainWindows);
  if (validatedTerrainSignatures.get(terrainWindows) === signature) return;
  validateTerrainWindows(terrainWindows);
  validatedTerrainSignatures.set(terrainWindows, signature);
};

export class LogicTerrain {
  private readonly reads = new Map<string, number>();
  private missing = false;

  constructor(private readonly terrainWindows: readonly TerrainWindow[]) {
    validateTerrainWindowsOnce(terrainWindows);
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
    if (startKey === targetKey) return this.directStep(start, target);
    const open = new Map<string, Node>([
      [
        startKey,
        {
          ...resolvedStart,
          g: 0,
          f: this.heuristic(resolvedStart, resolvedTarget),
          key: startKey,
          parent: null,
        },
      ],
    ]);
    const visited = new Map<string, Node>();
    let expanded = 0;
    while (open.size > 0 && expanded < MAX_NAVIGATION_NODES) {
      const current = selectNavigationOpenNode(open.values())!;
      const currentKey = current.key;
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
          key: nextKey,
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
        if (
          (dy > 0 && !this.clearBody(kind, { x: current.x, y: candidate.y, z: current.z })) ||
          !this.walkable(kind, candidate)
        ) {
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
    const { minimum, maximum, position } = this.bodyBounds(kind, node);
    if (!this.clearBody(kind, node)) return false;
    const supportY = Math.floor(position.y + bodyConfigFor(kind).localAabb.min.y - EPSILON);
    for (let z = minimum.z; z <= maximum.z; z += 1)
      for (let x = minimum.x; x <= maximum.x; x += 1) {
        const sample = this.sample(x, supportY, z);
        if (sample === 'solid') return true;
        if (sample === 'unknown') return false;
      }
    return false;
  }

  private clearBody(kind: BodyKind, node: Pick<Node, 'x' | 'y' | 'z'>): boolean {
    const { minimum, maximum } = this.bodyBounds(kind, node);
    for (let y = minimum.y; y <= maximum.y; y += 1)
      for (let z = minimum.z; z <= maximum.z; z += 1)
        for (let x = minimum.x; x <= maximum.x; x += 1) if (this.sample(x, y, z) !== 'free') return false;
    return true;
  }

  private bodyBounds(kind: BodyKind, node: Pick<Node, 'x' | 'y' | 'z'>) {
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
    return { minimum, maximum, position };
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

  private directStep(start: LogicPosition, target: LogicPosition): NavigationStep {
    const dx = target[0] - start[0];
    const dz = target[2] - start[2];
    const length = Math.hypot(dx, dz);
    return length <= EPSILON
      ? { wish: { x: 0, z: 0 }, jumpRequested: false }
      : { wish: { x: dx / length, z: dz / length }, jumpRequested: false };
  }
}

export function terrainOccupancyIndex(size: LogicPosition, localX: number, localY: number, localZ: number): number {
  return localX + size[0] * (localZ + size[2] * localY);
}
