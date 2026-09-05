import type { VoxelTarget } from '../client/voxel-target';
import { createCollisionDebugBatch, type CollisionDebugBatch } from '../client/collision-debug-projection';
import { bodyKindForEntity } from '../physics/body-registry';
import type { BodyState } from '../physics';
import type { AuthoritySnapshot } from '../server/authority/authority-session';
import { CollisionDebugRenderer } from './collision-debug-renderer';
import type * as pc from 'playcanvas';

export class CollisionDebugRuntime {
  private readonly renderer: CollisionDebugRenderer;
  private enabled = false;
  private batch: CollisionDebugBatch | null = null;

  constructor(app: pc.Application) {
    this.renderer = new CollisionDebugRenderer(app);
  }

  get status() {
    if (!this.batch) return null;
    return {
      authorityTick: this.batch.physicsTick,
      predictionTick:
        this.batch.lines.find((line) => line.source === 'predicted-body')?.physicsTick ?? this.batch.physicsTick,
      visibleBodyCount: this.batch.visibleBodyCount,
      truncatedBodyCount: this.batch.truncatedBodyCount,
    };
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.renderer.setEnabled(this.enabled);
    if (!this.enabled) this.batch = null;
  }

  update(
    snapshot: AuthoritySnapshot | null,
    prediction: Readonly<{ state: BodyState; physicsTick: number }> | null,
    target: VoxelTarget | null,
  ): void {
    if (!this.enabled || !snapshot) return;
    this.batch = createCollisionDebugBatch(
      {
        epoch: snapshot.epoch,
        physicsTick: snapshot.physicsTick,
        authoritative: snapshot.entities.map((entity) => ({
          id: entity.id,
          kind: bodyKindForEntity(entity),
          state: entity.body,
          grounded: entity.grounded,
          contacts: entity.contacts,
        })),
        ...(prediction
          ? {
              predictedPlayer: {
                id: snapshot.player.id,
                kind: 'player' as const,
                state: prediction.state,
                physicsTick: prediction.physicsTick,
              },
            }
          : {}),
        ...(target ? { targetVoxel: { position: target.position, voxel: target.voxel } } : {}),
        truncatedBodyCount: 0,
      },
      snapshot.player.body.position,
      { includeContacts: true, includePickupSensors: true },
    );
    this.renderer.update(this.batch);
  }

  dispose(): void {
    this.renderer.dispose();
    this.enabled = false;
    this.batch = null;
  }
}
