import type {
  FluidAuthoritySnapshot,
  FluidPosition,
} from '../../../../../packages/stdlib/src/server/fluid/fluid-transaction';
import type { CreateStoredChunkRecordInput } from '../../../../../packages/stdlib/src/world/chunk-snapshot-codec';
import {
  createProceduralMeshInput,
  makeChunk,
  meshChunk,
  type MeshData,
  type MeshOptions,
  type ProceduralMeshInput,
  type WorldChange,
} from '../../../../../packages/stdlib/src/world/mesh';
import { CHUNK_SIZE, Voxel, chunkKey, voxelIndex } from '../../../../../packages/stdlib/src/world/voxel';

export const WORKLOAD_CORPUS_SCHEMA = 2;
const CELL_COUNT = CHUNK_SIZE ** 3;

export type WorkloadId =
  'w02' | 'w03' | 'w04' | 'w05' | 'w06' | 'w07' | 'w10-small' | 'w10-medium' | 'w10-large' | 'w14' | 'w15';
export type WorkloadInput =
  | { kind: 'w02'; args: Parameters<typeof makeChunk> }
  | { kind: 'w03'; options: ProceduralMeshInput }
  | { kind: 'w04' | 'w05'; options: MeshOptions }
  | { kind: 'w06'; parts: MeshData[] }
  | { kind: 'w07'; snapshot: FluidAuthoritySnapshot }
  | { kind: 'w10'; voxels: Uint16Array }
  | { kind: 'w14'; record: CreateStoredChunkRecordInput }
  | { kind: 'w15'; bytes: Uint8Array };

export const WORKLOADS: WorkloadId[] = [
  'w02',
  'w03',
  'w04',
  'w05',
  'w06',
  'w07',
  'w10-small',
  'w10-medium',
  'w10-large',
  'w14',
  'w15',
];

const generatorVersionFor = (index: number) => (index % 3 === 0 ? 2 : 3);

const xorshift = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
};

function chunkChanges(index: number, cx: number, cy: number, cz: number): WorldChange[] {
  const count = [0, 0, 1, 8, 64][index % 5]!;
  const values = [Voxel.Air, Voxel.Stone, Voxel.Water, Voxel.Lantern];
  return Array.from({ length: count }, (_, edit) => {
    const local = (index * 977 + edit * 509) % CELL_COUNT;
    const x = local % CHUNK_SIZE;
    const z = Math.floor(local / CHUNK_SIZE) % CHUNK_SIZE;
    const y = Math.floor(local / (CHUNK_SIZE * CHUNK_SIZE));
    return [
      cx * CHUNK_SIZE + x,
      cy * CHUNK_SIZE + y,
      cz * CHUNK_SIZE + z,
      values[(index + edit) % values.length]!,
    ] as WorldChange;
  });
}

const applyChanges = (data: Uint16Array, changes: readonly WorldChange[], cx: number, cy: number, cz: number) => {
  for (const [x, y, z, value] of changes)
    data[voxelIndex(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE, z - cz * CHUNK_SIZE)] = value;
};

function w03Options(
  seed: number,
  cx: number,
  cy: number,
  cz: number,
  index: number,
  generatorVersion: number,
): ProceduralMeshInput {
  const canonical = makeChunk(seed, cx, cy, cz, [], generatorVersion);
  const fluid = Uint8Array.from(canonical, (voxel) => (voxel === Voxel.Water ? 0x88 : 0));
  if (index % 4 === 0) {
    const changes = chunkChanges(index + 2, cx, cy, cz).slice(0, 8);
    applyChanges(canonical, changes, cx, cy, cz);
    for (const [x, y, z, voxel] of changes)
      fluid[voxelIndex(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE, z - cz * CHUNK_SIZE)] =
        voxel === Voxel.Water ? 0x80 | ((x + z + index) % 8) | 1 : 0;
  }
  const overlayCount = [0, 1, 4][index % 3]!;
  const offsets = [
    [-1, 0, 0],
    [1, 0, 0],
    [0, 0, -1],
    [0, 0, 1],
  ] as const;
  const overlays = offsets.slice(0, overlayCount).map(([dx, dy, dz], overlayIndex) => {
    const overlayCx = cx + dx;
    const overlayCy = cy + dy;
    const overlayCz = cz + dz;
    const voxels = makeChunk(seed, overlayCx, overlayCy, overlayCz, [], generatorVersion);
    const overlayFluid = Uint8Array.from(voxels, (voxel) => (voxel === Voxel.Water ? 0x88 : 0));
    const localX = dx < 0 ? 31 : dx > 0 ? 0 : 15;
    const localZ = dz < 0 ? 31 : dz > 0 ? 0 : 15;
    const localY = 10 + ((index + overlayIndex) % 8);
    const cell = voxelIndex(localX, localY, localZ);
    voxels[cell] = overlayIndex % 2 ? Voxel.Lantern : Voxel.Water;
    overlayFluid[cell] = overlayIndex % 2 ? 0 : 0x80 | ((index + overlayIndex) % 8) | 1;
    return { cx: overlayCx, cy: overlayCy, cz: overlayCz, voxels, fluid: overlayFluid };
  });
  return { seed, cx, cy, cz, canonical, fluid, overlays, generatorVersion };
}

function meshOptions(
  id: 'w04' | 'w05' | 'w06',
  seed: number,
  cx: number,
  cy: number,
  cz: number,
  index: number,
  generatorVersion: number,
): MeshOptions {
  const canonical = makeChunk(seed, cx, cy, cz, [], generatorVersion);
  let fluid = Uint8Array.from(canonical, (voxel) => (voxel === Voxel.Water ? 0x88 : 0));
  const useWaterFixture = id === 'w05' || (id === 'w06' && index % 5 === 0);
  if (useWaterFixture) {
    const floorY = 18 + (index % 7);
    for (let z = 5; z < 27; z += 1)
      for (let x = 5; x < 27; x += 1) {
        const cell = voxelIndex(x, floorY, z);
        canonical[cell] = Voxel.Water;
        fluid[cell] = 0x80 | ((x + z + index) % 8) | 1;
        if (index % 3 === 0 && (x + z) % 5 === 0) {
          const above = voxelIndex(x, floorY + 1, z);
          canonical[above] = Voxel.Water;
          fluid[above] = 0x88;
        }
      }
    canonical[voxelIndex(16, floorY + 2, 16)] = Voxel.Lantern;
  } else {
    const profile = index % 15;
    if (profile === 0) canonical.fill(Voxel.Air);
    else if (profile === 1) canonical.fill(Voxel.Stone);
    else if (profile === 2)
      for (let y = 0; y < CHUNK_SIZE; y += 1)
        for (let z = 0; z < CHUNK_SIZE; z += 1)
          for (let x = 0; x < CHUNK_SIZE; x += 1)
            canonical[voxelIndex(x, y, z)] = (x + y + z + index) % 2 ? Voxel.Stone : Voxel.Air;
    else if (profile >= 3 && profile <= 5) applyChanges(canonical, chunkChanges(index + 1, cx, cy, cz), cx, cy, cz);
    fluid = Uint8Array.from(canonical, (voxel) => (voxel === Voxel.Water ? 0x88 : 0));
  }
  const prepared = createProceduralMeshInput({ seed, cx, cy, cz, canonical, fluid, generatorVersion });
  return {
    seed,
    cx,
    cy,
    cz,
    data: canonical,
    changes: [],
    halo: prepared.halo,
    fluid: prepared.fluid,
    fluidHalo: prepared.fluidHalo,
    generatorVersion,
  };
}

function fluidSnapshot(index: number): FluidAuthoritySnapshot {
  // 22 个 5-Chunk 和 8 个 4-Chunk 样本的 TypedArray 平均为 465,306 bytes/task，接近 P0 的混合消息代理。
  const useFourChunks = index % 4 === 0;
  const originCx = (index % 3) - 1;
  const originCz = (Math.floor(index / 3) % 3) - 1;
  const offsets = useFourChunks
    ? ([
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const)
    : ([
        [0, 0],
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const);
  const chunks = offsets.map(([dx, dz], chunkIndex) => {
    const cx = originCx + dx;
    const cz = originCz + dz;
    const voxels = new Uint16Array(CELL_COUNT);
    const fluid = new Uint8Array(CELL_COUNT);
    for (let z = 0; z < CHUNK_SIZE; z += 1)
      for (let x = 0; x < CHUNK_SIZE; x += 1) voxels[voxelIndex(x, 9, z)] = Voxel.Stone;
    return { key: chunkKey(cx, 0, cz), cx, cy: 0, cz, revision: index * 8 + chunkIndex, voxels, fluid };
  });
  const byKey = new Map(chunks.map((chunk) => [chunk.key, chunk]));
  const boundary: FluidPosition[] = [];
  for (const chunk of chunks) {
    const right = byKey.get(chunkKey(chunk.cx + 1, 0, chunk.cz));
    if (right)
      for (let local = 2; local < CHUNK_SIZE; local += 4) {
        boundary.push([chunk.cx * CHUNK_SIZE + 31, 10, chunk.cz * CHUNK_SIZE + local]);
        boundary.push([right.cx * CHUNK_SIZE, 10, right.cz * CHUNK_SIZE + local]);
      }
    const forward = byKey.get(chunkKey(chunk.cx, 0, chunk.cz + 1));
    if (forward)
      for (let local = 2; local < CHUNK_SIZE; local += 4) {
        boundary.push([chunk.cx * CHUNK_SIZE + local, 10, chunk.cz * CHUNK_SIZE + 31]);
        boundary.push([forward.cx * CHUNK_SIZE + local, 10, forward.cz * CHUNK_SIZE]);
      }
  }
  const interior = chunks.flatMap((chunk) => {
    const positions: FluidPosition[] = [];
    for (let z = 2; z < CHUNK_SIZE; z += 4)
      for (let x = 2; x < CHUNK_SIZE; x += 4)
        positions.push([chunk.cx * CHUNK_SIZE + x, 10, chunk.cz * CHUNK_SIZE + z]);
    return positions;
  });
  const rotation = (index * 37) % interior.length;
  const rotatedInterior = [...interior.slice(rotation), ...interior.slice(0, rotation)];
  const frontier = [...boundary.slice(0, 64), ...rotatedInterior.slice(0, 64)];
  const cleanupFrontier = rotatedInterior.slice(64, 128);
  const writeCell = (position: FluidPosition, source: boolean, level: number) => {
    const [x, y, z] = position;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = byKey.get(chunkKey(cx, 0, cz))!;
    const cell = voxelIndex(
      ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
      y,
      ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    );
    chunk.voxels[cell] = Voxel.Water;
    chunk.fluid[cell] = (source ? 0x80 : 0) | level;
  };
  frontier.forEach((position, positionIndex) =>
    writeCell(position, positionIndex % 4 === 0, 4 + ((index + positionIndex) % 5)),
  );
  cleanupFrontier.forEach((position, positionIndex) => writeCell(position, false, 1 + ((index + positionIndex) % 2)));
  return {
    protocolVersion: 1,
    epoch: 1 + (index % 3),
    workId: `ab-${index}`,
    chunks,
    frontier,
    cleanupFrontier,
  };
}

function storedRecord(
  seed: number,
  cx: number,
  cy: number,
  cz: number,
  index: number,
  generatorVersion: number,
): CreateStoredChunkRecordInput {
  const proceduralVoxels = makeChunk(seed, cx, cy, cz, [], generatorVersion);
  const voxels = proceduralVoxels.slice();
  const profile = index % 5;
  const changed = [0, 1, Math.ceil(CELL_COUNT * 0.01), Math.ceil(CELL_COUNT * 0.1), CELL_COUNT][profile]!;
  const random = xorshift(seed ^ Math.imul(index + 1, 0x9e3779b1));
  const touched = new Set<number>();
  while (touched.size < changed) touched.add(profile === 4 ? touched.size : random() % CELL_COUNT);
  for (const cell of touched)
    voxels[cell] = profile === 4 ? (Math.imul(cell, 257) + seed) & 0xffff : (cell + index) % 11;
  const includeFluid = index % 3 !== 0;
  const fluid = includeFluid ? new Uint8Array(CELL_COUNT) : undefined;
  if (fluid && index % 2 === 0)
    for (let cell = index % 17; cell < fluid.length; cell += 97) fluid[cell] = 0x80 | ((cell + index) % 8) | 1;
  return {
    worldId: 'wasm-ab',
    seedText: String(seed),
    cx,
    cy,
    cz,
    revision: index + 1,
    formatVersion: 1,
    voxelSchemaVersion: 1,
    generatorVersion,
    voxels,
    proceduralVoxels,
    ...(fluid ? { fluid } : {}),
  };
}

export function makeWorkloadCorpus(id: WorkloadId, count = 30): WorkloadInput[] {
  return Array.from({ length: count }, (_, index): WorkloadInput => {
    const seed = (18374655 + (index % 10) * 1009) >>> 0;
    const cx = (index % 5) - 2;
    const cy = index % 3 === 0 ? 1 : 0;
    const cz = (index % 7) - 3;
    const generatorVersion = generatorVersionFor(index);
    if (id === 'w02')
      return { kind: 'w02', args: [seed, cx, cy, cz, chunkChanges(index, cx, cy, cz), generatorVersion] };
    if (id === 'w10-small' || id === 'w10-medium' || id === 'w10-large') {
      const size = id === 'w10-small' ? 1 : id === 'w10-medium' ? 1024 : CELL_COUNT;
      return { kind: 'w10', voxels: Uint16Array.from({ length: size }, (_, cell) => (cell * 17 + index) % 11) };
    }
    if (id === 'w15') {
      const size = [0, 3072, 3072, 32768, 65536][index % 5]!;
      return { kind: 'w15', bytes: Uint8Array.from({ length: size }, (_, cell) => cell * 17 + index) };
    }
    if (id === 'w03') return { kind: 'w03', options: w03Options(seed, cx, cy, cz, index, generatorVersion) };
    if (id === 'w14') return { kind: 'w14', record: storedRecord(seed, cx, cy, cz, index, generatorVersion) };
    if (id === 'w07') return { kind: 'w07', snapshot: fluidSnapshot(index) };
    const options = meshOptions(id, seed, cx, cy, cz, index, generatorVersion);
    if (id === 'w06') return { kind: 'w06', parts: Object.values(meshChunk(options)) };
    return { kind: id, options };
  });
}
