import { MATERIAL_LAYER_COUNT } from '../scene/voxel-render-pipeline';

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
void getEmission() {
    int layer = clamp(int(floor(vVertexColor.a * 255.0 + 0.5)), 0, ${MATERIAL_LAYER_COUNT - 1});
    dEmission = uVoxelEmission[layer].rgb * uVoxelEmission[layer].a;
}
`;
