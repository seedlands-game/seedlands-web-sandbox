import * as pc from 'playcanvas';
import { type HeldAction, viewmodelPose } from '../client/gameplay-model-definition';
import { acquireGameplayModelAssets, type GameplayModelAssetsLease } from './gameplay-model-assets';

export class FirstPersonViewmodel {
  private readonly root = new pc.Entity('First person viewmodel');
  private readonly handPivot = new pc.Entity('viewmodel hand pivot');
  private readonly forearm = new pc.Entity('viewmodel forearm');
  private readonly held = new pc.Entity('viewmodel held item');
  private readonly item = new pc.Entity('viewmodel replaceable item');
  private readonly assetsLease: GameplayModelAssetsLease;
  private action: HeldAction = 'idle';
  private actionSeconds = 0;
  private heldItem: string | null = null;

  constructor(
    private readonly app: pc.Application,
    private readonly camera: pc.Entity,
  ) {
    this.assetsLease = acquireGameplayModelAssets(app);
    // Screen anchor: hand at the lower-right; the tool extends left and upward from its grip.
    this.root.setLocalPosition(0.42, -0.36, -1.05);
    this.root.setLocalEulerAngles(-4, -10, 0);
    camera.addChild(this.root);
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
  }

  setHeldItem(itemId: string | null): void {
    if (itemId === this.heldItem) return;
    this.heldItem = itemId;
    while (this.item.children.length) this.item.children[0].destroy();
    if (itemId) this.assets.addItem(this.item, itemId, 0.55);
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
    const aspect = this.app.graphicsDevice.width / Math.max(1, this.app.graphicsDevice.height);
    const fov = this.camera.camera?.fov ?? 72;
    const horizontalAnchor = 0.62 * aspect * Math.tan((fov * Math.PI) / 360) * 1.05;
    this.root.setLocalPosition(horizontalAnchor, -0.36, -1.05);
    const pose = viewmodelPose(this.action, this.actionSeconds);
    this.handPivot.setLocalEulerAngles(pose.shoulder * 0.32, pose.wrist * 0.08, pose.elbow * 0.2);
  }

  dispose(): void {
    this.root.destroy();
    this.assetsLease.release();
  }

  private get assets() {
    return this.assetsLease.assets;
  }
}
