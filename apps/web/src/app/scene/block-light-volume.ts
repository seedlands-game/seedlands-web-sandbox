import { buildBlockLightVolume, sampleBlockLight, type BlockLightVolume } from '@seedlands/stdlib/world/voxel-light';

/**
 * The camera stays in the middle 32 cells, with a 16-cell propagation halo on
 * each side. Snapping to eight cells leaves at least eight guaranteed cells in
 * either horizontal direction before the camera crosses an inner boundary.
 */
export const BLOCK_LIGHT_VOLUME_SIZE = 64;
export const BLOCK_LIGHT_VOLUME_INNER_SIZE = 32;
export const BLOCK_LIGHT_VOLUME_GRID = 8;
export const BLOCK_LIGHT_MAX_LEVEL = 15;
export const BLOCK_LIGHT_R8_SCALE = 255 / BLOCK_LIGHT_MAX_LEVEL;

/** Encodes the stdlib's 0..15 light levels for a WebGL2 R8 UNORM texture. */
export const encodeBlockLightLevelForR8 = (level: number) => {
  if (!Number.isInteger(level) || level < 0 || level > BLOCK_LIGHT_MAX_LEVEL)
    throw new RangeError(`Invalid block light level: ${level}.`);
  return level * BLOCK_LIGHT_R8_SCALE;
};

export type BlockLightVoxelReader = Readonly<{
  getVoxelIfLoaded(x: number, y: number, z: number): number | undefined;
  blockLightRevision(origin: readonly [number, number, number], size: number): string;
}>;

export type CameraBlockLightVolume = Readonly<{
  volume: BlockLightVolume;
  revision: string;
  anchor: readonly [number, number, number];
}>;

const anchorAxis = (value: number) => Math.floor(Math.floor(value) / BLOCK_LIGHT_VOLUME_GRID) * BLOCK_LIGHT_VOLUME_GRID;

export const blockLightAnchorForCamera = (position: readonly [number, number, number]) =>
  [anchorAxis(position[0]), anchorAxis(position[1]), anchorAxis(position[2])] as const;

export const blockLightOriginForAnchor = (anchor: readonly [number, number, number]) =>
  [
    anchor[0] - BLOCK_LIGHT_VOLUME_INNER_SIZE,
    anchor[1] - BLOCK_LIGHT_VOLUME_INNER_SIZE,
    anchor[2] - BLOCK_LIGHT_VOLUME_INNER_SIZE,
  ] as const;

export function buildCameraBlockLightVolume(
  reader: BlockLightVoxelReader,
  position: readonly [number, number, number],
): CameraBlockLightVolume {
  const anchor = blockLightAnchorForCamera(position);
  const origin = blockLightOriginForAnchor(anchor);
  return {
    volume: buildBlockLightVolume(BLOCK_LIGHT_VOLUME_SIZE, origin, (x, y, z) => reader.getVoxelIfLoaded(x, y, z)),
    revision: reader.blockLightRevision(origin, BLOCK_LIGHT_VOLUME_SIZE),
    anchor,
  };
}

export const cameraBlockLightNeedsRefresh = (
  previous: CameraBlockLightVolume | null,
  reader: BlockLightVoxelReader,
  position: readonly [number, number, number],
) => {
  const anchor = blockLightAnchorForCamera(position);
  if (!previous || previous.anchor.some((value, axis) => value !== anchor[axis])) return true;
  return previous.revision !== reader.blockLightRevision(previous.volume.origin, previous.volume.size);
};

export const sampleCameraBlockLight = (
  snapshot: CameraBlockLightVolume | null,
  position: readonly [number, number, number],
) => (snapshot ? sampleBlockLight(snapshot.volume, position[0], position[1], position[2]) : 0);
