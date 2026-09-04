import type { SlashCommandExecution } from '../../server/commands/slash-command-parser';
import type { QualityLevel } from '../quality-profile';
import type { GameplayItemPresentation } from './gameplay-ui-projector';

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
  gameplay: Readonly<{
    inventoryOpen: boolean;
    lifecycle: 'alive' | 'dead';
    inventory: readonly GameplayItemPresentation[];
    selectedHotbarSlot: number;
    craftableRecipeIds: readonly string[];
    recipes: readonly Readonly<{
      id: string;
      name: string;
      requirements: string;
      result: string;
      craftable: boolean;
    }>[];
  }>;
}>;

export type HudState = Readonly<{
  visible: boolean;
  worldClock: string;
  health: Readonly<{ value: number; max: number }>;
  hunger: Readonly<{ value: number; max: number }>;
  selectedHotbarSlot: number;
  hotbar: readonly GameplayItemPresentation[];
}>;

export type InteractionTarget = Readonly<{
  kind: 'voxel' | 'entity';
  id: string;
  label: string;
}>;

export type InteractionState = Readonly<{
  target: InteractionTarget | null;
  feedback: Readonly<{ message: string; tone: FeedbackTone }> | null;
  breaking: Readonly<{ progress: number; label: string }> | null;
  presentedEntities: readonly Readonly<{
    id: string;
    type: 'world-item' | 'creature' | 'npc';
    label: string;
    archetype?: 'grazer' | 'night-stalker' | 'settler';
    behavior?: string;
    position: readonly [number, number, number];
  }>[];
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
  selectHotbarSlot: (slot: number) => void;
  toggleInventory: () => void;
  closeInventory: () => void;
  craftRecipe: (recipeId: string) => void;
  respawn: () => void;
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
