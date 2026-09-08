// One entry per FaceMaterial layer. Keep surface parameters in the same batch as its texture.
export const voxelAppearanceGlossGlsl = /* glsl */ `
uniform vec2 uVoxelSurface[13];
void getGlossiness() {
    int layer = clamp(int(floor(vVertexColor.a * 255.0 + 0.5)), 0, 12);
    dGlossiness = uVoxelSurface[layer].x + 0.0000001;
}
`;
export const voxelAppearanceMetalnessGlsl = /* glsl */ `
uniform vec2 uVoxelSurface[13];
void getMetalness() {
    int layer = clamp(int(floor(vVertexColor.a * 255.0 + 0.5)), 0, 12);
    dMetalness = uVoxelSurface[layer].y;
}
`;
export const voxelAppearanceEmissionGlsl = /* glsl */ `
uniform vec4 uVoxelEmission[13];
void getEmission() {
    int layer = clamp(int(floor(vVertexColor.a * 255.0 + 0.5)), 0, 12);
    dEmission = uVoxelEmission[layer].rgb * uVoxelEmission[layer].a;
}
`;
