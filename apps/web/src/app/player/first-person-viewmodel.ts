import type { ItemDefinition } from '@seedlands/stdlib/server/gameplay/item-registry';
import { requireClassicItemDefinition } from '../../client/presentation/classic-item-registry';
import type { CombatSnapshot } from '@seedlands/stdlib/server/gameplay/combat-runtime';
import { combatViewmodelPose } from '../../client/presentation/combat-viewmodel-pose';
import * as pc from 'playcanvas';
import { type HeldAction, viewmodelPose } from '../../client/presentation/gameplay-model-definition';
import { addPlayerArm } from '../gameplay/builtin-actor-models';
import {
  acquireGameplayModelAssets,
  type GameplayModelAssetsLease,
  type GameplayModelAssets,
} from '../gameplay/gameplay-model-assets';
import { resolveViewmodelLayout } from '../../client/presentation/viewmodel-layout';

import { createDraftPixelResource } from '../gameplay/pixel-model-resource';
import type { ToolModel } from '../../client/presentation/asset-types';

export class FirstPersonViewmodel {
  private releaseDraft: (() => void) | null = null;
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
  private heldTool = false;
  private combat: CombatSnapshot['active'] = null;
  private pose = { shoulder: 0, elbow: 0, wrist: 0 };
  private releasePose = { shoulder: 0, elbow: 0, wrist: 0 };

  constructor(
    private readonly app: pc.Application,
    private readonly camera: pc.Entity,
    assets?: GameplayModelAssets,
  ) {
    this.assetsLease = assets ? { assets, release: () => {} } : acquireGameplayModelAssets(app);
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
    // Point the canonical downward arm toward the grip; the sleeve extends out of the lower screen.
    this.forearm.setLocalPosition(0, -0.3375, -0.14);
    this.held.setLocalEulerAngles(0, 0, 24);
    this.root.addChild(this.handPivot);
    this.handPivot.addChild(this.held);
    this.held.addChild(this.forearm);
    this.held.addChild(this.item);
    const arm = new pc.Entity('viewmodel arm orientation');
    arm.setLocalEulerAngles(0, 0, 180);
    this.forearm.addChild(arm);
    addPlayerArm(this.assets, arm);
    this.applyLayer(this.root);
  }

  setHeldItem(itemId: string | null, definition?: ItemDefinition | null): void {
    if (itemId === this.heldItem && !this.releaseDraft) return;
    this.releaseDraft?.();
    this.releaseDraft = null;
    this.heldItem = itemId;
    this.heldTool = false;
    // Inventory may empty before a successful place/eat gesture is presented.
    // Only the continuous mining action belongs to the previous held item.
    if (this.action === 'mine') this.setAction('idle');
    while (this.item.children.length) this.item.children[0].destroy();
    if (itemId) {
      const itemDefinition = definition ?? requireClassicItemDefinition(itemId);
      this.heldTool = itemDefinition.itemType === 'tool';
      const scale = this.heldTool ? 0.95 : 0.55;
      this.assets.addItem(this.item, itemId, scale, undefined, definition);
      this.applyLayer(this.item);
    }
  }

  setHeldDefinition(definition: ToolModel): void {
    this.setHeldItem(null);
    this.heldTool = true;
    this.releaseDraft = createDraftPixelResource(this.app, this.item, definition, 0.95);
    this.applyLayer(this.item);
  }

  setAction(action: HeldAction, restart = false): void {
    if (action === this.action && !restart) return;
    this.releasePose = { ...this.pose };
    this.action = action;
    this.actionSeconds = 0;
  }

  setCombatAction(active: CombatSnapshot['active']): void {
    this.combat = active;
  }

  setVisible(visible: boolean): void {
    this.root.enabled = visible;
  }

  update(seconds: number): void {
    this.actionSeconds += Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const fov = this.camera.camera?.fov ?? 72;
    const layout = resolveViewmodelLayout({
      width: this.app.graphicsDevice.width,
      height: this.app.graphicsDevice.height,
      fov,
    });
    this.root.setLocalPosition(layout.position.x, layout.position.y, layout.position.z);
    this.root.setLocalScale(layout.scale, layout.scale, layout.scale);
    if (this.viewmodelCamera?.camera) this.viewmodelCamera.camera.fov = fov;
    const narrowTool = this.heldTool && this.app.graphicsDevice.width < this.app.graphicsDevice.height;
    const itemScale = narrowTool ? 0.79 : 1;
    this.item.setLocalScale(itemScale, itemScale, itemScale);
    this.item.setLocalEulerAngles(0, 0, narrowTool ? -16 : 0);
    const authoritativePose = combatViewmodelPose(this.combat);
    const pose = { ...(authoritativePose ?? viewmodelPose(this.action, this.actionSeconds)) };
    if (!authoritativePose && this.action === 'idle') {
      const progress = Math.min(1, this.actionSeconds / 0.16);
      const remaining = 1 - progress * progress * (3 - 2 * progress);
      pose.shoulder = this.releasePose.shoulder * remaining;
      pose.elbow = this.releasePose.elbow * remaining;
      pose.wrist = this.releasePose.wrist * remaining;
    }
    this.pose = pose;
    this.handPivot.setLocalEulerAngles(pose.shoulder * 0.6, pose.wrist * 0.35, pose.elbow * 0.5);
  }

  dispose(): void {
    this.releaseDraft?.();
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
    for (const component of root.findComponents('render')) {
      (component as pc.RenderComponent).layers = [this.layer.id];
      (component as pc.RenderComponent).castShadows = false;
    }
  }
}
