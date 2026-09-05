import * as pc from 'playcanvas';
import { BreakOverlayState, type BreakOverlaySnapshot } from './break-overlay-state';
import { crackSegmentsForStage } from './break-overlay-pattern';

function crackCanvas(stage: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, 128, 128);
  context.strokeStyle = 'rgba(8, 6, 5, 0.92)';
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = 2.6;
  for (const segment of crackSegmentsForStage(stage)) {
    context.beginPath();
    context.moveTo(segment.from[0], segment.from[1]);
    context.lineTo(segment.to[0], segment.to[1]);
    context.stroke();
  }
  return canvas;
}

export class VoxelBreakOverlay {
  private readonly entity = new pc.Entity('Voxel Break Overlay');
  private readonly material = new pc.StandardMaterial();
  private readonly textures: pc.Texture[];
  private readonly state = new BreakOverlayState();
  private stage = -1;

  constructor(app: pc.Application) {
    this.textures = Array.from({ length: 10 }, (_unused, stage) => {
      const canvas = crackCanvas(stage);
      const texture = new pc.Texture(app.graphicsDevice, {
        name: `voxel-break-stage-${stage}`,
        width: canvas.width,
        height: canvas.height,
        mipmaps: true,
        minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: pc.FILTER_LINEAR,
        addressU: pc.ADDRESS_CLAMP_TO_EDGE,
        addressV: pc.ADDRESS_CLAMP_TO_EDGE,
        srgb: true,
      });
      texture.setSource(canvas);
      return texture;
    });
    this.material.name = 'voxel-break-overlay';
    this.material.diffuse = new pc.Color(0.025, 0.018, 0.014);
    this.material.emissive = new pc.Color(0.018, 0.012, 0.009);
    this.material.opacityMap = this.textures[0];
    this.material.opacityMapChannel = 'a';
    this.material.alphaTest = 0.08;
    this.material.blendType = pc.BLEND_NORMAL;
    this.material.depthWrite = false;
    this.material.depthBias = -2;
    this.material.slopeDepthBias = -1;
    this.material.update();
    this.entity.addComponent('render', {
      type: 'box',
      material: this.material,
      castShadows: false,
      receiveShadows: false,
    });
    this.entity.setLocalScale(1.008, 1.008, 1.008);
    this.entity.enabled = false;
    app.root.addChild(this.entity);
  }

  update(position: readonly [number, number, number] | null, progress: number | null): void {
    const snapshot = position && progress !== null ? this.state.update(position, progress) : this.state.clear();
    if (!snapshot) {
      this.entity.enabled = false;
      this.stage = -1;
      return;
    }
    if (snapshot.stage !== this.stage) {
      this.stage = snapshot.stage;
      this.material.opacityMap = this.textures[this.stage];
      this.material.update();
    }
    this.entity.setPosition(snapshot.position[0] + 0.5, snapshot.position[1] + 0.5, snapshot.position[2] + 0.5);
    this.entity.enabled = true;
  }

  get snapshot(): BreakOverlaySnapshot | null {
    return this.state.current;
  }

  destroy(): void {
    this.entity.destroy();
    this.material.destroy();
    this.textures.forEach((texture) => texture.destroy());
  }
}
