import * as pc from 'playcanvas';
import { type HeldAction, viewmodelPose } from '../client/gameplay-model-definition';
import { acquireGameplayModelAssets, type GameplayModelAssetsLease } from './gameplay-model-assets';
import { resolveViewmodelLayout } from '../client/viewmodel-layout';

export class FirstPersonViewmodel {
  private readonly root = new pc.Entity('First person viewmodel');
  private readonly handPivot = new pc.Entity('viewmodel hand pivot');
  private readonly forearm = new pc.Entity('viewmodel forearm');
  private readonly held = new pc.Entity('viewmodel held item');
  private readonly item = new pc.Entity('viewmodel replaceable item');
  private readonly assetsLease: GameplayModelAssetsLease;
  private readonly layer: pc.Layer | null;
  private readonly viewmodelCamera: pc.Entity | null;
  private action: HeldAction = 'idle';
  private actionSeconds = 0;
  private heldItem: string | null = null;

  constructor(
    private readonly app: pc.Application,
    private readonly camera: pc.Entity,
  ) {
    this.assetsLease = acquireGameplayModelAssets(app);
    if (app.root && app.scene?.layers) {
      this.layer = new pc.Layer({ name: 'First Person Viewmodel' });
      app.scene.layers.push(this.layer);
      this.viewmodelCamera = new pc.Entity('First Person Viewmodel Camera');
      camera.addChild(this.viewmodelCamera);
      this.viewmodelCamera.addComponent('camera', {
        clearColorBuffer: false,
        clearDepthBuffer: true,
        fov: camera.camera?.fov ?? 72,
        nearClip: 0.04,
        farClip: 8,
        priority: (camera.camera?.priority ?? 0) + 10,
        layers: [this.layer.id],
      });
    } else {
      this.layer = null;
      this.viewmodelCamera = null;
    }
    // Screen anchor: hand at the lower-right; the tool extends left and upward from its grip.
    this.root.setLocalEulerAngles(-4, -10, 0);
    (this.viewmodelCamera ?? camera).addChild(this.root);
    this.forearm.setLocalPosition(0.035, -0.5, -0.1);
    this.held.setLocalEulerAngles(0, 0, 24);
    this.root.addChild(this.handPivot);
    this.handPivot.addChild(this.held);
    this.held.addChild(this.forearm);
    this.held.addChild(this.item);
    this.assets.addBox(
      this.forearm,
      'sleeve',
      'cloth',
      { x: 0.02, y: 0, z: 0 },
      { x: 0.16, y: 0.6, z: 0.17 },
      { castShadows: false },
    );
    this.assets.addBox(
      this.forearm,
      'sleeve-cuff',
      'brass',
      { x: 0.02, y: 0.27, z: 0 },
      { x: 0.175, y: 0.045, z: 0.18 },
      { castShadows: false },
    );
    this.assets.addBox(
      this.held,
      'hand',
      'skin',
      { x: 0, y: -0.15, z: -0.14 },
      { x: 0.18, y: 0.14, z: 0.15 },
      { castShadows: false },
    );
    this.applyLayer(this.root);
  }

  setHeldItem(itemId: string | null): void {
    if (itemId === this.heldItem) return;
    this.heldItem = itemId;
    while (this.item.children.length) this.item.children[0].destroy();
    if (itemId) {
      this.assets.addItem(this.item, itemId, 0.55);
      this.applyLayer(this.item);
    }
  }

  setAction(action: HeldAction): void {
    if (action === this.action) return;
    this.action = action;
    this.actionSeconds = 0;
  }

  setVisible(visible: boolean): void {
    this.root.enabled = visible;
  }

  update(seconds: number): void {
    this.actionSeconds += Math.max(0, seconds);
    const fov = this.camera.camera?.fov ?? 72;
    const layout = resolveViewmodelLayout({
      width: this.app.graphicsDevice.width,
      height: this.app.graphicsDevice.height,
      fov,
    });
    this.root.setLocalPosition(layout.position.x, layout.position.y, layout.position.z);
    this.root.setLocalScale(layout.scale, layout.scale, layout.scale);
    if (this.viewmodelCamera?.camera) this.viewmodelCamera.camera.fov = fov;
    const pose = viewmodelPose(this.action, this.actionSeconds);
    this.handPivot.setLocalEulerAngles(pose.shoulder * 0.32, pose.wrist * 0.08, pose.elbow * 0.2);
  }

  dispose(): void {
    this.root.destroy();
    this.viewmodelCamera?.destroy();
    if (this.layer) this.app.scene.layers.remove(this.layer);
    this.assetsLease.release();
  }

  get snapshot() {
    return {
      isolatedLayer: this.layer !== null && this.viewmodelCamera?.camera !== undefined,
    } as const;
  }

  private get assets() {
    return this.assetsLease.assets;
  }

  private applyLayer(root: pc.Entity): void {
    if (!this.layer) return;
    for (const component of root.findComponents('render')) (component as pc.RenderComponent).layers = [this.layer.id];
  }
}
