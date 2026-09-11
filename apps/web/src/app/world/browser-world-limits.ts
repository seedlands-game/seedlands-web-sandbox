import { CHUNK_SIZE } from '@seedlands/stdlib/world/voxel';

/** 浏览器MVP的呈现范围；不限制纯核心世界或持久化坐标。 */
export const BROWSER_VERTICAL_CHUNKS = 2;
export const BROWSER_MIN_BUILD_Y = 0;
export const BROWSER_MAX_BUILD_Y = BROWSER_VERTICAL_CHUNKS * CHUNK_SIZE - 1;
