/** Linear received light only; surface self-emission remains a separate material channel. */
export const voxelReceivedLightingGlsl = /* glsl */ `
uniform highp sampler3D texture_blockLight;
uniform vec3 uBlockLightOrigin;
uniform float uBlockLightSize;
uniform float uBlockLightReady;
uniform highp sampler3D texture_skyVisibility;
uniform vec3 uSkyVisibilityOrigin;
uniform float uSkyVisibilitySize;
uniform float uSkyVisibilityReady;
uniform vec3 uSkyRadiance;
uniform vec3 uBlockLightTint;

float blockLightAtSurface() {
    vec3 voxel = floor(vPositionW + dNormalW * 0.26);
    vec3 coordinate = (voxel + vec3(0.5) - uBlockLightOrigin) / uBlockLightSize;
    vec3 inside = step(vec3(0.0), coordinate) * step(coordinate, vec3(1.0));
    return texture(texture_blockLight, clamp(coordinate, 0.0, 1.0)).r * inside.x * inside.y * inside.z;
}

float skyLightAtSurface() {
    // Incoming vertical transmission above this surface's own cell, before its absorption.
    // The upper row is proven by the same full-column source, including at chunk boundaries.
    vec3 voxel = floor(vPositionW - dNormalW * 0.01) + vec3(0.0, 1.0, 0.0);
    vec3 extent = vec3(uSkyVisibilitySize, uSkyVisibilitySize + 1.0, uSkyVisibilitySize);
    vec3 coordinate = (voxel + vec3(0.5) - uSkyVisibilityOrigin) / extent;
    vec3 inside = step(vec3(0.0), coordinate) * step(coordinate, vec3(1.0));
    return texture(texture_skyVisibility, clamp(coordinate, 0.0, 1.0)).r * inside.x * inside.y * inside.z;
}

void getLightMap() {
    dLightmap = vec3(0.0);
    if (uSkyVisibilityReady > 0.5 && uBlockLightReady > 0.5)
        dLightmap = uSkyRadiance * skyLightAtSurface() + uBlockLightTint * blockLightAtSurface();
}
`;
