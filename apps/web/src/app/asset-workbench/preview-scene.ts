import * as pc from 'playcanvas';
import { getItemDefinition } from '@seedlands/game-core/server/gameplay/item-registry';
import { builtinItemBindings } from '../../client/presentation/asset-catalog';
import { GameplayModelAssets } from '../gameplay/gameplay-model-assets';
import { setAppearanceResources } from '../gameplay/appearance-runtime';
import type { AppearanceProject } from '../../client/presentation/appearance-project';
import type { Asset } from '../../client/presentation/asset-types';
import type { HeldAction } from '../../client/presentation/gameplay-model-definition';
import { resolvePixelModel } from '../../client/presentation/asset-package';
import { publicAssetUrl } from '../../client/presentation/public-asset-url';
import { createDraftPixelResource } from '../gameplay/pixel-model-resource';
import { pixelCanvas } from '../gameplay/asset-image';
import { FirstPersonViewmodel } from '../player/first-person-viewmodel';
import { addBuiltinActorModel, addPlayerArm } from '../gameplay/builtin-actor-models';
import { addVoxelPreview } from './voxel-preview-resource';
import { addGlbModel } from '../gameplay/glb-model-resource';
import type { ModelAnimationPlayback } from '../gameplay/model-animation';
import { terrainMaterials } from '../../client/presentation/terrain-assets';
import { modelMaterialDefinitions } from '../../client/presentation/model-material-definitions';

export class PreviewScene {
  readonly app: pc.Application;
  private camera: pc.Entity;
  private pivot: pc.Entity;
  private light: pc.Entity;
  private viewmodel: FirstPersonViewmodel | null = null;
  private release: (() => void) | null = null;
  private glbPlayback: ModelAnimationPlayback | null = null;
  private generation = 0;
  private disposed = false;
  private abort: AbortController | null = null;
  private yaw = 25;
  private pitch = 12;
  private distance = 2.4;
  private initialDistance = 2.4;
  private observer: ResizeObserver;
  private shownAssetId = '';
  mode: 'model' | 'held' = 'model';

  constructor(
    private canvas: HTMLCanvasElement,
    project?: AppearanceProject,
    private fixedSize?: number,
  ) {
    this.app = new pc.Application(canvas, {
      graphicsDeviceOptions: {
        deviceTypes: [pc.DEVICETYPE_WEBGL2],
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      },
    });
    if (this.app.graphicsDevice.deviceType !== 'webgl2') {
      this.app.destroy();
      throw new Error('3D 预览需要 WebGL2');
    }
    this.camera = new pc.Entity('Asset preview camera', this.app);
    this.pivot = new pc.Entity('Asset preview content', this.app);
    this.light = new pc.Entity('Asset preview light', this.app);
    if (project) setAppearanceResources(this.app, project);
    this.camera.addComponent('camera', {
      clearColor: fixedSize ? new pc.Color(0, 0, 0, 0) : new pc.Color(0.06, 0.08, 0.09),
      fov: 48,
      nearClip: 0.01,
      farClip: 50,
    });
    this.app.root.addChild(this.camera);
    this.app.root.addChild(this.pivot);
    this.light.addComponent('light', { type: 'directional', intensity: 1.4, color: new pc.Color(1, 0.94, 0.85) });
    this.light.setLocalEulerAngles(40, 25, 0);
    this.app.root.addChild(this.light);
    this.app.scene.ambientLight = new pc.Color(0.55, 0.58, 0.62);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.app.on('update', (dt: number) => this.viewmodel?.update(dt));
    this.reset();
    this.app.start();
  }
  private resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio, 2);
    this.app.setCanvasResolution(
      pc.RESOLUTION_FIXED,
      this.fixedSize ?? Math.max(1, Math.floor(width * ratio)),
      this.fixedSize ?? Math.max(1, Math.floor(height * ratio)),
    );
  }
  private clear() {
    this.pivot.setLocalPosition(0, 0, 0);
    this.pivot.setLocalEulerAngles(0, 0, 0);
    this.viewmodel?.dispose();
    this.viewmodel = null;
    this.release?.();
    this.release = null;
    this.glbPlayback = null;
    while (this.pivot.children.length) this.pivot.children[0].destroy();
  }
  async show(asset: Asset, all: Asset[], mode: 'model' | 'held', filtering: 'nearest' | 'linear', repeat: number) {
    const generation = ++this.generation;
    this.abort?.abort();
    this.abort = new AbortController();
    const sceneAssets = new GameplayModelAssets(this.app, all);
    const stage = new pc.Entity('Asset preview staging', this.app);
    stage.enabled = false;
    let release: (() => void) | null = null;
    let glbPlayback: ModelAnimationPlayback | null = null;
    let viewmodel: FirstPersonViewmodel | null = null;
    let distance: number;
    try {
      if (asset.type === 'extruded-pixel-model') {
        const definition = resolvePixelModel(asset, all);
        distance = Math.max(2.4, (definition.pixels.length / (definition.pixelsPerUnit ?? 16)) * 2.4);
        if (mode === 'held') {
          viewmodel = new FirstPersonViewmodel(this.app, this.camera, sceneAssets);
          viewmodel.setVisible(false);
          viewmodel.setHeldDefinition(definition);
        } else release = createDraftPixelResource(this.app, stage, definition);
      } else if (asset.type === 'builtin-item-model') {
        distance = 1.5;
        if (mode === 'held') {
          viewmodel = new FirstPersonViewmodel(this.app, this.camera, sceneAssets);
          viewmodel.setVisible(false);
          viewmodel.setHeldItem(asset.payload.itemId);
        } else sceneAssets.addItem(stage, asset.payload.itemId);
      } else if (asset.type === 'glb-model') {
        distance = 3;
        const lease = await addGlbModel(this.app, stage, asset.payload.modelId, this.abort.signal);
        release = lease.release;
        glbPlayback = lease.playback;
      } else if (asset.type === 'builtin-voxel-model') {
        distance = 2.6;
        release = await addVoxelPreview(this.app, stage, asset.payload.voxelId, undefined, all);
      } else if (asset.type === 'builtin-actor-model') {
        distance = 4;
        const actor = new pc.Entity('Actor preview', this.app);
        stage.addChild(actor);
        addBuiltinActorModel(sceneAssets, actor, asset.payload.kind);
        actor.setLocalPosition(0, -0.9, 0);
      } else if (asset.type === 'builtin-arm-model') {
        distance = 2.4;
        addPlayerArm(sceneAssets, stage);
      } else if (asset.type === 'material') {
        distance = 2.6;
        const terrain = terrainMaterials.find((m) => m.id === asset.id);
        if (terrain) release = await addVoxelPreview(this.app, stage, 2, terrain.faceMaterial, all);
        else {
          const definition = modelMaterialDefinitions.find((m) => `seedlands:material/model/${m.id}` === asset.id);
          const materialAssets = new GameplayModelAssets(
            this.app,
            definition
              ? all
              : [
                  ...all.filter((candidate) => candidate.id !== 'seedlands:material/model/stone'),
                  { ...asset, id: 'seedlands:material/model/stone' },
                ],
          );
          const cube = new pc.Entity('Shared model material', this.app);
          cube.addComponent('render', { type: 'box', material: materialAssets.materials[definition?.id ?? 'stone'] });
          stage.addChild(cube);
          release = () => {
            cube.destroy();
            materialAssets.dispose();
          };
        }
      } else {
        distance = 2.4;
        let source: HTMLCanvasElement | HTMLImageElement;
        if (asset.type === 'pixel-texture') source = pixelCanvas(asset);
        else {
          const image = new Image();
          image.src = publicAssetUrl(import.meta.env.BASE_URL, asset.payload.path);
          await image.decode();
          if (this.disposed || generation !== this.generation) {
            stage.destroy();
            sceneAssets.dispose();
            return;
          }
          source = image;
        }
        const texture = new pc.Texture(this.app.graphicsDevice, {
          srgb: true,
          mipmaps: false,
          minFilter: filtering === 'nearest' ? pc.FILTER_NEAREST : pc.FILTER_LINEAR,
          magFilter: filtering === 'nearest' ? pc.FILTER_NEAREST : pc.FILTER_LINEAR,
          addressU: pc.ADDRESS_REPEAT,
          addressV: pc.ADDRESS_REPEAT,
        });
        texture.setSource(source);
        const material = new pc.StandardMaterial();
        material.diffuseMap = texture;
        material.diffuse = pc.Color.WHITE;
        material.diffuseMapTiling = new pc.Vec2(repeat, repeat);
        material.cull = pc.CULLFACE_NONE;
        material.opacityMap = texture;
        material.opacityMapChannel = 'a';
        material.alphaTest = 0.5;
        material.update();
        const plane = new pc.Entity('Asset texture plane');
        plane.addComponent('render', { type: 'plane', material });
        plane.setLocalEulerAngles(90, 0, 0);
        plane.setLocalScale(1.4, 1, 1.4);
        stage.addChild(plane);
        release = () => {
          plane.destroy();
          material.destroy();
          texture.destroy();
        };
      }
    } catch (error) {
      viewmodel?.dispose();
      release?.();
      stage.destroy();
      sceneAssets.dispose();
      throw error;
    }
    if (this.disposed || generation !== this.generation) {
      viewmodel?.dispose();
      release?.();
      stage.destroy();
      sceneAssets.dispose();
      return;
    }
    this.clear();
    const changed = this.shownAssetId !== asset.id || this.mode !== mode;
    this.shownAssetId = asset.id;
    this.mode = mode;
    this.initialDistance = distance;
    this.pivot.addChild(stage);
    stage.enabled = true;
    this.viewmodel = viewmodel;
    this.glbPlayback = glbPlayback;
    this.viewmodel?.setVisible(true);
    this.light.light!.layers = this.app.scene.layers.layerList.map((layer) => layer.id);
    this.release = () => {
      release?.();
      stage.destroy();
      sceneAssets.dispose();
    };
    if (changed) this.reset();
    this.updateCamera();
  }
  /** Frame the visible model, not its authoring canvas or grip, for readable inventory icons. */
  frameThumbnail() {
    const binding = builtinItemBindings.find((entry) => entry.modelId === this.shownAssetId);
    const tool = binding && getItemDefinition(binding.itemId).itemType === 'tool';
    if (tool) this.pivot.setLocalEulerAngles(0, 0, -35);
    const meshes = (this.pivot.findComponents('render') as pc.RenderComponent[]).flatMap(
      (component) => component.meshInstances,
    );
    if (!meshes.length) throw new Error('缩略图模型没有可见网格');
    const bounds = meshes[0].aabb.clone();
    for (const mesh of meshes.slice(1)) bounds.add(mesh.aabb);
    this.pivot.setLocalPosition(-bounds.center.x, 0.15 - bounds.center.y, -bounds.center.z);
    const view = this.camera.getWorldTransform().clone().invert();
    const points: pc.Vec3[] = [];
    for (const mesh of meshes) {
      const positions: number[] = [];
      mesh.mesh.getPositions(positions);
      const transform = mesh.node.getWorldTransform();
      for (let index = 0; index < positions.length; index += 3) {
        const point = new pc.Vec3(positions[index], positions[index + 1], positions[index + 2]);
        transform.transformPoint(point, point);
        view.transformPoint(point, point);
        points.push(point);
      }
    }
    if (points.length === 0) throw new Error('缩略图模型没有可见像素或顶点');
    // Orthographic GUI framing keeps thin tools and deep blocks equally legible.
    let left = Infinity,
      right = -Infinity,
      bottom = Infinity,
      top = -Infinity;
    for (const point of points) {
      left = Math.min(left, point.x);
      right = Math.max(right, point.x);
      bottom = Math.min(bottom, point.y);
      top = Math.max(top, point.y);
    }
    const centerX = (left + right) / 2;
    const centerY = (bottom + top) / 2;
    this.pivot.translate(this.camera.right.clone().mulScalar(-centerX).add(this.camera.up.clone().mulScalar(-centerY)));
    this.camera.camera!.projection = pc.PROJECTION_ORTHOGRAPHIC;
    this.camera.camera!.orthoHeight = Math.max(right - left, top - bottom) / (2 * 0.88);
    this.distance = Math.max(0.1, bounds.halfExtents.length() * 3);
    this.updateCamera();
  }
  async capturePng(): Promise<string> {
    return new Promise((resolve, reject) => {
      const capture = () => {
        clearTimeout(timer);
        try {
          resolve(this.canvas.toDataURL('image/png'));
        } catch (error) {
          reject(error);
        }
      };
      const timer = setTimeout(() => {
        this.app.off('postrender', capture);
        reject(new Error('缩略图渲染超时'));
      }, 5000);
      this.app.once('postrender', capture);
      this.app.renderNextFrame = true;
    });
  }
  action(action: HeldAction) {
    this.viewmodel?.setAction(action, true);
  }
  playClip(name: string) {
    this.glbPlayback?.play(name, { loop: true, blendSeconds: 0.12 });
  }
  orbit(dx: number, dy: number) {
    if (this.mode === 'held') return;
    this.yaw += dx * 0.5;
    this.pitch = Math.max(-75, Math.min(75, this.pitch + dy * 0.5));
    this.updateCamera();
  }
  zoom(delta: number) {
    this.distance = Math.max(0.5, Math.min(12, this.distance * Math.exp(delta * 0.001)));
    this.updateCamera();
  }
  reset() {
    this.camera.camera!.projection = pc.PROJECTION_PERSPECTIVE;
    this.yaw = 25;
    this.pitch = 12;
    this.distance = this.initialDistance;
    this.updateCamera();
  }
  private updateCamera() {
    if (this.mode === 'held') {
      this.camera.setPosition(0, 0, 0);
      this.camera.setEulerAngles(0, 0, 0);
      return;
    }
    const yaw = (this.yaw * Math.PI) / 180,
      pitch = (this.pitch * Math.PI) / 180;
    this.camera.setPosition(
      Math.sin(yaw) * Math.cos(pitch) * this.distance,
      Math.sin(pitch) * this.distance + 0.15,
      Math.cos(yaw) * Math.cos(pitch) * this.distance,
    );
    this.camera.lookAt(0, 0.15, 0);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort?.abort();
    this.generation++;
    this.observer.disconnect();
    this.clear();
    this.app.destroy();
  }
}
