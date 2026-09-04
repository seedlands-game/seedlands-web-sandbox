import type { SlashCommandExecution } from '../../server/commands/slash-command-parser';
import type { QualityLevel } from '../quality-profile';

export type ShellPhase = 'boot' | 'menu' | 'loading' | 'playing' | 'error';
export type MapLayer = 'elevation' | 'biome' | 'temperature' | 'humidity' | 'hydrology';
export type FeedbackTone = 'info' | 'success' | 'error';

export type CommandEntry = {
  input: string;
  state: 'success' | 'error';
  summary: string;
};

export type ShellState = Readonly<{
  phase: ShellPhase;
  seed: string;
  quality: QualityLevel;
  enterLabel: string;
  mapOpen: boolean;
  mapLayer: MapLayer;
  mapSeed: number;
  mapCenter: readonly [number, number];
  mapRevision: number;
  commandOpen: boolean;
  commandRunning: boolean;
  commandEntries: readonly CommandEntry[];
  commandStatus: string;
  commandStatusState: 'idle' | 'running' | 'success' | 'error';
}>;

export type HudState = Readonly<{
  visible: boolean;
  worldClock: string;
  selectedMaterial: number;
  hotbar: readonly Readonly<{
    id: number;
    name: string;
    tile: readonly [number, number];
  }>[];
}>;

export type InteractionTarget = Readonly<{
  kind: 'voxel' | 'entity';
  id: string;
  label: string;
}>;

export type InteractionState = Readonly<{
  target: InteractionTarget | null;
  feedback: Readonly<{ message: string; tone: FeedbackTone }> | null;
}>;

export type DebugState = Readonly<{
  visible: boolean;
  text: string;
  fps?: number;
  position?: readonly [number, number, number];
}>;

export type UiMetrics = Readonly<{
  runtime: 'svelte5';
  shellPublishCount: number;
  hudPublishCount: number;
  interactionPublishCount: number;
  debugProjectionCount: number;
  debugPublishCount: number;
  staleUpdateCount: number;
  coalescedUpdateCount: number;
  domCommitCount: number;
  projectionDurationMs: number;
  publishDurationMs: number;
  domCommitDurationMs: number;
  debugProjectionRate: number;
  totalPublishRate: number;
}>;

export type UiActionPort = {
  startWorld: (seed: string, quality: QualityLevel) => Promise<void>;
  selectMaterial: (material: number) => void;
  toggleMap: () => void;
  closeMap: () => void;
  setMapLayer: (layer: MapLayer) => void;
  closeCommandShell: () => void;
  executeCommand: (input: string) => Promise<SlashCommandExecution>;
  releaseInput: () => void;
};

export type ReadonlyChannel<Value> = {
  get: () => Value;
  subscribe: (subscriber: (value: Value) => void) => () => void;
};
