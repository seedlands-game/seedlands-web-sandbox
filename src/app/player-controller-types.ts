import type * as pc from 'playcanvas';
import type { PerformanceTelemetry } from '../client/performance-telemetry';
import type { VoxelTarget } from '../client/voxel-target';
import type { WorldEnvironment } from './world-environment';
import type { World } from './world-runtime';

export type PlayerControllerOptions = {
  camera: pc.Entity;
  canvas: HTMLCanvasElement;
  telemetry: PerformanceTelemetry;
  getWorld: () => World | null;
  getEnvironment: () => WorldEnvironment | null;
  isPaused?: () => boolean;
  onToggleMap: () => void;
  onToggleDebug: () => void;
  onToggleCommandShell: () => void;
  onToggleInventory: () => void;
  onSelectHotbarSlot: (slot: number) => void;
  onAttackTarget: (
    origin: [number, number, number],
    direction: [number, number, number],
    maxDistance: number,
  ) => boolean;
  onBeginBreak: (position: [number, number, number]) => void;
  onCancelBreak: () => void;
  onPlace: (position: [number, number, number]) => void;
  isUiBlockingInput: () => boolean;
  onUseHeldItem: () => boolean;
  onCloseUi: () => void;
  onFeedback: (message: string, tone: 'info' | 'success' | 'error') => void;
  onQueueSave: () => void;
  onFlushSave: () => void;
  onAimTarget?: (target: VoxelTarget | null) => void;
};
