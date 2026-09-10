import type * as pc from 'playcanvas';
import type { PerformanceTelemetry } from '../../client/presentation/performance-telemetry';
import type { VoxelTarget } from '../../client/presentation/voxel-target';
import type { WorldEnvironment } from '../scene/world-environment';
import type { World } from '../world/world-runtime';
import type { AuthoritySnapshot } from '@seedlands/game-core/server/authority/authority-session';
import type { InputCommand, SessionEpoch } from '@seedlands/game-core/runtime/session-protocol';

export type PlayerControllerOptions = {
  camera: pc.Entity;
  canvas: HTMLCanvasElement;
  telemetry: PerformanceTelemetry;
  getWorld: () => World | null;
  getEnvironment: () => WorldEnvironment | null;
  isPaused?: () => boolean;
  onToggleMap: () => void;
  onToggleDebug: () => void;
  onToggleCollisionDebug: () => void;
  onSetWorldClockPaused: (paused: boolean) => void;
  onSetWorldClockSpeed: (speed: number) => void;
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
  onUseTarget: (position: [number, number, number]) => boolean;
  isUiBlockingInput: () => boolean;
  onUseHeldItem: () => boolean;
  onCloseUi: () => void;
  onFeedback: (message: string, tone: 'info' | 'success' | 'error') => void;
  onQueueSave: () => void;
  onFlushSave: () => void;
  onAimTarget?: (target: VoxelTarget | null) => void;
  authority: {
    epoch: SessionEpoch;
    snapshot: () => AuthoritySnapshot | null;
    sendInput: (command: InputCommand) => void;
    setPlayerPosition: (position: [number, number, number]) => Promise<unknown>;
  };
  physicsHz: 30 | 60 | 120;
  estimatedInputTransitMs?: number;
};
