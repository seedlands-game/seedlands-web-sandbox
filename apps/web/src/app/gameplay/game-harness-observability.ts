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
import type { HarnessMediaSnapshot, RenderedMaterialMeshSummary } from '../app-contracts';
import type { FaceMaterialId } from '@seedlands/stdlib/world/voxel';
import type { HarnessApi } from './game-harness-contract';
import type { RenderedMaterialMeshSummary as WorldRenderedMaterialMeshSummary } from '../world/world-runtime';

export type HarnessObservabilityBindings = Readonly<{
  authority: () => Readonly<{ runtimeEpoch: string; voxelGeometry?: VoxelGeometryRegistryV1 }> | null;
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

type HarnessObservabilityApi = Pick<HarnessApi, 'getVoxelGeometry' | 'getRenderedMaterialMesh' | 'mediaSnapshot'>;

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
  });
}
