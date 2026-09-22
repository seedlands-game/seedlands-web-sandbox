/** Shared WebGL2 block-light sampling for opaque, cutout, emissive and water materials. */
export const voxelBlockLightGlsl = /* glsl */ `
uniform highp sampler3D texture_blockLight;
uniform vec3 uBlockLightOrigin;
uniform float uBlockLightSize;

float blockLightAtSurface() {
    vec3 voxel = floor(vPositionW + dNormalW * 0.26);
    vec3 coordinate = (voxel + vec3(0.5) - uBlockLightOrigin) / uBlockLightSize;
    vec3 inside = step(vec3(0.0), coordinate) * step(coordinate, vec3(1.0));
    return texture(texture_blockLight, clamp(coordinate, 0.0, 1.0)).r * inside.x * inside.y * inside.z;
}
`;
