export const MAX_GLB_BYTES = 16 * 1024 * 1024;
export const MAX_GLB_MODELS = 16;
export const MAX_GLB_LIBRARY_BYTES = 64 * 1024 * 1024;
export const MAX_GLB_NODES = 256;
export const MAX_GLB_TRIANGLES = 100_000;
export const MAX_GLB_TEXTURE_EDGE = 4096;
export const MAX_GLB_TEXTURE_PIXELS = 16 * 1024 * 1024;
export const MAX_GLB_IMAGES = 64;
export const MAX_GLB_TEXTURES = 64;
export const MAX_GLB_SKINS = 8;
export const MAX_GLB_JOINTS = 128;
export const MAX_GLB_ANIMATION_CLIPS = 32;
export const MAX_GLB_ANIMATION_CHANNELS = 256;
export const MAX_GLB_ANIMATION_KEYFRAMES = 100_000;
export const MAX_GLB_ANIMATION_SECONDS = 120;
export const MAX_GLB_JSON_DEPTH = 128;
export const MAX_GLB_JSON_VALUES = 100_000;

export type StoredGlb = Readonly<{
  id: string;
  name: string;
  revision: number;
  byteLength: number;
  nodeCount: number;
  triangleCount: number;
}>;

export type GlbAnimationClip = Readonly<{ name: string; durationSeconds: number }>;
export type GlbModelStats = Readonly<{
  nodeCount: number;
  triangleCount: number;
  skinCount: number;
  animationClips: readonly GlbAnimationClip[];
}>;
