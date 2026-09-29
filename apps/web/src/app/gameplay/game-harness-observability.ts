import {
  createVoxelGeometryRegistryV1,
  type VoxelGeometryDefinitionV1,
  type VoxelGeometryRegistryV1,
} from '@seedlands/stdlib/mod-api';
import {
  cloneMediaPlaybackCommittedBatchV1,
  cloneMediaPlaybackProjectionsV1,
} from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { GameMediaControllerSnapshot } from '../audio/game-media-controller';
import type { HarnessEquipmentSnapshot, HarnessMediaSnapshot, RenderedMaterialMeshSummary } from '../app-contracts';
import type { FaceMaterialId } from '@seedlands/stdlib/world/voxel';
import type { HarnessApi } from './game-harness-contract';
import type { RenderedMaterialMeshSummary as WorldRenderedMaterialMeshSummary } from '../world/world-runtime';
import type { BrowserAuthorityClient } from '../../client/authority/browser-authority-client';
import type { AuthorityInventoryView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';

type HarnessAuthority = Readonly<
  Pick<BrowserAuthorityClient, 'isReady' | 'runtimeEpoch' | 'gameplay' | 'voxelGeometry'>
>;

export type HarnessObservabilityBindings = Readonly<{
  authority: () => HarnessAuthority | null;
  renderedMaterialMesh: (
    cx: number,
    cy: number,
    cz: number,
    material: FaceMaterialId,
  ) => WorldRenderedMaterialMeshSummary | null;
  renderedWorldEpoch: () => string | null;
  media: () => GameMediaControllerSnapshot;
  audio: () => HarnessMediaSnapshot['audio'];
}>;

type HarnessObservabilityApi = Pick<
  HarnessApi,
  'getVoxelGeometry' | 'getRenderedMaterialMesh' | 'mediaSnapshot' | 'equipmentSnapshot'
>;

const cloneFrozenStack = (stack: AuthorityInventoryView['slots'][number]): AuthorityInventoryView['slots'][number] =>
  stack
    ? Object.freeze({
        itemId: stack.itemId,
        count: stack.count,
        ...(stack.instance ? { instance: Object.freeze({ durability: stack.instance.durability }) } : {}),
      })
    : null;

const cloneFrozenOrigin = (
  origin: AuthorityInventoryView['cursor']['origin'],
): AuthorityInventoryView['cursor']['origin'] =>
  origin
    ? Object.freeze(
        origin.kind === 'station' ? { ...origin, reference: Object.freeze({ ...origin.reference }) } : { ...origin },
      )
    : null;

const cloneHarnessEquipmentSnapshot = (
  runtimeEpoch: string,
  gameplay: HarnessAuthority['gameplay'],
): HarnessEquipmentSnapshot => {
  const inventory = gameplay.inventory;
  return Object.freeze({
    runtimeEpoch,
    gameplayRevision: gameplay.gameplayRevision,
    actor: Object.freeze({ ...inventory.actor }),
    inventoryRevision: inventory.revision,
    slots: Object.freeze(inventory.slots.map(cloneFrozenStack)),
    armor: Object.freeze({
      helmet: cloneFrozenStack(inventory.armor.helmet),
      chestplate: cloneFrozenStack(inventory.armor.chestplate),
      leggings: cloneFrozenStack(inventory.armor.leggings),
      boots: cloneFrozenStack(inventory.armor.boots),
    }),
    cursor: Object.freeze({
      version: inventory.cursor.version,
      revision: inventory.cursor.revision,
      stack: cloneFrozenStack(inventory.cursor.stack),
      origin: cloneFrozenOrigin(inventory.cursor.origin),
      craftingGrid: Object.freeze(inventory.cursor.craftingGrid.map(cloneFrozenStack)),
    }),
    player: Object.freeze({ health: gameplay.player.health, lifecycle: gameplay.player.lifecycle }),
    armorPoints: gameplay.armorPoints ?? null,
  });
};

const cloneHarnessVoxelGeometry = (
  registry: VoxelGeometryRegistryV1 | undefined,
  voxel: number,
): VoxelGeometryDefinitionV1 | null => {
  const descriptor = registry?.get(voxel);
  return descriptor ? createVoxelGeometryRegistryV1([descriptor]).require(voxel) : null;
};

const cloneRenderedMaterialMesh = (
  summary: WorldRenderedMaterialMeshSummary | null,
  worldEpoch: string,
): RenderedMaterialMeshSummary | null =>
  summary
    ? Object.freeze({
        ...summary,
        worldEpoch,
        min: Object.freeze([...summary.min]) as readonly [number, number, number],
        max: Object.freeze([...summary.max]) as readonly [number, number, number],
      })
    : null;

function cloneHarnessMediaSnapshot(
  media: GameMediaControllerSnapshot,
  audio: HarnessMediaSnapshot['audio'],
): HarnessMediaSnapshot {
  const currentAudio =
    audio?.epoch === media.worldEpoch
      ? Object.freeze({
          epoch: audio.epoch,
          instances: Object.freeze(audio.instances.map((instance) => Object.freeze({ ...instance }))),
          error: audio.error ? Object.freeze({ ...audio.error }) : null,
        })
      : null;
  return Object.freeze({
    worldEpoch: media.worldEpoch,
    projection: cloneMediaPlaybackProjectionsV1(media.projections),
    lastForwardedBatch: media.lastForwardedBatch
      ? cloneMediaPlaybackCommittedBatchV1(media.lastForwardedBatch, media.worldEpoch ?? undefined)
      : null,
    audio: currentAudio,
  });
}

export function createHarnessObservability(bindings: HarnessObservabilityBindings): HarnessObservabilityApi {
  return Object.freeze({
    getVoxelGeometry: (voxel) => cloneHarnessVoxelGeometry(bindings.authority()?.voxelGeometry, voxel),
    getRenderedMaterialMesh: (cx, cy, cz, material): RenderedMaterialMeshSummary | null => {
      const authority = bindings.authority();
      const worldEpoch = bindings.renderedWorldEpoch();
      if (!authority || !worldEpoch || authority.runtimeEpoch !== worldEpoch) return null;
      const summary = bindings.renderedMaterialMesh(cx, cy, cz, material);
      if (
        !summary ||
        bindings.authority() !== authority ||
        bindings.renderedWorldEpoch() !== worldEpoch ||
        authority.runtimeEpoch !== worldEpoch
      )
        return null;
      return cloneRenderedMaterialMesh(summary, worldEpoch);
    },
    mediaSnapshot: () => cloneHarnessMediaSnapshot(bindings.media(), bindings.audio()),
    equipmentSnapshot: (): HarnessEquipmentSnapshot | null => {
      const authority = bindings.authority();
      if (!authority?.isReady) return null;
      const runtimeEpoch = authority.runtimeEpoch;
      if (!runtimeEpoch) return null;
      const gameplay = authority.gameplay;
      const snapshot = cloneHarnessEquipmentSnapshot(runtimeEpoch, gameplay);
      if (
        bindings.authority() !== authority ||
        !authority.isReady ||
        authority.runtimeEpoch !== runtimeEpoch ||
        authority.gameplay !== gameplay
      )
        return null;
      return snapshot;
    },
  });
}
