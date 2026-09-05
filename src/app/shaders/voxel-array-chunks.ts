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
uniform float uOpacityVoxelLayer;

void getOpacity() {
    vec3 voxelUv = vec3(fract({STD_OPACITY_TEXTURE_UV}), uOpacityVoxelLayer);
    dAlpha = material_opacity * texture(texture_voxelArray, voxelUv).a;
}
`;

export const voxelArrayLanternEmissionGlsl = /* glsl */ `
uniform vec3 material_emissive;
uniform float material_emissiveIntensity;

void getEmission() {
    float voxelLayer = floor(vVertexColor.a * 255.0 + 0.5);
    float glowstoneMask = 1.0 - step(0.5, abs(voxelLayer - 10.0));
    float lanternMask = 1.0 - step(0.5, abs(voxelLayer - 12.0));
    dEmission = material_emissive * material_emissiveIntensity * max(glowstoneMask, lanternMask);
}
`;

export const voxelArrayLanternEmissionWgsl = /* wgsl */ `
uniform material_emissive: vec3f;
uniform material_emissiveIntensity: f32;

fn getEmission() {
    let voxelLayer: f32 = round(vVertexColor.a * 255.0);
    let glowstoneMask: f32 = 1.0 - step(0.5, abs(voxelLayer - 10.0));
    let lanternMask: f32 = 1.0 - step(0.5, abs(voxelLayer - 12.0));
    dEmission = uniform.material_emissive * uniform.material_emissiveIntensity * max(glowstoneMask, lanternMask);
}
`;

export const voxelWaterReflectionEmissionGlsl = /* glsl */ `
uniform vec3 material_emissive;
uniform float material_emissiveIntensity;
uniform sampler2D texture_planarReflection;
uniform vec2 uReflectionViewport;
uniform float uReflectionStrength;
uniform float uReflectionWaterPlaneY;

void getEmission() {
    vec2 reflectionUv = gl_FragCoord.xy / max(uReflectionViewport, vec2(1.0));
    reflectionUv.y = 1.0 - reflectionUv.y;
    vec3 reflectedScene = texture(texture_planarReflection, reflectionUv).rgb;
    float upwardSurface = smoothstep(0.72, 0.98, max(dNormalW.y, 0.0));
    vec3 viewDirection = normalize(view_position - vPositionW);
    float fresnel = pow(1.0 - clamp(dot(max(dNormalW, vec3(0.0)), viewDirection), 0.0, 1.0), 3.0);
    float selectedWaterPlane = 1.0 - smoothstep(0.006, 0.02, abs(vPositionW.y - uReflectionWaterPlaneY));
    float reflectionMix = upwardSurface * selectedWaterPlane * mix(0.22, 1.0, fresnel);
    dEmission = material_emissive * material_emissiveIntensity + reflectedScene * uReflectionStrength * reflectionMix;
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
uniform uOpacityVoxelLayer: f32;

fn getOpacity() {
    let voxelUv: vec2f = fract({STD_OPACITY_TEXTURE_UV});
    dAlpha = uniform.material_opacity * textureSampleBias(texture_voxelArray, texture_voxelArraySampler, voxelUv, i32(uniform.uOpacityVoxelLayer), uniform.textureBias).a;
}
`;
