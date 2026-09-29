import type { CommandResult, ServerCommand } from '@seedlands/stdlib/server/commands/command-contract';
import type { FillCommand } from '@seedlands/stdlib/server/commands/fill-command';
import type { WorldHarnessPort } from '@seedlands/stdlib/server/harness/world-harness-contract';
import type { PerformanceTelemetry } from '../../client/presentation/performance-telemetry';
import type {
  HarnessSnapshot,
  HarnessEquipmentSnapshot,
  HarnessMediaSnapshot,
  LifecycleSnapshot,
  RenderedMaterialMeshSummary,
  StreamingVariant,
} from '../app-contracts';
import type { World } from '../world/world-runtime';
import type { FluidFeedbackTarget } from './fluid-feedback-tracker';
import type { FaceMaterialId } from '@seedlands/stdlib/world/voxel';
import type { VoxelGeometryDefinitionV1 } from '@seedlands/stdlib/mod-api';

type HarnessWorldCommit = Awaited<ReturnType<World['edit']>> | undefined;

export type HarnessApi = {
  world: WorldHarnessPort;
  snapshot: () => HarnessSnapshot;
  lifecycleSnapshot: () => LifecycleSnapshot;
  restartWorld: (seed: string) => Promise<void>;
  moveTo: (x: number, z: number) => Promise<void>;
  burstEdits: () => Promise<void>;
  fillWorld: (command: FillCommand) => Promise<HarnessWorldCommit>;
  removeVoxelAt: (x: number, y: number, z: number) => Promise<void>;
  movePlayerTo: (x: number, y: number, z: number) => Promise<void>;
  prepareFlatMovement: () => Promise<void>;
  prepareCenterExcavation: () => Promise<void>;
  prepareStepDown: () => Promise<void>;
  setWorldTime: (hour: number) => Promise<void>;
  setTimePaused: (paused: boolean) => void;
  setTimeSpeed: (speed: number) => void;
  setView: (yaw: number, pitch: number) => void;
  setSpectatorPosition: (x: number, y: number, z: number) => void;
  beginPerformanceScenario: (name: string) => string;
  setStreamingVariant: (variant: StreamingVariant) => void;
  exportPerformanceTrace: () => ReturnType<PerformanceTelemetry['exportChromeTrace']>;
  executeGameplayCommand: (command: ServerCommand) => Promise<CommandResult>;
  advanceGameplay: (seconds: number) => void;
  setVoxelAt: (x: number, y: number, z: number, voxel: number) => Promise<HarnessWorldCommit>;
  getVoxelAt?: (x: number, y: number, z: number) => number | null;
  advanceFluid?: (seconds: number) => void;
  beginFluidFeedbackSample?: (target?: Omit<FluidFeedbackTarget, 'chunkRevisions'>) => void;
  setWaterTransitionHold?: (held: boolean) => void;
  getFluidCell?: (x: number, y: number, z: number) => { level: number; source: boolean } | null;
  getChunkRevision?: (cx: number, cy: number, cz: number) => number | null;
  getRenderedChunkRevision?: (cx: number, cy: number, cz: number) => number | null;
  getVoxelGeometry: (voxel: number) => VoxelGeometryDefinitionV1 | null;
  getRenderedMaterialMesh: (
    cx: number,
    cy: number,
    cz: number,
    material: FaceMaterialId,
  ) => RenderedMaterialMeshSummary | null;
  mediaSnapshot: () => HarnessMediaSnapshot;
  equipmentSnapshot: () => HarnessEquipmentSnapshot | null;
  sunSnapshot?: () => { direction: [number, number, number]; screen: [number, number] | null; facing: boolean };
  flushSave: () => Promise<void>;
  blockLogicWorker: (ms: number) => Promise<void>;
  authorityBody: (entityId: string) => {
    physicsTick: number;
    position: [number, number, number];
    velocity: [number, number, number];
    grounded: boolean;
  } | null;
  presentedEntityPosition: (entityId: string) => [number, number, number] | null;
  aimedEntityId: () => string | null;
  aimedVoxelTarget: () => {
    position: readonly [number, number, number];
    adjacent: readonly [number, number, number] | null;
  } | null;
  playerDamageFeedback: () => { pitch: number; yaw: number; roll: number; active: boolean };
};
