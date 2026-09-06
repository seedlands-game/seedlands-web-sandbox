import { randomUUID } from 'node:crypto';
import { GENERATOR_VERSION } from '../../world/voxel';
import { createNodePersistenceLane } from '../persistence/node-persistence-lane';
import { createNodeAuthorityLane } from '../runtime/node-authority-lane';
import {
  NodeDedicatedStopTimeoutError,
  type NodeDedicatedRuntimeOptions,
  type NodeDedicatedRuntimeState,
  type NodeDedicatedStopResult,
} from '../runtime/node-dedicated-runtime-types';

type PersistenceLane = Awaited<ReturnType<typeof createNodePersistenceLane>>;
type AuthorityLane = Awaited<ReturnType<typeof createNodeAuthorityLane>>;
export type NodeServerRuntimeOptions = Omit<NodeDedicatedRuntimeOptions, 'now' | 'computeEntries'> &
  Readonly<{
    entries: Readonly<{ authority: URL; persistence: URL; worker: URL; child: URL }>;
  }>;

/** 主上下文只管理资源所有权；权威世界与文件存储分别留在独立 Worker。 */
export class NodeServerRuntime {
  private currentState: NodeDedicatedRuntimeState = 'running';
  private shutdown: Promise<NodeDedicatedStopResult> | null = null;
  private stopRequest: Promise<NodeDedicatedStopResult> | null = null;
  private readonly terminal: Promise<NodeDedicatedStopResult>;
  private resolveTerminal!: (result: NodeDedicatedStopResult) => void;
  private rejectTerminal!: (error: unknown) => void;
  private readonly failureEvent: Promise<Error>;
  private resolveFailure!: (error: Error) => void;
  private firstFailure: Error | undefined;

  private constructor(
    readonly epoch: string,
    readonly authority: AuthorityLane,
    private readonly persistence: PersistenceLane,
    private readonly deadlineMs: number,
  ) {
    this.terminal = new Promise((resolve, reject) => {
      this.resolveTerminal = resolve;
      this.rejectTerminal = reject;
    });
    void this.terminal.catch(() => {});
    this.failureEvent = new Promise((resolve) => {
      this.resolveFailure = resolve;
    });
    void authority.whenFailed().then((error) => this.beginShutdown(error));
    this.watchLane('Authority', authority.whenExited());
    this.watchLane('Persistence', persistence.whenExited());
  }

  static async create(options: NodeServerRuntimeOptions): Promise<NodeServerRuntime> {
    const deadlineMs = options.stopDeadlineMs ?? 30_000;
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0)
      throw new RangeError('Node server stop deadline must be a positive safe integer.');
    const epoch = `node-${randomUUID()}`;
    const persistence = await createNodePersistenceLane({
      entry: options.entries.persistence,
      epoch,
      store: {
        directory: options.dataDirectory,
        seedText: options.seedText,
        generatorVersion: options.generatorVersion ?? GENERATOR_VERSION,
        ...(options.worldId ? { worldId: options.worldId } : {}),
        ...(options.persistenceLimits ? { limits: options.persistenceLimits } : {}),
      },
    });
    try {
      const authority = await createNodeAuthorityLane({
        entry: options.entries.authority,
        epoch,
        seedText: options.seedText,
        generatorVersion: options.generatorVersion ?? GENERATOR_VERSION,
        persistencePort: persistence.authorityPort,
        persistenceProxy: persistence.proxy,
        computeMode: options.computeMode ?? 'worker-thread',
        computeEntries: { worker: options.entries.worker, child: options.entries.child },
        ...(options.computeLimits ? { computeLimits: options.computeLimits } : {}),
        ...(options.hostLimits ? { hostLimits: options.hostLimits } : {}),
        ...(options.wakeIntervalMs ? { wakeIntervalMs: options.wakeIntervalMs } : {}),
        ...(options.worldId ? { worldId: options.worldId } : {}),
      });
      return new NodeServerRuntime(epoch, authority, persistence, deadlineMs);
    } catch (error) {
      try {
        await persistence.close();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Node server startup and persistence cleanup failed.', {
          cause: cleanupError,
        });
      }
      throw error;
    }
  }

  get state(): NodeDedicatedRuntimeState {
    return this.currentState;
  }
  get authorityThreadId(): number {
    return this.authority.threadId;
  }
  get persistenceThreadId(): number {
    return this.persistence.threadId;
  }

  stop(): Promise<NodeDedicatedStopResult> {
    this.beginShutdown();
    if (!this.stopRequest) this.stopRequest = this.withDeadline(this.shutdown!);
    return this.stopRequest;
  }

  whenStopped(): Promise<NodeDedicatedStopResult> {
    return this.terminal;
  }

  whenFailed(): Promise<Error> {
    return this.failureEvent;
  }

  private watchLane(name: string, exited: Promise<unknown>): void {
    void exited.then(
      () => {
        if (this.currentState === 'running') this.beginShutdown(new Error(`${name} lane exited unexpectedly.`));
      },
      (error: unknown) => {
        if (this.currentState === 'running') this.beginShutdown(error);
      },
    );
  }

  private beginShutdown(trigger?: unknown): void {
    if (trigger !== undefined) this.recordFailure(trigger);
    if (this.shutdown) return;
    this.currentState = trigger === undefined ? 'stopping' : 'failed';
    this.shutdown = this.finishShutdown(trigger);
    void this.shutdown.then(this.resolveTerminal, this.rejectTerminal);
  }

  private async finishShutdown(trigger?: unknown): Promise<NodeDedicatedStopResult> {
    const failures: unknown[] = trigger === undefined ? [] : [trigger];
    let stopped: NodeDedicatedStopResult | undefined;
    try {
      stopped = await this.authority.stop();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.persistence.close();
    } catch (error) {
      failures.push(error);
    }
    try {
      await this.authority.close();
    } catch (error) {
      failures.push(error);
    }
    if (this.firstFailure) failures.push(this.firstFailure);
    if (failures.length) {
      const distinct = [...new Set(failures)];
      const error = distinct.length === 1 ? distinct[0] : new AggregateError(distinct, 'Node server shutdown failed.');
      this.recordFailure(error);
      throw error;
    }
    this.currentState = 'stopped';
    return stopped!;
  }

  private recordFailure(error: unknown): void {
    this.currentState = 'failed';
    if (this.firstFailure) return;
    this.firstFailure = error instanceof Error ? error : new Error(String(error));
    this.resolveFailure(this.firstFailure);
  }

  private withDeadline(completion: Promise<NodeDedicatedStopResult>): Promise<NodeDedicatedStopResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new NodeDedicatedStopTimeoutError(this.deadlineMs)), this.deadlineMs);
    });
    return Promise.race([completion, deadline]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }
}

export const createNodeServerRuntime = (options: NodeServerRuntimeOptions): Promise<NodeServerRuntime> =>
  NodeServerRuntime.create(options);
