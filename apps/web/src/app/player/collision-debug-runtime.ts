import type { VoxelTarget } from '../../client/presentation/voxel-target';
import {
  createCollisionDebugBatch,
  type CollisionDebugBatch,
} from '../../client/presentation/collision-debug-projection';
import { bodyKindForEntity, bodySensorsFor } from '@seedlands/game-core/physics/body-registry';
import type { BodyState } from '@seedlands/game-core/physics';
import type { AuthoritySnapshot } from '@seedlands/game-core/server/authority/authority-session';
import { CollisionDebugRenderer } from './collision-debug-renderer';
import type * as pc from 'playcanvas';

export class CollisionDebugRuntime {
  private readonly renderer: CollisionDebugRenderer;
  private enabled = false;
  private includeContacts = false;
  private includeSensors = true;
  private batch: CollisionDebugBatch | null = null;

  constructor(app: pc.Application) {
    this.renderer = new CollisionDebugRenderer(app);
  }

  get diagnostics() {
    return { ...this.renderer.diagnostics, authorityRequestCount: 0 as const };
  }

  get status() {
    if (!this.enabled) return null;
    return {
      enabled: true as const,
      includeContacts: this.includeContacts,
      includeSensors: this.includeSensors,
      authorityTick: this.batch?.physicsTick ?? 0,
      predictionTick:
        this.batch?.lines.find((line) => line.source === 'predicted-body')?.physicsTick ?? this.batch?.physicsTick ?? 0,
      visibleBodyCount: this.batch?.visibleBodyCount ?? 0,
      truncatedBodyCount: this.batch?.truncatedBodyCount ?? 0,
      contactCount: this.batch?.contactCount ?? 0,
      sensorCount: this.batch?.visibleSensorCount ?? 0,
    };
  }

  toggle(): boolean {
    return this.setEnabled(!this.enabled);
  }

  setEnabled(enabled: boolean): boolean {
    this.enabled = enabled;
    this.renderer.setEnabled(enabled);
    if (!enabled) this.batch = null;
    return enabled;
  }

  setDetails(details: Readonly<{ contacts?: boolean; sensors?: boolean }>): void {
    if (details.contacts !== undefined) this.includeContacts = details.contacts;
    if (details.sensors !== undefined) this.includeSensors = details.sensors;
    this.batch = null;
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
        authoritative: snapshot.entities.map((entity) => {
          const kind = bodyKindForEntity(entity);
          return {
            id: entity.id,
            kind,
            state: entity.body,
            grounded: entity.grounded,
            contacts: entity.contacts,
            sensors: bodySensorsFor(kind).map((sensor) => ({
              ...sensor,
              center: { ...entity.body.position },
            })),
          };
        }),
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
      { includeContacts: this.includeContacts, includeSensors: this.includeSensors },
    );
    this.renderer.update(this.batch);
  }

  dispose(): void {
    this.renderer.dispose();
    this.enabled = false;
    this.batch = null;
  }
}
