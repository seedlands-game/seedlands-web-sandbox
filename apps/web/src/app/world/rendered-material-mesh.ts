import { CHUNK_SIZE, chunkKey, type FaceMaterialId } from '@seedlands/stdlib/world/voxel';
import type { MeshPart } from '../app-contracts';
import type { ChunkRecord } from './chunk-resource-repository';

type Vector3 = readonly [number, number, number];
const vector = (x: number, y: number, z: number): Vector3 => Object.freeze([x, y, z]);

export type RenderedMaterialMeshPartSummary = Readonly<{
  material: FaceMaterialId;
  vertexCount: number;
  indexCount: number;
  min: Vector3;
  max: Vector3;
}>;

export type RenderedMaterialMeshSummary = RenderedMaterialMeshPartSummary &
  Readonly<{ chunkKey: string; chunkRevision: number }>;

export type RenderedMaterialMeshResource = {
  renderedMaterialMeshes?: Map<FaceMaterialId, RenderedMaterialMeshPartSummary>;
};
type RenderedMaterialMeshTask = Readonly<{
  chunkKey: string;
  chunkRevision: number;
  cx: number;
  cy: number;
  cz: number;
}>;

const materialAt = (part: MeshPart, vertex: number): FaceMaterialId =>
  part.material ?? ((part.colors[vertex * 4 + 3]! + 1) as FaceMaterialId);

const merge = (
  previous: RenderedMaterialMeshPartSummary | undefined,
  material: FaceMaterialId,
  vertexCount: number,
  indexCount: number,
  min: Vector3,
  max: Vector3,
): RenderedMaterialMeshPartSummary =>
  Object.freeze({
    material,
    vertexCount: (previous?.vertexCount ?? 0) + vertexCount,
    indexCount: (previous?.indexCount ?? 0) + indexCount,
    min: previous
      ? vector(Math.min(previous.min[0], min[0]), Math.min(previous.min[1], min[1]), Math.min(previous.min[2], min[2]))
      : vector(...min),
    max: previous
      ? vector(Math.max(previous.max[0], max[0]), Math.max(previous.max[1], max[1]), Math.max(previous.max[2], max[2]))
      : vector(...max),
  });

/** Records only indexed vertices from the exact mesh part passed to PlayCanvas. */
export function recordRenderedMaterialMeshPart(resource: RenderedMaterialMeshResource, part: MeshPart): void {
  const summaries = (resource.renderedMaterialMeshes ??= new Map());
  const vertexLength = part.positions.length / 3;
  if (!Number.isSafeInteger(vertexLength) || part.colors.length !== vertexLength * 4)
    throw new TypeError('Rendered mesh vertex attributes are invalid.');
  const referenced = new Map<FaceMaterialId, Set<number>>();
  const indexCounts = new Map<FaceMaterialId, number>();
  for (const vertex of part.indices) {
    if (!Number.isSafeInteger(vertex) || vertex < 0 || vertex >= vertexLength)
      throw new RangeError('Rendered mesh index is invalid.');
    const material = materialAt(part, vertex);
    let vertices = referenced.get(material);
    if (!vertices) {
      vertices = new Set();
      referenced.set(material, vertices);
    }
    vertices.add(vertex);
    indexCounts.set(material, (indexCounts.get(material) ?? 0) + 1);
  }
  for (const [material, vertices] of referenced) {
    const min: [number, number, number] = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ];
    const max: [number, number, number] = [
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    for (const vertex of vertices)
      for (let axis = 0; axis < 3; axis += 1) {
        const coordinate = part.positions[vertex * 3 + axis]!;
        if (!Number.isFinite(coordinate)) throw new TypeError('Rendered mesh position is invalid.');
        min[axis] = Math.min(min[axis], coordinate);
        max[axis] = Math.max(max[axis], coordinate);
      }
    summaries.set(
      material,
      merge(summaries.get(material), material, vertices.size, indexCounts.get(material)!, min, max),
    );
  }
}

export function getRenderedMaterialMeshFromChunks(
  chunks: ReadonlyMap<string, ChunkRecord<RenderedMaterialMeshTask, RenderedMaterialMeshResource>>,
  cx: number,
  cy: number,
  cz: number,
  material: FaceMaterialId,
): RenderedMaterialMeshSummary | null {
  if (![cx, cy, cz, material].every(Number.isSafeInteger)) return null;
  const record = chunks.get(chunkKey(cx, cy, cz));
  const summary = record?.resource.renderedMaterialMeshes?.get(material);
  if (!record || !summary) return null;
  const origin = [record.task.cx * CHUNK_SIZE, record.task.cy * CHUNK_SIZE, record.task.cz * CHUNK_SIZE] as const;
  return Object.freeze({
    chunkKey: record.task.chunkKey,
    chunkRevision: record.task.chunkRevision,
    material,
    vertexCount: summary.vertexCount,
    indexCount: summary.indexCount,
    min: vector(summary.min[0] + origin[0], summary.min[1] + origin[1], summary.min[2] + origin[2]),
    max: vector(summary.max[0] + origin[0], summary.max[1] + origin[1], summary.max[2] + origin[2]),
  });
}
