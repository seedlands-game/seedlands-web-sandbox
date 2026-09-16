import type { CorePlatformPorts } from '../../runtime/platform-ports';
import { bodyConfigFor, bodyKindForEntity } from '../../physics/body-registry';
import { CHUNK_SIZE, chunkKey, floorDiv } from '../../world/voxel';
import type { AuthorityRuntime } from '../authority/authority-runtime';
import { runWorldComputeTask } from '../compute/world-compute-task';
import { createWorldgenProviderRegistry } from '@seedlands/kernel/spatial';

export type HeadlessChunkState = Readonly<{
  pending: Set<string>;
  loaded: Set<string>;
}>;

function parseChunkKey(key: string): [number, number, number] {
  const coordinates = key.split(',').map(Number);
  if (coordinates.length !== 3 || coordinates.some((value) => !Number.isInteger(value)))
    throw new TypeError(`Invalid chunk key: ${key}`);
  return coordinates as [number, number, number];
}

export async function loadHeadlessEntityChunks(
  runtime: AuthorityRuntime,
  platform: CorePlatformPorts,
  state: HeadlessChunkState,
): Promise<void> {
  for (const entity of runtime.server.queryEntities()) {
    const config = bodyConfigFor(bodyKindForEntity(entity));
    const min = [config.localAabb.min.x, config.localAabb.min.y, config.localAabb.min.z] as const;
    const max = [config.localAabb.max.x, config.localAabb.max.y, config.localAabb.max.z] as const;
    const lower = entity.position.map((value, axis) => floorDiv(value + min[axis] - 0.05, CHUNK_SIZE));
    const upper = entity.position.map((value, axis) => floorDiv(value + max[axis] + 0.05, CHUNK_SIZE));
    for (let cy = lower[1]; cy <= upper[1]; cy += 1)
      for (let cz = lower[2]; cz <= upper[2]; cz += 1)
        for (let cx = lower[0]; cx <= upper[0]; cx += 1)
          await loadHeadlessChunk(runtime, platform, state.loaded, chunkKey(cx, cy, cz));
  }
  await drainHeadlessUnknownChunks(runtime, platform, state);
}

export async function drainHeadlessUnknownChunks(
  runtime: AuthorityRuntime,
  platform: CorePlatformPorts,
  state: HeadlessChunkState,
): Promise<void> {
  while (state.pending.size > 0) {
    const keys = [...state.pending].sort();
    state.pending.clear();
    for (const key of keys) await loadHeadlessChunk(runtime, platform, state.loaded, key);
  }
}

export async function loadHeadlessChunk(
  runtime: AuthorityRuntime,
  platform: CorePlatformPorts,
  loaded: Set<string>,
  key: string,
): Promise<void> {
  if (loaded.has(key) && runtime.readCollisionBaseline(key, 0).status === 'available') return;
  loaded.delete(key);
  const [cx, cy, cz] = parseChunkKey(key);
  const provider = runtime.server.executableWorldgenProvider;
  const prepared = await runtime.prepareMesh(cx, cy, cz);
  const result = await runWorldComputeTask(
    {
      kind: 'generate-mesh',
      traceId: `headless:${key}:${prepared.chunkRevision}`,
      epoch: 0,
      chunkKey: prepared.key,
      seed: runtime.server.seed,
      cx,
      cy,
      cz,
      chunkRevision: prepared.chunkRevision,
      haloRevision: 'headless-compute',
      generatorVersion: prepared.generatorVersion,
      ...(runtime.server.worldgenProvider ? { provider: runtime.server.worldgenProvider } : {}),
      ...(prepared.canonical ? { canonical: prepared.canonical } : {}),
      ...(prepared.fluid ? { fluid: prepared.fluid } : {}),
      overlays: prepared.overlays,
    },
    () => false,
    undefined,
    {
      now: platform.now,
      ...(provider ? { providers: createWorldgenProviderRegistry([provider]) } : {}),
    },
  );
  if (result.kind !== 'mesh-result' || !('canonical' in result))
    throw new Error(`Headless chunk compute returned no canonical data for ${key}.`);
  const accepted = runtime.acceptGeneratedChunk({
    key: result.chunkKey,
    cx: result.cx,
    cy: result.cy,
    cz: result.cz,
    chunkRevision: result.chunkRevision,
    generatorVersion: result.generatorVersion,
    ...(result.provider ? { provider: result.provider } : {}),
    canonical: new Uint16Array(result.canonical),
  });
  if (!accepted) throw new Error(`Authority rejected headless chunk ${key}.`);
  loaded.add(key);
  runtime.setFluidActiveChunks([...loaded].sort());
}
