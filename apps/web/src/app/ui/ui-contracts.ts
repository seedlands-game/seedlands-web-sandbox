import type { InventoryUiCommand } from './inventory-pointer-gestures';
import type { StationUiPresentation } from './station-ui-projector';
import type { CombatUiProjection } from './combat-ui-projector';
import type { SlashCommandExecution } from '@seedlands/game-core/server/commands/slash-command-parser';
import type { QualityLevel } from '../scene/quality-profile';
import type { GameplayItemPresentation } from './gameplay-ui-projector';
import type { WorldOpenMode } from '@seedlands/game-core/runtime/world-version-policy';
import type { ModeCommand } from '@seedlands/game-core/server/commands/module-command';

export type ShellPhase = 'boot' | 'menu' | 'loading' | 'playing' | 'error';
export type MapLayer = 'elevation' | 'biome' | 'temperature' | 'humidity' | 'hydrology';
export type FeedbackTone = 'info' | 'success' | 'error';
export type ActorMode = 'survival' | 'creative';
export type ModeControl = ModeCommand;
export type InventoryControl = InventoryUiCommand;

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
  initializationError: string;
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
  experience: 'melee-showcase' | null;
  gameplay: Readonly<{
    station?: StationUiPresentation | null;
    inventoryOpen: boolean;
    cursor?: GameplayItemPresentation | null;
    inventoryIdentity?: string;
    lifecycle: 'alive' | 'dead';
    mode: ActorMode;
    flightEnabled: boolean;
    inventory: readonly GameplayItemPresentation[];
    creativeCatalog: readonly GameplayItemPresentation[];
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
  combat?: CombatUiProjection;
  visible: boolean;
  worldClock: string;
  health: Readonly<{ value: number; max: number }>;
  hunger: Readonly<{ value: number; max: number }>;
  mode: ActorMode;
  flightEnabled: boolean;
  selectedHotbarSlot: number;
  hotbar: readonly GameplayItemPresentation[];
}>;

export type InteractionTarget = Readonly<{
  kind: 'voxel' | 'entity';
  id: string;
  label: string;
  voxel?: number;
}>;

export type InteractionState = Readonly<{
  gesture: Readonly<{ kind: 'attack' | 'place' | 'eat' | 'damage'; sequence: number; amount?: number }> | null;
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
  panel?: import('./debug-diagnostics').DebugPanel;
  visible: boolean;
  text: string;
  fps?: number;
  position?: readonly [number, number, number];
  collisionDebug: CollisionDebugUiState | null;
}>;

export type CollisionDebugUiState = Readonly<{
  enabled: true;
  includeContacts: boolean;
  includeSensors: boolean;
  authorityTick: number;
  predictionTick: number;
  visibleBodyCount: number;
  truncatedBodyCount: number;
  contactCount: number;
  sensorCount: number;
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
  companion?: import('../gameplay/companion/companion-session').CompanionSession;
  startWorld: (seed: string, quality: QualityLevel, openMode?: WorldOpenMode, actorMode?: ActorMode) => Promise<void>;
  startMeleeShowcase: (quality: QualityLevel) => Promise<void>;
  resetMeleeShowcase: () => Promise<void>;
  triggerMeleeShowcaseDamage: () => Promise<void>;
  selectHotbarSlot: (slot: number) => void;
  setActorMode: (mode: ActorMode) => Promise<void>;
  setFlight: (enabled: boolean) => void;
  setCreativeSlot: (slot: number, itemId: string | null) => void;
  toggleInventory: () => void;
  closeInventory: () => void;
  craftRecipe: (recipeId: string) => void;
  inventoryPointer: (command: InventoryUiCommand) => Promise<boolean>;
  useInventoryItem: (slot: number) => void;
  respawn: () => void;
  toggleMap: () => void;
  toggleCollisionDebug: () => void;
  setCollisionDebugContacts: (enabled: boolean) => void;
  setCollisionDebugSensors: (enabled: boolean) => void;
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
