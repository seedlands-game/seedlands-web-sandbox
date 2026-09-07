import { decodeCompactMeshData, type MeshData } from '@seedlands/game-core/world/mesh';
import { CHUNK_SIZE } from '@seedlands/game-core/world/voxel';

const EPSILON = 1e-5;
const RETAINED_PATCH = 0;
const ADDED_PATCH = 1;
const REMOVED_PATCH = 2;

export const DEFAULT_MAX_WATER_TRANSITION_PATCHES = CHUNK_SIZE * CHUNK_SIZE * 16;

export type WaterSurfaceTransitionGeometry = {
  startPositions: Float32Array;
  deltaPositions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  colors: Uint8Array;
  indices: Uint32Array;
  patchKeys: string[];
  /** 0 = retained, 1 = added, 2 = removed. */
  patchKinds: Uint8Array;
};

export type WaterSurfaceTransitionResult =
  | { kind: 'unchanged'; patchCount: number }
  | { kind: 'budget-exceeded'; patchCount: number; maxPatches: number }
  | {
      kind: 'transition';
      patchCount: number;
      retainedPatchCount: number;
      addedPatchCount: number;
      removedPatchCount: number;
      geometry: WaterSurfaceTransitionGeometry;
    };

type TransitionOptions = { maxPatches?: number };

type Patch = {
  key: string;
  kind: 'top' | 'bottom' | 'side-x' | 'side-z';
  axis: number;
  axisA: number;
  axisB: number;
  planeKey: number;
  cellA: number;
  cellB: number;
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
};

type PatchCollection = { patches: Map<string, Patch>; exceededAt: number | null };
type PatchPair = { key: string; oldPatch?: Patch; newPatch?: Patch };

const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress;
const nearlyEqual = (left: number, right: number) => Math.abs(left - right) <= EPSILON;

const segmentBreaks = (minimum: number, maximum: number): number[] => {
  const result = [minimum];
  for (let boundary = Math.ceil(minimum + EPSILON); boundary < maximum - EPSILON; boundary += 1) result.push(boundary);
  result.push(maximum);
  return result;
};

const patchIdentity = (kind: Patch['kind'], planeKey: number, cellA: number, cellB: number) =>
  `${kind}:${planeKey}:${cellA}:${cellB}`;

const bilinear = (
  corners: ReadonlyMap<string, readonly number[]>,
  positionA: number,
  positionB: number,
  components: number,
): number[] => {
  const at = (a: 0 | 1, b: 0 | 1) => corners.get(`${a}:${b}`)!;
  const result: number[] = [];
  for (let component = 0; component < components; component += 1) {
    const low = lerp(at(0, 0)[component], at(1, 0)[component], positionA);
    const high = lerp(at(0, 1)[component], at(1, 1)[component], positionA);
    result.push(lerp(low, high, positionB));
  }
  return result;
};

const splitQuad = (
  positions: readonly number[],
  normals: readonly number[],
  uvs: readonly number[],
  colors: readonly number[],
): Patch[] => {
  const normal = normals.slice(0, 3);
  let axis = 0;
  if (Math.abs(normal[1]) > Math.abs(normal[axis])) axis = 1;
  if (Math.abs(normal[2]) > Math.abs(normal[axis])) axis = 2;
  const [axisA, axisB] = [0, 1, 2].filter((candidate) => candidate !== axis);
  const valuesA = [0, 1, 2, 3].map((vertex) => positions[vertex * 3 + axisA]);
  const valuesB = [0, 1, 2, 3].map((vertex) => positions[vertex * 3 + axisB]);
  const minimumA = Math.min(...valuesA);
  const maximumA = Math.max(...valuesA);
  const minimumB = Math.min(...valuesB);
  const maximumB = Math.max(...valuesB);
  if (nearlyEqual(minimumA, maximumA) || nearlyEqual(minimumB, maximumB)) return [];

  const uvCorners = new Map<string, readonly number[]>();
  const colorCorners = new Map<string, readonly number[]>();
  for (let vertex = 0; vertex < 4; vertex += 1) {
    const sideA = nearlyEqual(valuesA[vertex], maximumA) ? 1 : 0;
    const sideB = nearlyEqual(valuesB[vertex], maximumB) ? 1 : 0;
    uvCorners.set(`${sideA}:${sideB}`, uvs.slice(vertex * 2, vertex * 2 + 2));
    colorCorners.set(`${sideA}:${sideB}`, colors.slice(vertex * 4, vertex * 4 + 4));
  }
  if (uvCorners.size !== 4 || colorCorners.size !== 4) return [];

  const plane = positions[axis];
  const sign = normal[axis] < 0 ? -1 : 1;
  const kind: Patch['kind'] = axis === 1 ? (sign > 0 ? 'top' : 'bottom') : axis === 0 ? 'side-x' : 'side-z';
  const planeKey = axis === 1 && sign > 0 ? Math.floor(plane + EPSILON) : Math.round(plane * 8);
  const breaksA = segmentBreaks(minimumA, maximumA);
  const breaksB = segmentBreaks(minimumB, maximumB);
  const result: Patch[] = [];

  for (let segmentA = 0; segmentA < breaksA.length - 1; segmentA += 1) {
    for (let segmentB = 0; segmentB < breaksB.length - 1; segmentB += 1) {
      const lowA = breaksA[segmentA];
      const highA = breaksA[segmentA + 1];
      const lowB = breaksB[segmentB];
      const highB = breaksB[segmentB + 1];
      const cellA = Math.floor((lowA + highA) * 0.5 + EPSILON);
      const cellB = Math.floor((lowB + highB) * 0.5 + EPSILON);
      const patchPositions: number[] = [];
      const patchUvs: number[] = [];
      const patchColors: number[] = [];
      for (let vertex = 0; vertex < 4; vertex += 1) {
        const sideA = nearlyEqual(valuesA[vertex], maximumA) ? 1 : 0;
        const sideB = nearlyEqual(valuesB[vertex], maximumB) ? 1 : 0;
        const coordinateA = sideA ? highA : lowA;
        const coordinateB = sideB ? highB : lowB;
        const point = [0, 0, 0];
        point[axis] = plane;
        point[axisA] = coordinateA;
        point[axisB] = coordinateB;
        patchPositions.push(...point);
        const normalizedA = (coordinateA - minimumA) / (maximumA - minimumA);
        const normalizedB = (coordinateB - minimumB) / (maximumB - minimumB);
        patchUvs.push(...bilinear(uvCorners, normalizedA, normalizedB, 2));
        patchColors.push(...bilinear(colorCorners, normalizedA, normalizedB, 4).map(Math.round));
      }
      result.push({
        key: patchIdentity(kind, planeKey, cellA, cellB),
        kind,
        axis,
        axisA,
        axisB,
        planeKey,
        cellA,
        cellB,
        positions: patchPositions,
        normals: [...normal, ...normal, ...normal, ...normal],
        uvs: patchUvs,
        colors: patchColors,
      });
    }
  }
  return result;
};

const collectPatches = (parts: readonly MeshData[], maxPatches: number): PatchCollection => {
  const patches = new Map<string, Patch>();
  for (const original of parts) {
    if (original.renderCategory !== 'transparent') continue;
    const part = decodeCompactMeshData(original);
    const quadCount = Math.floor(part.positions.length / 12);
    for (let quad = 0; quad < quadCount; quad += 1) {
      const positionOffset = quad * 12;
      const uvOffset = quad * 8;
      const colorOffset = quad * 16;
      for (const patch of splitQuad(
        [...part.positions.slice(positionOffset, positionOffset + 12)],
        [...part.normals.slice(positionOffset, positionOffset + 12)],
        [...part.uvs.slice(uvOffset, uvOffset + 8)],
        [...part.colors.slice(colorOffset, colorOffset + 16)],
      )) {
        patches.set(patch.key, patch);
        if (patches.size > maxPatches) return { patches, exceededAt: patches.size };
      }
    }
  }
  return { patches, exceededAt: null };
};

const coordinateRange = (patch: Patch, axis: number): [number, number] => {
  const values = [0, 1, 2, 3].map((vertex) => patch.positions[vertex * 3 + axis]);
  return [Math.min(...values), Math.max(...values)];
};

const remapPositions = (source: Patch, target: Patch): number[] => {
  const [, sourceMaximumA] = coordinateRange(source, source.axisA);
  const [, sourceMaximumB] = coordinateRange(source, source.axisB);
  const [, targetMaximumA] = coordinateRange(target, target.axisA);
  const [, targetMaximumB] = coordinateRange(target, target.axisB);
  const sourceCorners = new Map<string, readonly number[]>();
  for (let vertex = 0; vertex < 4; vertex += 1) {
    const offset = vertex * 3;
    const sideA = nearlyEqual(source.positions[offset + source.axisA], sourceMaximumA) ? 1 : 0;
    const sideB = nearlyEqual(source.positions[offset + source.axisB], sourceMaximumB) ? 1 : 0;
    sourceCorners.set(`${sideA}:${sideB}`, source.positions.slice(offset, offset + 3));
  }
  const result: number[] = [];
  for (let vertex = 0; vertex < 4; vertex += 1) {
    const offset = vertex * 3;
    const sideA = nearlyEqual(target.positions[offset + target.axisA], targetMaximumA) ? 1 : 0;
    const sideB = nearlyEqual(target.positions[offset + target.axisB], targetMaximumB) ? 1 : 0;
    const corner = sourceCorners.get(`${sideA}:${sideB}`);
    if (!corner) return [...source.positions];
    result.push(...corner);
  }
  return result;
};

const adjacentPatch = (patch: Patch, candidates: ReadonlyMap<string, Patch>): Patch | null => {
  const offsets = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ] as const;
  for (const [offsetA, offsetB] of offsets) {
    const adjacent = candidates.get(
      patchIdentity(patch.kind, patch.planeKey, patch.cellA + offsetA, patch.cellB + offsetB),
    );
    if (adjacent) return adjacent;
  }
  return null;
};

const collapsePositions = (patch: Patch, candidates: ReadonlyMap<string, Patch>): number[] => {
  const result = [...patch.positions];
  const adjacent = adjacentPatch(patch, candidates);
  if (adjacent) {
    const [minimumA, maximumA] = coordinateRange(patch, patch.axisA);
    const [minimumB, maximumB] = coordinateRange(patch, patch.axisB);
    if (adjacent.cellA !== patch.cellA) {
      const boundary = adjacent.cellA < patch.cellA ? minimumA : maximumA;
      for (let vertex = 0; vertex < 4; vertex += 1) result[vertex * 3 + patch.axisA] = boundary;
    } else {
      const boundary = adjacent.cellB < patch.cellB ? minimumB : maximumB;
      for (let vertex = 0; vertex < 4; vertex += 1) result[vertex * 3 + patch.axisB] = boundary;
    }
    if (patch.kind === 'top') {
      const adjacentSurface =
        adjacent.positions.reduce((sum, value, index) => sum + (index % 3 === 1 ? value : 0), 0) / 4;
      for (let vertex = 0; vertex < 4; vertex += 1) result[vertex * 3 + 1] = adjacentSurface;
    }
    return result;
  }

  if (patch.kind === 'top') {
    const [minimumY] = coordinateRange(patch, 1);
    const floor = Math.floor(minimumY + EPSILON);
    for (let vertex = 0; vertex < 4; vertex += 1) result[vertex * 3 + 1] = floor;
    return result;
  }
  if (patch.kind === 'bottom') {
    const [minimumA, maximumA] = coordinateRange(patch, patch.axisA);
    const [minimumB, maximumB] = coordinateRange(patch, patch.axisB);
    for (let vertex = 0; vertex < 4; vertex += 1) {
      result[vertex * 3 + patch.axisA] = (minimumA + maximumA) * 0.5;
      result[vertex * 3 + patch.axisB] = (minimumB + maximumB) * 0.5;
    }
    return result;
  }

  const [minimumY] = coordinateRange(patch, 1);
  for (let vertex = 0; vertex < 4; vertex += 1) result[vertex * 3 + 1] = minimumY;
  return result;
};

const positionsEqual = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && left.every((value, index) => nearlyEqual(value, right[index]));

const pairPatches = (
  previous: ReadonlyMap<string, Patch>,
  current: ReadonlyMap<string, Patch>,
  maxPatches: number,
): { pairs: PatchPair[]; exceededAt: number | null } => {
  const unmatchedPrevious = new Set(previous.keys());
  const unmatchedCurrent = new Set(current.keys());
  const pairs: PatchPair[] = [];
  const append = (pair: PatchPair) => {
    pairs.push(pair);
    return pairs.length > maxPatches;
  };

  for (const key of [...unmatchedCurrent].sort()) {
    const oldPatch = previous.get(key);
    if (!oldPatch) continue;
    if (append({ key, oldPatch, newPatch: current.get(key)! })) return { pairs, exceededAt: pairs.length };
    unmatchedPrevious.delete(key);
    unmatchedCurrent.delete(key);
  }

  // A one-cell fluid propagation moves the exposed vertical boundary by one voxel.
  // Pair that adjacent committed boundary directly so it moves in space instead of
  // drawing old and new planes at the same time.
  for (const key of [...unmatchedCurrent].sort()) {
    const newPatch = current.get(key)!;
    if (newPatch.kind !== 'side-x' && newPatch.kind !== 'side-z') continue;
    const candidates = [-8, 8].map((planeOffset) =>
      patchIdentity(newPatch.kind, newPatch.planeKey + planeOffset, newPatch.cellA, newPatch.cellB),
    );
    const oldKey = candidates.find((candidate) => unmatchedPrevious.has(candidate));
    if (!oldKey) continue;
    if (append({ key, oldPatch: previous.get(oldKey)!, newPatch })) return { pairs, exceededAt: pairs.length };
    unmatchedPrevious.delete(oldKey);
    unmatchedCurrent.delete(key);
  }

  for (const key of [...unmatchedCurrent].sort()) {
    if (append({ key, newPatch: current.get(key)! })) return { pairs, exceededAt: pairs.length };
  }
  for (const key of [...unmatchedPrevious].sort()) {
    if (append({ key, oldPatch: previous.get(key)! })) return { pairs, exceededAt: pairs.length };
  }
  pairs.sort((left, right) => left.key.localeCompare(right.key));
  return { pairs, exceededAt: null };
};

export function buildWaterSurfaceTransition(
  previousParts: readonly MeshData[],
  currentParts: readonly MeshData[],
  options: TransitionOptions = {},
): WaterSurfaceTransitionResult {
  const maxPatches = Math.max(1, Math.floor(options.maxPatches ?? DEFAULT_MAX_WATER_TRANSITION_PATCHES));
  const previous = collectPatches(previousParts, maxPatches);
  if (previous.exceededAt !== null) return { kind: 'budget-exceeded', patchCount: previous.exceededAt, maxPatches };
  const current = collectPatches(currentParts, maxPatches);
  if (current.exceededAt !== null) return { kind: 'budget-exceeded', patchCount: current.exceededAt, maxPatches };

  const paired = pairPatches(previous.patches, current.patches, maxPatches);
  if (paired.exceededAt !== null) return { kind: 'budget-exceeded', patchCount: paired.exceededAt, maxPatches };
  const geometryChanged = paired.pairs.some(
    ({ oldPatch, newPatch }) =>
      !oldPatch || !newPatch || !positionsEqual(remapPositions(oldPatch, newPatch), newPatch.positions),
  );
  if (!geometryChanged) return { kind: 'unchanged', patchCount: paired.pairs.length };
  const patchKeys = paired.pairs.map((pair) => pair.key);

  const startPositions: number[] = [];
  const deltaPositions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const patchKinds: number[] = [];
  let retainedPatchCount = 0;
  let addedPatchCount = 0;
  let removedPatchCount = 0;

  for (const { oldPatch, newPatch } of paired.pairs) {
    const attributes = newPatch ?? oldPatch!;
    let start: number[];
    let end: number[];
    let patchKind: number;
    if (oldPatch && newPatch) {
      start = remapPositions(oldPatch, newPatch);
      end = [...newPatch.positions];
      patchKind = RETAINED_PATCH;
      retainedPatchCount += 1;
    } else if (newPatch) {
      start = collapsePositions(newPatch, previous.patches);
      end = [...newPatch.positions];
      patchKind = ADDED_PATCH;
      addedPatchCount += 1;
    } else {
      start = [...oldPatch!.positions];
      end = collapsePositions(oldPatch!, current.patches);
      patchKind = REMOVED_PATCH;
      removedPatchCount += 1;
    }
    const vertexOffset = startPositions.length / 3;
    startPositions.push(...start);
    deltaPositions.push(...start.map((value, index) => end[index] - value));
    normals.push(...attributes.normals);
    uvs.push(...attributes.uvs);
    colors.push(...attributes.colors);
    indices.push(vertexOffset, vertexOffset + 1, vertexOffset + 2, vertexOffset, vertexOffset + 2, vertexOffset + 3);
    patchKinds.push(patchKind);
  }

  return {
    kind: 'transition',
    patchCount: patchKeys.length,
    retainedPatchCount,
    addedPatchCount,
    removedPatchCount,
    geometry: {
      startPositions: new Float32Array(startPositions),
      deltaPositions: new Float32Array(deltaPositions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      colors: new Uint8Array(colors),
      indices: new Uint32Array(indices),
      patchKeys,
      patchKinds: new Uint8Array(patchKinds),
    },
  };
}
