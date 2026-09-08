import type { RemoteAuthorityClient } from '../../client/authority/remote-authority-client';
import type { RemoteInputDiagnosticSummary } from '../../client/authority/remote-authority-input-diagnostics';
import type { PlayerController } from '../player/player-controller';
import type { World } from './world-runtime';
import { CHUNK_SIZE, floorDiv } from '@seedlands/game-core/world/voxel';

export type RemotePlayableEvidence = Readonly<{
  source: 'remote-node';
  clientEpoch: string;
  serverEpoch: string;
  physicsTick: number;
  commitSequence: number;
  worldRevision: number;
  mutationCount: number;
  authoritativePlayer: [number, number, number];
  presentedPlayer: [number, number, number];
  onGround: boolean;
  interactionBlocked: boolean;
  viewAngles: readonly [number, number];
  aimedVoxel: readonly [number, number, number] | null;
  aimedAdjacent: readonly [number, number, number] | null;
  aimedVoxelType: number | null;
  breakActionPosition: readonly [number, number, number] | null;
  breakActionElapsedSeconds: number | null;
  selectedSlot: number;
  selectedItem: string | null;
  worldItems: readonly Readonly<{ id: string; position: readonly [number, number, number]; itemId: string }>[];
  loadedChunks: number;
  renderedChunks: number;
  readyBaselines: number;
  inputDiagnostics: RemoteInputDiagnosticSummary | null;
}>;

declare global {
  interface Window {
    __seedlandsRemoteEvidence?: {
      snapshot(): RemotePlayableEvidence;
      prediction(): PlayerController['predictionDiagnostics'];
      meshTraceAt(x: number, y: number, z: number): ReturnType<typeof captureRemoteMeshTrace>;
      voxelAt(x: number, y: number, z: number): number;
      chunkRevisionAt(x: number, y: number, z: number): number | null;
      renderedRevisionAt(x: number, y: number, z: number): number | null;
    };
  }
}

export function installRemotePlayableEvidence(
  authority: RemoteAuthorityClient,
  controller: PlayerController,
  world: World,
): () => void {
  const api = Object.freeze({
    prediction: () => controller.predictionDiagnostics,
    snapshot: (): RemotePlayableEvidence => {
      const authorityState = authority.evidenceSnapshot();
      const presented = controller.position;
      const worldState = world.telemetry;
      return Object.freeze({
        source: 'remote-node',
        clientEpoch: authorityState.clientEpoch,
        serverEpoch: authorityState.serverEpoch,
        physicsTick: authorityState.snapshot.physicsTick,
        commitSequence: authorityState.snapshot.commitSequence,
        worldRevision: authorityState.snapshot.worldRevision,
        mutationCount: authorityState.snapshot.worldMutationCount,
        authoritativePlayer: [
          authorityState.snapshot.player.body.position.x,
          authorityState.snapshot.player.body.position.y,
          authorityState.snapshot.player.body.position.z,
        ] as [number, number, number],
        presentedPlayer: [presented.x, presented.y, presented.z] as [number, number, number],
        onGround: controller.onGround,
        interactionBlocked: controller.interactionBlocked,
        viewAngles: controller.viewAngles,
        aimedVoxel: controller.aimedVoxel,
        aimedAdjacent: controller.aimTarget?.adjacent ?? null,
        aimedVoxelType: controller.aimTarget?.voxel ?? null,
        breakActionPosition: authority.gameplay.player.breakAction?.position ?? null,
        breakActionElapsedSeconds: authority.gameplay.player.breakAction?.elapsedSeconds ?? null,
        selectedSlot: authority.gameplay.player.selectedSlot,
        selectedItem: authority.gameplay.player.inventory[authority.gameplay.player.selectedSlot]?.itemId ?? null,
        worldItems: authority.gameplay.entities.flatMap((entity) =>
          entity.type === 'world-item' && entity.stack
            ? [{ id: entity.id, position: entity.position, itemId: entity.stack.itemId }]
            : [],
        ),
        loadedChunks: worldState.loadedChunks,
        renderedChunks: worldState.renderedChunks,
        readyBaselines: authority.readyBaselines,
        inputDiagnostics: authorityState.inputDiagnostics,
      });
    },
    meshTraceAt: (x: number, y: number, z: number) => captureRemoteMeshTrace(world, x, y, z),
    voxelAt: (x: number, y: number, z: number) => world.getVoxel(x, y, z),
    chunkRevisionAt: (x: number, y: number, z: number) =>
      world.getChunkRevision(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)),
    renderedRevisionAt: (x: number, y: number, z: number) =>
      world.getRenderedChunkRevision(floorDiv(x, CHUNK_SIZE), floorDiv(y, CHUNK_SIZE), floorDiv(z, CHUNK_SIZE)),
  });
  window.__seedlandsRemoteEvidence = api;
  return () => {
    if (window.__seedlandsRemoteEvidence === api) delete window.__seedlandsRemoteEvidence;
  };
}

export function captureRemoteMeshTrace(
  world: Pick<World, 'exportTrace' | 'telemetry' | 'transactionDiagnostics'>,
  x: number,
  y: number,
  z: number,
) {
  const key = [x, y, z].map((value) => floorDiv(value, CHUNK_SIZE)).join(',');
  const events = world.exportTrace().traceEvents;
  const ids = new Set(events.filter((event) => event.args?.traceName === key).map((event) => event.args?.traceId));
  const selected = events
    .filter((event) => event.args?.traceId && ids.has(event.args.traceId))
    .sort((a, b) => a.ts - b.ts);
  return {
    key,
    eventCount: selected.length,
    events: selected.slice(-64).map((event) => ({
      name: event.name,
      cat: event.cat,
      ph: event.ph,
      ts: event.ts,
      dur: event.dur,
      tid: event.tid,
      args: { traceId: event.args?.traceId, traceName: key },
    })),
    queues: world.telemetry,
    transactions: world.transactionDiagnostics,
  };
}
