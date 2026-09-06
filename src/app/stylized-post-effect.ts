import * as pc from 'playcanvas';

const fragmentShader = /* glsl */ `
uniform sampler2D uColorBuffer;
uniform float uStrength;
varying vec2 vUv0;

void main() {
    vec4 source = texture2D(uColorBuffer, vUv0);
    float luminance = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 saturated = mix(vec3(luminance), source.rgb, 1.0 + uStrength * 0.22);
    vec3 contrasted = (saturated - 0.5) * (1.0 + uStrength * 0.16) + 0.5;
    vec3 warmHighlights = vec3(0.025, 0.009, -0.012) * smoothstep(0.45, 1.0, luminance);
    vec2 centered = vUv0 - vec2(0.5);
    float vignette = 1.0 - dot(centered, centered) * uStrength * 0.32;
    gl_FragColor = vec4(max(vec3(0.0), (contrasted + warmHighlights) * vignette), source.a);
}
`;

class StylizedColorGradeEffect extends pc.PostEffect {
  private readonly shader: pc.Shader;

  constructor(
    device: pc.GraphicsDevice,
    private readonly strength: number,
  ) {
    super(device);
    this.shader = pc.ShaderUtils.createShader(device, {
      uniqueName: `seedlands-stylized-grade-${strength}`,
      attributes: { aPosition: pc.SEMANTIC_POSITION },
      vertexGLSL: pc.PostEffect.quadVertexShader,
      fragmentGLSL: fragmentShader,
    });
  }

  override render(inputTarget: pc.RenderTarget, outputTarget: pc.RenderTarget | null, rect?: pc.Vec4) {
    this.device.scope.resolve('uColorBuffer').setValue(inputTarget.colorBuffer);
    this.device.scope.resolve('uStrength').setValue(this.strength);
    this.drawQuad(outputTarget, this.shader, rect);
  }

  destroy() {
    this.shader.destroy();
  }
}

export class StylizedPostProcessing {
  private readonly effect: StylizedColorGradeEffect;

  constructor(
    private readonly camera: pc.CameraComponent,
    device: pc.GraphicsDevice,
    strength: number,
  ) {
    this.effect = new StylizedColorGradeEffect(device, strength);
    camera.postEffects.addEffect(this.effect);
  }

  destroy() {
    this.camera.postEffects.removeEffect(this.effect);
    this.effect.destroy();
  }
}
