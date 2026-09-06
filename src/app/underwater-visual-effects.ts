import * as pc from 'playcanvas';

const fragmentShader = /* glsl */ `
uniform sampler2D uColorBuffer;
uniform float uUnderwaterBlend;
varying vec2 vUv0;

void main() {
    vec4 source = texture2D(uColorBuffer, vUv0);
    float luminance = dot(source.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 absorbed = source.rgb * vec3(0.34, 0.66, 0.78);
    absorbed = mix(absorbed, vec3(0.018, 0.19, 0.29) + luminance * vec3(0.025, 0.085, 0.12), 0.52);
    vec2 centered = vUv0 - vec2(0.5);
    float edge = 1.0 - dot(centered, centered) * 0.22 * uUnderwaterBlend;
    gl_FragColor = vec4(mix(source.rgb, absorbed * edge, uUnderwaterBlend), source.a);
}
`;

class UnderwaterTintEffect extends pc.PostEffect {
  private readonly shader: pc.Shader;
  blend = 0;

  constructor(device: pc.GraphicsDevice) {
    super(device);
    this.shader = pc.ShaderUtils.createShader(device, {
      uniqueName: 'seedlands-underwater-absorption',
      attributes: { aPosition: pc.SEMANTIC_POSITION },
      vertexGLSL: pc.PostEffect.quadVertexShader,
      fragmentGLSL: fragmentShader,
    });
  }

  override render(inputTarget: pc.RenderTarget, outputTarget: pc.RenderTarget | null, rect?: pc.Vec4) {
    this.device.scope.resolve('uColorBuffer').setValue(inputTarget.colorBuffer);
    this.device.scope.resolve('uUnderwaterBlend').setValue(this.blend);
    this.drawQuad(outputTarget, this.shader, rect);
  }

  destroy() {
    this.shader.destroy();
  }
}

export class UnderwaterVisualEffects {
  private readonly effect: UnderwaterTintEffect | null;
  private attached = false;
  private blend = 0;

  constructor(
    private readonly camera: pc.CameraComponent | null,
    device: pc.GraphicsDevice,
  ) {
    this.effect = camera ? new UnderwaterTintEffect(device) : null;
  }

  update(seconds: number, submerged: boolean): number {
    const target = submerged ? 1 : 0;
    const response = submerged ? 4.5 : 3.2;
    this.blend += (target - this.blend) * Math.min(1, Math.max(0, seconds) * response);
    if (this.effect) {
      this.effect.blend = this.blend;
      if (!this.attached && this.blend > 0.002) {
        this.camera?.postEffects.addEffect(this.effect);
        this.attached = true;
      } else if (this.attached && this.blend < 0.002 && !submerged) {
        this.camera?.postEffects.removeEffect(this.effect);
        this.attached = false;
        this.blend = 0;
      }
    }
    return this.blend;
  }

  get amount() {
    return this.blend;
  }

  destroy() {
    if (!this.effect) return;
    if (this.attached) this.camera?.postEffects.removeEffect(this.effect);
    this.attached = false;
    this.effect.destroy();
  }
}
