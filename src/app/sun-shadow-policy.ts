/** 同一纹理预算内优先分配近场采样；级联重叠避免切换边界出现硬线。 */
export const sunShadowOptions = (resolution: 0 | 512 | 1024) => ({
  castShadows: resolution > 0,
  shadowResolution: resolution || 512,
  shadowDistance: 58,
  numCascades: 3,
  cascadeDistribution: resolution === 1024 ? 0.25 : 0.65,
  cascadeBlend: 0.15,
});
