import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { DedicatedComputeExecutor } from '@seedlands/game-core/server/compute/dedicated-compute-contract';
import { DedicatedServerHost } from '@seedlands/game-core/server/dedicated/dedicated-server-host';
import { GENERATOR_VERSION } from '@seedlands/game-core/world/voxel';
import { createNodeComputeExecutor } from '../compute/node-compute-executor';
import { FileGamePersistence } from '../persistence/file-game-persistence';
import { nodeCorePlatform } from './node-core-platform';
import {
  NodeDedicatedStopTimeoutError,
  type NodeDedicatedComputeLimits,
  type NodeDedicatedRuntimeDiagnostics,
  type NodeDedicatedRuntimeOptions,
  type NodeDedicatedRuntimeState,
  type NodeDedicatedStopResult,
} from './node-dedicated-runtime-types';

export type * from './node-dedicated-runtime-types';

const DEFAULT_COMPUTE_LIMITS: NodeDedicatedComputeLimits = Object.freeze({
  maxTasks: 256,
  maxBytes: 16 * 1024 * 1024,
  maxResultBytes: 16 * 1024 * 1024,
  poolSize: 1,
});

type Executors = Readonly<{
  general: DedicatedComputeExecutor;
  fluid: DedicatedComputeExecutor;
  logic: DedicatedComputeExecutor;
}>;

function validateOptions(options: NodeDedicatedRuntimeOptions) {
  if (!options.seedText) throw new TypeError('Node dedicated seedText must not be empty.');
  if (!options.dataDirectory) throw new TypeError('Node dedicated dataDirectory must not be empty.');
  const wakeIntervalMs = options.wakeIntervalMs ?? 8;
  const stopDeadlineMs = options.stopDeadlineMs ?? 30_000;
  if (!Number.isSafeInteger(wakeIntervalMs) || wakeIntervalMs < 1 || wakeIntervalMs > 1_000)
    throw new RangeError('Node dedicated wakeIntervalMs must be an integer from 1 to 1000.');
  if (!Number.isSafeInteger(stopDeadlineMs) || stopDeadlineMs < 1)
    throw new RangeError('Node dedicated stopDeadlineMs must be a positive safe integer.');
  const computeLimits = { ...DEFAULT_COMPUTE_LIMITS, ...options.computeLimits };
  for (const [name, value] of Object.entries(computeLimits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError(`Node dedicated compute limit ${name} must be a positive safe integer.`);
  const initialNow = (options.now ?? (() => performance.now()))();
  if (!Number.isFinite(initialNow)) throw new TypeError('Node dedicated monotonic clock returned an invalid value.');
  return { wakeIntervalMs, stopDeadlineMs, computeLimits };
}

async function cleanupAfterStartupFailure(
  error: unknown,
  executors: readonly DedicatedComputeExecutor[],
  persistence: FileGamePersistence | null,
): Promise<never> {
  const failures: unknown[] = [error];
  const uniqueExecutors = [...new Set(executors)];
  const executorResults = await Promise.allSettled(uniqueExecutors.map((executor) => executor.close()));
  executorResults.forEach((result) => {
    if (result.status === 'rejected') failures.push(result.reason);
  });
  if (persistence) {
    try {
      await persistence.close();
    } catch (closeError) {
      failures.push(closeError);
    }
  }
  if (failures.length === 1) throw error;
  throw new AggregateError(failures, 'Node dedicated runtime startup and cleanup both failed.');
}

export class NodeDedicatedRuntime {
  private runtimeState: NodeDedicatedRuntimeState = 'running';
  private timer: ReturnType<typeof setInterval> | null = null;
  private shutdown: Promise<NodeDedicatedStopResult> | null = null;
  private stopRequest: Promise<NodeDedicatedStopResult> | null = null;
  private wakeCount = 0;
  private deadlineExceeded = false;
  private failure: Error | null = null;
  private readonly terminal: Promise<NodeDedicatedStopResult>;
  private resolveTerminal!: (result: NodeDedicatedStopResult) => void;
  private rejectTerminal!: (error: unknown) => void;

  private constructor(
    readonly epoch: string,
    readonly host: DedicatedServerHost,
    private readonly persistence: FileGamePersistence,
    private readonly executors: Executors,
    private readonly now: () => number,
    private readonly wakeIntervalMs: number,
    private readonly stopDeadlineMs: number,
  ) {
    this.terminal = new Promise<NodeDedicatedStopResult>((resolve, reject) => {
      this.resolveTerminal = resolve;
      this.rejectTerminal = reject;
    });
    void this.terminal.catch(() => undefined);
  }

  static async create(options: NodeDedicatedRuntimeOptions): Promise<NodeDedicatedRuntime> {
    const validated = validateOptions(options);
    const epoch = `node-${randomUUID()}`;
    let persistence: FileGamePersistence | null = null;
    const createdExecutors: DedicatedComputeExecutor[] = [];
    try {
      persistence = await FileGamePersistence.open({
        directory: options.dataDirectory,
        seedText: options.seedText,
        generatorVersion: options.generatorVersion ?? GENERATOR_VERSION,
        ...(options.worldId ? { worldId: options.worldId } : {}),
        ...(options.persistenceLimits ? { limits: options.persistenceLimits } : {}),
      });
      const createExecutor = () => {
        const executor = createNodeComputeExecutor({
          mode: options.computeMode ?? 'inline',
          maxTasks: validated.computeLimits.maxTasks,
          maxBytes: validated.computeLimits.maxBytes,
          maxResultBytes: validated.computeLimits.maxResultBytes,
          poolSize: validated.computeLimits.poolSize,
          expectedEpoch: epoch,
          ...(options.computeEntries ? { entries: options.computeEntries } : {}),
        });
        createdExecutors.push(executor);
        return executor;
      };
      const executors: Executors = {
        general: createExecutor(),
        fluid: createExecutor(),
        logic: createExecutor(),
      };
      const host = await DedicatedServerHost.create({
        epoch,
        seedText: options.seedText,
        persistence,
        executors,
        now: options.now ?? (() => performance.now()),
        platform: nodeCorePlatform,
        ...(options.generatorVersion === undefined ? {} : { generatorVersion: options.generatorVersion }),
        ...(options.hostLimits ? { limits: options.hostLimits } : {}),
      });
      const runtime = new NodeDedicatedRuntime(
        epoch,
        host,
        persistence,
        executors,
        options.now ?? (() => performance.now()),
        validated.wakeIntervalMs,
        validated.stopDeadlineMs,
      );
      runtime.startTimer();
      return runtime;
    } catch (error) {
      return cleanupAfterStartupFailure(error, createdExecutors, persistence);
    }
  }

  get state(): NodeDedicatedRuntimeState {
    return this.runtimeState;
  }

  diagnostics(): NodeDedicatedRuntimeDiagnostics {
    return {
      state: this.runtimeState,
      epoch: this.epoch,
      wakeCount: this.wakeCount,
      stopDeadlineExceeded: this.deadlineExceeded,
      failure: this.failure?.message ?? null,
      host: this.host.diagnostics(),
      compute: {
        general: this.executors.general.diagnostics(),
        fluid: this.executors.fluid.diagnostics(),
        logic: this.executors.logic.diagnostics(),
      },
    };
  }

  stop(): Promise<NodeDedicatedStopResult> {
    this.beginShutdown();
    if (!this.stopRequest) this.stopRequest = this.withDeadline(this.shutdown!);
    return this.stopRequest;
  }

  whenStopped(): Promise<NodeDedicatedStopResult> {
    return this.terminal;
  }

  private startTimer(): void {
    this.timer = setInterval(() => {
      if (this.runtimeState !== 'running') return;
      try {
        this.host.wake(this.now());
        this.wakeCount += 1;
        if (this.host.state === 'failed') {
          const failure = this.host.diagnostics().failure ?? 'unknown host failure';
          throw new Error(`Node dedicated host failed: ${failure}`);
        }
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error));
        this.beginShutdown(this.failure);
      }
    }, this.wakeIntervalMs);
  }

  private beginShutdown(trigger?: Error): void {
    if (this.shutdown) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.runtimeState = trigger ? 'failed' : 'stopping';
    this.shutdown = this.finishShutdown(trigger);
    void this.shutdown.then(this.resolveTerminal, this.rejectTerminal);
  }

  private async finishShutdown(trigger?: Error): Promise<NodeDedicatedStopResult> {
    const failures: unknown[] = trigger ? [trigger] : [];
    try {
      await this.host.stop();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.persistence.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length) {
      this.runtimeState = 'failed';
      const error =
        failures.length === 1 && failures[0] instanceof Error
          ? failures[0]
          : new AggregateError(failures, 'Node dedicated runtime shutdown failed.');
      this.failure = error;
      throw error;
    }
    this.runtimeState = 'stopped';
    return {
      status: 'stopped',
      durableCommitSequence: this.host.diagnostics().durableCommitSequence,
    };
  }

  private withDeadline(completion: Promise<NodeDedicatedStopResult>): Promise<NodeDedicatedStopResult> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        this.deadlineExceeded = true;
        reject(new NodeDedicatedStopTimeoutError(this.stopDeadlineMs));
      }, this.stopDeadlineMs);
    });
    return Promise.race([completion, deadline]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
  }
}

export const createNodeDedicatedRuntime = (options: NodeDedicatedRuntimeOptions): Promise<NodeDedicatedRuntime> =>
  NodeDedicatedRuntime.create(options);
