import type { WorldCommitResult } from '../game-server';

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
  | { type: 'inspect-chunk'; chunk: readonly [number, number, number] };

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
      return 'query';
    case 'set-block':
    case 'fill':
    case 'teleport':
    case 'time-set':
      return 'mutation';
    case 'save':
      return 'administrative';
    default:
      return null;
  }
}
