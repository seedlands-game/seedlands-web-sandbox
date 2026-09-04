export const voxelArrayDiffuseGlsl = /* glsl */ `
uniform highp sampler2DArray texture_voxelArray;
uniform vec3 material_diffuse;

void getAlbedo() {
    float voxelLayer = floor(vVertexColor.a * 255.0 + 0.5);
    vec3 voxelUv = vec3(fract({STD_DIFFUSE_TEXTURE_UV}), voxelLayer);
    vec3 voxelAlbedo = texture(texture_voxelArray, voxelUv).rgb;
    dAlbedo = material_diffuse.rgb * voxelAlbedo * saturate(vVertexColor.rgb);
}
`;

export const voxelArrayOpacityGlsl = /* glsl */ `
uniform highp sampler2DArray texture_voxelArray;
uniform float material_opacity;
uniform float material_alphaDitherScale;

void getOpacity() {
    float voxelLayer = floor(vVertexColor.a * 255.0 + 0.5);
    vec3 voxelUv = vec3(fract({STD_OPACITY_TEXTURE_UV}), voxelLayer);
    dAlpha = material_opacity * texture(texture_voxelArray, voxelUv).a;
}
`;

export const voxelArrayDiffuseWgsl = /* wgsl */ `
var texture_voxelArray: texture_2d_array<f32>;
var texture_voxelArraySampler: sampler;
uniform material_diffuse: vec3f;

fn getAlbedo() {
    let voxelLayer: i32 = i32(round(vVertexColor.a * 255.0));
    let voxelUv: vec2f = fract({STD_DIFFUSE_TEXTURE_UV});
    let voxelAlbedo: vec3f = textureSampleBias(texture_voxelArray, texture_voxelArraySampler, voxelUv, voxelLayer, uniform.textureBias).rgb;
    dAlbedo = uniform.material_diffuse.rgb * voxelAlbedo * saturate3(vVertexColor.rgb);
}
`;

export const voxelArrayOpacityWgsl = /* wgsl */ `
var texture_voxelArray: texture_2d_array<f32>;
var texture_voxelArraySampler: sampler;
uniform material_opacity: f32;
uniform material_alphaDitherScale: f32;

fn getOpacity() {
    let voxelLayer: i32 = i32(round(vVertexColor.a * 255.0));
    let voxelUv: vec2f = fract({STD_OPACITY_TEXTURE_UV});
    dAlpha = uniform.material_opacity * textureSampleBias(texture_voxelArray, texture_voxelArraySampler, voxelUv, voxelLayer, uniform.textureBias).a;
}
`;
