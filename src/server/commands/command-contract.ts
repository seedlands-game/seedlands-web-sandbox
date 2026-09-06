import type { WorldCommitResult } from '../game-server';
import type { ActorArchetype } from '../gameplay/entity-store';
import type { ActorActionType } from '../simulation/action-runtime';
import type { PoiKind } from '../simulation/poi-registry';

export type CommandCategory = 'query' | 'mutation' | 'administrative';
export type CommandCapability = CommandCategory;
export type CommandSourceType = 'local-developer' | 'player' | 'agent' | 'system';

export type CommandSource = {
  actorId: string;
  sourceType: CommandSourceType;
  entityId?: string;
  capabilities: readonly CommandCapability[];
};

export type ServerCommand =
  | { type: 'set-block'; position: readonly [number, number, number]; voxel: number }
  | {
      type: 'fill';
      from: readonly [number, number, number];
      to: readonly [number, number, number];
      voxel: number;
    }
  | { type: 'teleport'; entityId?: string; position: readonly [number, number, number] }
  | { type: 'time-get' }
  | { type: 'time-set'; hours: number }
  | { type: 'seed' }
  | { type: 'save' }
  | { type: 'inspect-voxel'; position: readonly [number, number, number] }
  | { type: 'inspect-chunk'; chunk: readonly [number, number, number] }
  | { type: 'query-player-state'; entityId?: string }
  | { type: 'query-inventory'; entityId?: string }
  | { type: 'query-entity'; entityId: string }
  | { type: 'query-nearby'; radius: number }
  | { type: 'query-item-definitions' }
  | { type: 'query-voxel-definitions' }
  | { type: 'query-recipes'; craftable?: boolean }
  | { type: 'query-observation'; entityId?: string; range?: number }
  | { type: 'query-pois'; entityId?: string; radius: number; kind?: PoiKind }
  | { type: 'query-action'; entityId?: string; actionId?: string }
  | { type: 'query-path'; entityId?: string; position: readonly [number, number, number] }
  | { type: 'select-slot'; slot: number }
  | { type: 'break-voxel'; position: readonly [number, number, number] }
  | { type: 'cancel-break' }
  | { type: 'place-voxel'; position: readonly [number, number, number] }
  | { type: 'pickup-item'; entityId: string }
  | { type: 'drop-item'; slot: number; count: number }
  | { type: 'use-item' }
  | { type: 'craft-recipe'; recipeId: string }
  | { type: 'attack-entity'; entityId: string }
  | {
      type: 'start-action';
      entityId?: string;
      action: ActorActionType;
      position?: readonly [number, number, number];
      targetEntityId?: string;
      poiId?: string;
    }
  | { type: 'interrupt-action'; entityId?: string }
  | { type: 'respawn' }
  | { type: 'give-item'; entityId?: string; itemId: string; count: number }
  | { type: 'remove-item'; entityId?: string; itemId: string; count: number }
  | { type: 'spawn-world-item'; itemId: string; count: number; position: readonly [number, number, number] }
  | { type: 'spawn-creature'; position: readonly [number, number, number] }
  | { type: 'spawn-actor'; id?: string; archetype: ActorArchetype; position: readonly [number, number, number] }
  | {
      type: 'register-poi';
      id?: string;
      kind: PoiKind;
      position: readonly [number, number, number];
      label: string;
    }
  | { type: 'remove-poi'; poiId: string }
  | { type: 'despawn-entity'; entityId: string }
  | { type: 'apply-damage'; entityId?: string; amount: number }
  | { type: 'heal'; entityId?: string; amount: number }
  | { type: 'advance-gameplay'; seconds: number };

export type CommandErrorKind = 'parse' | 'validation' | 'permission' | 'execution';
export type CommandError = { kind: CommandErrorKind; code: string; message: string };

export type CommandObservation = {
  commandType: ServerCommand['type'] | 'parse';
  category: CommandCategory | 'parse';
  actorId: string;
  sourceType: CommandSourceType;
  durationMs: number;
  success: boolean;
  errorKind?: CommandErrorKind;
  affectedChunks: string[];
  worldRevision: number;
  mutationCount: number;
  structuralEventCount: 0 | 1;
};

type CommandResultBase = {
  message: string;
  affectedChunks: string[];
  worldRevision: number;
  observation: CommandObservation;
};

export type CommandSuccess = CommandResultBase & {
  success: true;
  data?: unknown;
  commit?: WorldCommitResult;
};

export type CommandFailure = CommandResultBase & {
  success: false;
  error: CommandError;
};

export type CommandResult = CommandSuccess | CommandFailure;

export type CommandParseSuccess = { success: true; command: ServerCommand };
export type CommandParseFailure = {
  success: false;
  error: { kind: 'parse'; code: 'COMMAND_PARSE_FAILED'; message: string };
};
export type CommandParseResult = CommandParseSuccess | CommandParseFailure;

export const ALL_COMMAND_CAPABILITIES: readonly CommandCapability[] = Object.freeze([
  'query',
  'mutation',
  'administrative',
]);

export function commandCategory(command: ServerCommand): CommandCategory | null {
  switch (command.type) {
    case 'seed':
    case 'inspect-voxel':
    case 'inspect-chunk':
    case 'time-get':
    case 'query-player-state':
    case 'query-inventory':
    case 'query-entity':
    case 'query-nearby':
    case 'query-item-definitions':
    case 'query-voxel-definitions':
    case 'query-recipes':
    case 'query-observation':
    case 'query-pois':
    case 'query-action':
    case 'query-path':
      return 'query';
    case 'set-block':
    case 'fill':
    case 'teleport':
    case 'time-set':
    case 'select-slot':
    case 'break-voxel':
    case 'cancel-break':
    case 'place-voxel':
    case 'pickup-item':
    case 'drop-item':
    case 'use-item':
    case 'craft-recipe':
    case 'attack-entity':
    case 'respawn':
    case 'start-action':
    case 'interrupt-action':
      return 'mutation';
    case 'save':
    case 'give-item':
    case 'remove-item':
    case 'spawn-world-item':
    case 'spawn-creature':
    case 'spawn-actor':
    case 'register-poi':
    case 'remove-poi':
    case 'despawn-entity':
    case 'apply-damage':
    case 'heal':
    case 'advance-gameplay':
      return 'administrative';
    default:
      return null;
  }
}
