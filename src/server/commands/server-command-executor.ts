import { chunkKey } from '../../world/voxel';
import type { GameServer, WorldCommitResult } from '../game-server';
import { WorldMutationBuffer, assertMutationCoordinate, assertVoxelValue } from '../world-mutation';
import { resolveFillCommand } from './fill-command';
import {
  executeGameplayCommand,
  GameplayCommandPermissionError,
  type GameplayCommand,
} from './gameplay-command-handler';
import {
  commandCategory,
  type CommandCategory,
  type CommandError,
  type CommandFailure,
  type CommandObservation,
  type CommandResult,
  type CommandSource,
  type CommandSuccess,
  type ServerCommand,
} from './command-contract';

export * from './command-contract';

type ExecutorOptions = {
  authorize?: (source: CommandSource, command: ServerCommand, category: CommandCategory) => boolean;
  observe?: (observation: CommandObservation) => void;
  now?: () => number;
  save?: () => Promise<{ savedChunks: string[]; gameplaySaved: boolean; commitSequence: number }>;
};

type PreparedCommand = {
  command: ServerCommand;
  mutationBuffer?: WorldMutationBuffer;
  entityId?: string;
};

type ExecutionPayload = {
  message: string;
  data?: unknown;
  affectedChunks?: string[];
  commit?: WorldCommitResult;
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function assertFinitePosition(position: readonly [number, number, number]): void {
  if (position.some((value) => !Number.isFinite(value))) throw new TypeError('Position values must be finite numbers.');
}

function assertIntegerPosition(position: readonly [number, number, number]): void {
  position.forEach(assertMutationCoordinate);
}

export class ServerCommandExecutor {
  private readonly now: () => number;

  constructor(
    private readonly server: GameServer,
    private readonly options: ExecutorOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
  }

  async execute(source: CommandSource, command: ServerCommand): Promise<CommandResult> {
    const startedAt = this.now();
    const category = commandCategory(command);
    if (!category)
      return this.failure(source, command.type, 'mutation', startedAt, {
        kind: 'validation',
        code: 'COMMAND_VALIDATION_FAILED',
        message: `Unsupported command type: ${String(command.type)}`,
      });
    let permitted = source.capabilities.includes(category);
    try {
      if (permitted && this.options.authorize) permitted = this.options.authorize(source, command, category);
    } catch (error) {
      return this.failure(source, command.type, category, startedAt, {
        kind: 'permission',
        code: 'COMMAND_PERMISSION_CHECK_FAILED',
        message: errorMessage(error),
      });
    }
    if (!permitted)
      return this.failure(source, command.type, category, startedAt, {
        kind: 'permission',
        code: 'COMMAND_PERMISSION_DENIED',
        message: `Source ${source.actorId || '<unknown>'} does not have ${category} capability.`,
      });

    let prepared: PreparedCommand;
    try {
      prepared = this.prepare(source, command);
    } catch (error) {
      return this.failure(source, command.type, category, startedAt, {
        kind: 'validation',
        code: 'COMMAND_VALIDATION_FAILED',
        message: errorMessage(error),
      });
    }

    try {
      const payload = await this.run(source, prepared);
      return this.success(source, command, category, startedAt, payload);
    } catch (error) {
      if (error instanceof GameplayCommandPermissionError)
        return this.failure(source, command.type, category, startedAt, {
          kind: 'permission',
          code: 'COMMAND_PERMISSION_DENIED',
          message: error.message,
        });
      return this.failure(source, command.type, category, startedAt, {
        kind: 'execution',
        code: 'COMMAND_EXECUTION_FAILED',
        message: errorMessage(error),
      });
    }
  }

  private prepare(source: CommandSource, command: ServerCommand): PreparedCommand {
    if (!source.actorId.trim()) throw new TypeError('Command source actorId must not be empty.');
    switch (command.type) {
      case 'set-block': {
        assertIntegerPosition(command.position);
        assertVoxelValue(command.voxel);
        const mutationBuffer = WorldMutationBuffer.forUniqueCoordinates({
          sourceId: `command:set-block:${source.actorId}`,
          priority: 0,
          initialCapacity: 1,
        });
        mutationBuffer.write(...command.position, command.voxel);
        return { command, mutationBuffer };
      }
      case 'fill':
        return { command, mutationBuffer: resolveFillCommand(command) };
      case 'teleport': {
        assertFinitePosition(command.position);
        const entityId = command.entityId ?? source.entityId;
        if (!entityId) throw new TypeError('Teleport requires an explicit entityId or CommandSource.entityId.');
        if (!this.server.getEntity(entityId)) throw new RangeError(`Unknown entity: ${entityId}`);
        return { command, entityId };
      }
      case 'time-set':
        if (!Number.isFinite(command.hours)) throw new TypeError('World time must be a finite number.');
        return { command };
      case 'inspect-voxel':
      case 'inspect-chunk':
        assertIntegerPosition(command.type === 'inspect-voxel' ? command.position : command.chunk);
        return { command };
      case 'time-get':
      case 'seed':
      case 'save':
        return { command };
      default:
        return { command };
    }
  }

  private async run(source: CommandSource, prepared: PreparedCommand): Promise<ExecutionPayload> {
    const { command } = prepared;
    switch (command.type) {
      case 'set-block':
      case 'fill':
        return this.mutationPayload(
          this.server.editBatch({ actorId: source.actorId, buffers: [prepared.mutationBuffer!] }),
        );
      case 'teleport': {
        const entity = this.server.updateEntity(prepared.entityId!, {
          position: [...command.position] as [number, number, number],
        });
        return { message: `Teleported ${entity.id} to ${entity.position.join(' ')}.`, data: { entity } };
      }
      case 'time-get':
        return { message: `World time is ${this.server.worldTime}.`, data: { worldTime: this.server.worldTime } };
      case 'time-set': {
        const worldTime = this.server.setWorldTime(command.hours);
        return { message: `World time set to ${worldTime}.`, data: { worldTime } };
      }
      case 'seed':
        return {
          message: `Seed ${this.server.options.seedText}; generator v${this.server.generatorVersion}.`,
          data: {
            seedText: this.server.options.seedText,
            seed: this.server.seed,
            generatorVersion: this.server.generatorVersion,
          },
        };
      case 'save': {
        const { savedChunks, gameplaySaved, commitSequence } = await (this.options.save?.() ?? this.server.save());
        return {
          message: `Saved ${savedChunks.length} dirty Chunk(s).`,
          data: { savedChunks, gameplaySaved, commitSequence },
          affectedChunks: savedChunks,
        };
      }
      case 'inspect-voxel': {
        const voxel = this.server.getVoxel(...command.position);
        const name = Object.entries(VOXEL_NAMES).find(([, value]) => value === voxel)?.[0] ?? 'Unknown';
        return {
          message: `${name} (${voxel}) at ${command.position.join(' ')}.`,
          data: { position: [...command.position], voxel },
        };
      }
      case 'inspect-chunk': {
        const chunk = this.server.getChunk(...command.chunk);
        return {
          message: `Chunk ${chunk.key}; revision ${chunk.revision}; ${chunk.dirty ? 'dirty' : 'clean'}.`,
          data: {
            chunk: {
              key: chunk.key,
              cx: chunk.cx,
              cy: chunk.cy,
              cz: chunk.cz,
              revision: chunk.revision,
              persistedRevision: chunk.persistedRevision,
              dirty: chunk.dirty,
              materialized: chunk.materialized,
            },
          },
          affectedChunks: [chunkKey(...command.chunk)],
        };
      }
      default:
        return executeGameplayCommand(this.server, source, command as GameplayCommand);
    }
  }

  private mutationPayload(commit: WorldCommitResult): ExecutionPayload {
    const mutationCount = commit.structuralChange?.mutationCount ?? 0;
    return {
      message: commit.committed ? `Committed ${mutationCount} voxel mutation(s).` : 'Command produced no state change.',
      data: { committed: commit.committed, mutationCount, metrics: commit.metrics },
      affectedChunks: commit.structuralChange?.chunks ?? [],
      commit,
    };
  }

  private success(
    source: CommandSource,
    command: ServerCommand,
    category: CommandCategory,
    startedAt: number,
    payload: ExecutionPayload,
  ): CommandSuccess {
    const affectedChunks = payload.affectedChunks ? [...payload.affectedChunks] : [];
    const observation = this.observation(
      source,
      command.type,
      category,
      startedAt,
      true,
      affectedChunks,
      payload.commit,
    );
    const result: CommandSuccess = {
      success: true,
      message: payload.message,
      affectedChunks,
      worldRevision: this.server.worldRevision,
      observation,
      ...(payload.data === undefined ? {} : { data: payload.data }),
      ...(payload.commit ? { commit: payload.commit } : {}),
    };
    this.observe(observation);
    return result;
  }

  private failure(
    source: CommandSource,
    commandType: ServerCommand['type'],
    category: CommandCategory,
    startedAt: number,
    error: CommandError,
  ): CommandFailure {
    const observation = this.observation(source, commandType, category, startedAt, false, [], undefined, error.kind);
    const result: CommandFailure = {
      success: false,
      message: error.message,
      error,
      affectedChunks: [],
      worldRevision: this.server.worldRevision,
      observation,
    };
    this.observe(observation);
    return result;
  }

  private observation(
    source: CommandSource,
    commandType: ServerCommand['type'],
    category: CommandCategory,
    startedAt: number,
    success: boolean,
    affectedChunks: string[],
    commit?: WorldCommitResult,
    errorKind?: CommandError['kind'],
  ): CommandObservation {
    return {
      commandType,
      category,
      actorId: source.actorId,
      sourceType: source.sourceType,
      durationMs: Math.max(0, this.now() - startedAt),
      success,
      ...(errorKind ? { errorKind } : {}),
      affectedChunks,
      worldRevision: this.server.worldRevision,
      mutationCount: commit?.structuralChange?.mutationCount ?? 0,
      structuralEventCount: commit?.structuralChange ? 1 : 0,
    };
  }

  private observe(observation: CommandObservation): void {
    try {
      this.options.observe?.(observation);
    } catch {
      // Observability must not change or retry an already completed command.
    }
  }
}

const VOXEL_NAMES = {
  Air: 0,
  Grass: 1,
  Dirt: 2,
  Stone: 3,
  Wood: 4,
  Leaves: 5,
  Sand: 6,
  Snow: 7,
  Water: 8,
} as const;
