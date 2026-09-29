import { MATERIAL_LAYER_COUNT } from '../scene/voxel-render-pipeline';
import { voxelBlockLightGlsl } from './voxel-block-light-chunk';

// One entry per FaceMaterial layer. Keep surface parameters in the same batch as its texture.
export const voxelAppearanceGlossGlsl = /* glsl */ `
uniform vec2 uVoxelSurface[${MATERIAL_LAYER_COUNT}];
void getGlossiness() {
    int layer = clamp(int(floor(vVertexColor.a * 255.0 + 0.5)), 0, ${MATERIAL_LAYER_COUNT - 1});
    dGlossiness = uVoxelSurface[layer].x + 0.0000001;
}
`;
export const voxelAppearanceMetalnessGlsl = /* glsl */ `
uniform vec2 uVoxelSurface[${MATERIAL_LAYER_COUNT}];
void getMetalness() {
    int layer = clamp(int(floor(vVertexColor.a * 255.0 + 0.5)), 0, ${MATERIAL_LAYER_COUNT - 1});
    dMetalness = uVoxelSurface[layer].y;
}
`;
export const voxelAppearanceEmissionGlsl = /* glsl */ `
uniform vec4 uVoxelEmission[${MATERIAL_LAYER_COUNT}];
uniform float uVoxelEmissionThreshold[${MATERIAL_LAYER_COUNT}];
uniform float uVoxelEmissionRedDominance[${MATERIAL_LAYER_COUNT}];
${voxelBlockLightGlsl}

void getEmission() {
    int layer = clamp(int(floor(vVertexColor.a * 255.0 + 0.5)), 0, ${MATERIAL_LAYER_COUNT - 1});
    float sourceLuminance = dot(max(dAlbedo, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
    float threshold = uVoxelEmissionThreshold[layer];
    float sourceUpper = min(0.98, threshold + 0.18);
    float sourceMask = threshold >= 0.98
        ? step(threshold, sourceLuminance)
        : smoothstep(threshold, sourceUpper, sourceLuminance);
    float redDominance = uVoxelEmissionRedDominance[layer];
    float redMask = smoothstep(redDominance, redDominance + 0.14, dAlbedo.r - max(dAlbedo.g, dAlbedo.b));
    sourceMask *= redDominance == 0.0 ? 1.0 : redMask;
    vec3 sourceColor = mix(dAlbedo, uVoxelEmission[layer].rgb, 0.15);
    dEmission = sourceColor * uVoxelEmission[layer].a * sourceMask + dAlbedo * blockLightAtSurface() * 0.78;
}
`;
