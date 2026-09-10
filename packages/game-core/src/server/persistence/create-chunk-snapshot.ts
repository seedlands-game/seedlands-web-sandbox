import type { ServerChunk } from '../game-server-types';
import type { ChunkSnapshot } from './chunk-persistence';

export const createChunkSnapshot = (seedText: string, chunk: ServerChunk, generatorVersion: number): ChunkSnapshot => ({
  key: chunk.key,
  seedText,
  cx: chunk.cx,
  cy: chunk.cy,
  cz: chunk.cz,
  generatorVersion,
  revision: chunk.revision,
  voxels: chunk.voxels.slice(),
  fluidVersion: 1,
  fluid: chunk.fluid.slice(),
});
