import { dedicatedActiveWindow, DedicatedActiveWindowController } from './dedicated-active-window';
import type { InputCommand, SequenceDecision } from '../../runtime/session-protocol';
import { BoundedCostSamples } from '../../runtime/bounded-cost-samples';
import type { AuthorityAction } from '../../compute/authority-worker-protocol';
import { AuthorityRuntime } from '../authority/authority-runtime';
import type {
  AuthorityBaselineCaptureCancellation,
  AuthorityBaselineCaptureRequest,
  AuthorityBaselineCaptureResult,
} from '../authority/authority-baseline-capture-types';
import type { AuthoritySnapshot } from '../authority/authority-session';
import type {
  DedicatedComputeExecutor,
  DedicatedComputeResult,
  DedicatedComputeTask,
} from '../compute/dedicated-compute-contract';
import type { FluidAuthoritySnapshot } from '../fluid/fluid-transaction';
import type { LogicObservation } from '../logic/logic-protocol';
import { DedicatedComputeScheduler, type DedicatedComputeWork } from '../compute/dedicated-compute-scheduler';
import { dedicatedComputePolicy } from './dedicated-compute-policy';
import {
  createDedicatedBaselineCaptureCoordinator,
  DedicatedBaselineCaptureCoordinator,
} from './dedicated-baseline-capture';
import { acceptDedicatedCanonicalResult, DedicatedChunkRequestCoordinator } from './dedicated-chunk-requests';
import {
  dedicatedLimits,
  estimateComputeBytes,
  type DedicatedHostOptions,
  type DedicatedHostState,
  type DedicatedPublication,
} from './dedicated-host-types';
import type { CoreAbortSignal } from '../../runtime/platform-ports';

type SaveResult = Awaited<ReturnType<AuthorityRuntime['save']>>;
type Mail = { apply: () => void; bytes: number };

/** 平台时钟只调用 wake；所有候选由本宿主的 mailbox 收回同一权威。 */
export class DedicatedServerHost {
  readonly runtime: AuthorityRuntime;
  private currentState: DedicatedHostState = 'running';
  private currentSnapshot: AuthoritySnapshot;
  private readonly limits;
  private readonly mailbox: Mail[] = [];
  private mailboxBytes = 0;
  private readonly work = new Set<Promise<void>>();
  private readonly progressWaiters = new Set<() => void>();
  private readonly chunkRequests: DedicatedChunkRequestCoordinator;
  private readonly baselineCaptures: DedicatedBaselineCaptureCoordinator;
  private readonly listeners = new Set<(publication: DedicatedPublication) => void>();
  private readonly tickCosts = new BoundedCostSamples();
  private readonly candidateCosts = new BoundedCostSamples();
  private readonly scheduler: DedicatedComputeScheduler;
  private lifecycleGeneration = 0;
  private lastWakeMs: number;
  private lastInputMs = -Infinity;
  private inputExpired = true;
  private lastSaveMs: number;
  private lastPublishMs: number;
  private lastGameplayMs: number;
  private saving: Promise<SaveResult> | null = null;
  private nextSave: Promise<SaveResult> | null = null;
  private stopping: Promise<void> | null = null;
  private actionTail: Promise<unknown> = Promise.resolve();
  private pendingActions = 0;
  private storageHealthy = true;
  private durableSequence = -1;
  private failedJobs = 0;
  private acceptedJobs = 0;
  private failureMessage: string | null = null;
  private readonly activity: DedicatedActiveWindowController;

  private constructor(
    runtime: AuthorityRuntime,
    private readonly options: DedicatedHostOptions,
  ) {
    this.runtime = runtime;
    this.limits = dedicatedLimits(options.limits);
    this.chunkRequests = new DedicatedChunkRequestCoordinator({
      server: runtime.server,
      state: () => this.currentState,
      pendingLimit: this.limits.pendingChunks,
      generate: (request, finish) => this.generateCanonical(request, finish),
      onPreparationFailure: (error) => this.recordJobFailure(error),
      notifyProgress: () => this.notifyProgress(),
    });
    this.baselineCaptures = createDedicatedBaselineCaptureCoordinator({
      runtime,
      isRunning: () => this.currentState === 'running',
      reserve: (keys) => this.chunkRequests.reserve(keys),
      requestChunk: (key, lease) => this.chunkRequests.requestReserved(key, false, lease),
    });
    this.activity = new DedicatedActiveWindowController(
      {
        isRunning: () => this.currentState === 'running',
        isAvailable: (key) => runtime.server.hasLoadedCanonicalChunk(key),
        requestChunk: (key) => this.requestChunk(key),
        setFluidActiveChunks: (keys) => runtime.setFluidActiveChunks(keys),
      },
      options.activeRadius ?? 2,
    );
    this.scheduler = new DedicatedComputeScheduler({
      epoch: options.epoch,
      executors: options.executors,
      maxTasks: this.limits.mailboxCount,
      maxBytes: this.limits.mailboxBytes,
      maxResultBytes: this.limits.computeResultBytes,
      createAbortController: options.platform.createAbortController,
      utf8: options.platform.utf8,
    });
    this.currentSnapshot = runtime.commitHostActivation();
    this.lastWakeMs = this.lastSaveMs = this.lastPublishMs = this.lastGameplayMs = options.now();
    this.durableSequence = runtime.server.restoredCommitSequence;
  }

  static async create(options: DedicatedHostOptions): Promise<DedicatedServerHost> {
    dedicatedLimits(options.limits);
    dedicatedActiveWindow({ x: 0, z: 0 }, options.activeRadius ?? 2);
    if (!options.epoch.trim() || !Number.isFinite(options.now()))
      throw new TypeError('Invalid dedicated identity or clock.');
    const holder: { host?: DedicatedServerHost } = {};
    const pendingKeys = new Set<string>();
    const runtime = await AuthorityRuntime.create({
      ...options,
      initialWorldTime: options.initialWorldTime ?? 9,
      startTimeMs: options.now(),
      findInitialWorldBootstrap: async (seed, generatorVersion) => {
        const task: DedicatedComputeTask = {
          kind: 'find-safe-spawn',
          taskId: 0,
          epoch: options.epoch,
          generation: options.executors.general.diagnostics().generation,
          estimatedBytes: 256,
          seed,
          generatorVersion,
        };
        const result = await options.executors.general.execute({
          ...task,
          estimatedBytes: estimateComputeBytes(task, options.platform.utf8),
        });
        if (result.kind !== 'safe-spawn-result') throw new Error('Invalid dedicated bootstrap result.');
        return {
          playerBodyPosition: result.playerBodyPosition,
          starterChunks: result.starterChunks.map((chunk) => ({
            ...chunk,
            canonical: new Uint16Array(chunk.canonical),
          })),
        };
      },
      onUnknownChunk: (key) => {
        if (holder.host) void holder.host.requestChunk(key, true);
        else if (pendingKeys.size < 2048) pendingKeys.add(key);
      },
      onFluidWork: (snapshot) => holder.host?.requestFluid(snapshot),
      onLogicObservation: (observation) => holder.host?.requestLogic(observation),
    });
    const host = new DedicatedServerHost(runtime, options);
    holder.host = host;
    for (const key of pendingKeys) void host.requestChunk(key);
    runtime.requestLogicObservation();
    return host;
  }

  get state(): DedicatedHostState {
    return this.currentState;
  }
  get snapshot(): AuthoritySnapshot {
    return this.currentSnapshot;
  }

  subscribe(listener: (publication: DedicatedPublication) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  wake(nowMs = this.options.now()): AuthoritySnapshot {
    if (!Number.isFinite(nowMs) || nowMs < this.lastWakeMs) throw new RangeError('Dedicated clock must be monotonic.');
    if (this.currentState === 'stopped' || this.currentState === 'failed') return this.currentSnapshot;
    const residencyFailure = this.runtime.residencyDiagnostics.lastSaveError;
    const degradedCompute = Object.values(this.options.executors).some(
      (executor) => executor.diagnostics().health === 'degraded',
    );
    if (residencyFailure || degradedCompute) {
      this.storageHealthy = !residencyFailure;
      this.failureMessage = residencyFailure ?? 'Dedicated compute executor is degraded.';
      this.currentState = 'failed';
      this.clearInput();
      return this.currentSnapshot;
    }
    const startedAt = this.options.now();
    this.flushMailbox();
    if (this.currentState === 'running') this.activity.update(this.currentSnapshot.player.body.position);
    if (!this.inputExpired && nowMs - this.lastInputMs >= this.limits.inputLeaseMs) this.clearInput();
    this.currentSnapshot = this.runtime.wake(nowMs);
    this.lastWakeMs = nowMs;
    if (nowMs - this.lastPublishMs >= 1000 / 60) {
      const gameplay = nowMs - this.lastGameplayMs >= 50 ? this.runtime.view() : undefined;
      if (gameplay) this.lastGameplayMs = nowMs;
      const publication = {
        snapshot: this.currentSnapshot,
        ...(gameplay ? { gameplay } : {}),
        commits: this.runtime.takeCommits(),
      };
      this.lastPublishMs = nowMs;
      for (const listener of this.listeners) listener(publication);
    }
    if (this.currentState === 'running' && nowMs - this.lastSaveMs >= this.limits.saveIntervalMs) {
      this.lastSaveMs = nowMs;
      void this.save().catch(() => {});
    }
    this.tickCosts.record(Math.max(0, this.options.now() - startedAt));
    return this.currentSnapshot;
  }

  receiveInput(input: InputCommand): SequenceDecision {
    if (this.currentState !== 'running' || !this.storageHealthy) return 'capacity';
    const decision = this.runtime.receiveInput(input);
    if (decision === 'accepted') {
      this.lastInputMs = this.options.now();
      this.inputExpired = false;
    }
    return decision;
  }

  setInterestRadius(radius: 1 | 2 | 3): void {
    this.activity.setRadius(radius);
  }

  clearInput(): void {
    this.runtime.clearPlayerInput();
    this.currentSnapshot = this.runtime.snapshot();
    this.inputExpired = true;
  }

  performAction(action: AuthorityAction, sequence: number) {
    if (this.currentState !== 'running' || !this.storageHealthy || this.pendingActions >= this.limits.mailboxCount)
      return Promise.reject(new Error('Dedicated server is not accepting player writes.'));
    const copy = this.options.platform.clone(action);
    this.pendingActions += 1;
    const result = this.actionTail.then(() =>
      this.runtime.executeTransaction(
        { epoch: this.options.epoch, issuer: this.runtime.playerId, stream: 'player-actions', sequence },
        () => this.runtime.performAction(copy),
      ),
    );
    this.actionTail = result
      .finally(() => {
        this.pendingActions -= 1;
        this.notifyProgress();
      })
      .catch(() => {});
    return result;
  }

  requestChunk(key: string, internal = false): Promise<boolean> {
    return this.chunkRequests.request(key, internal);
  }

  captureBaseline(
    request: AuthorityBaselineCaptureRequest,
    signal?: CoreAbortSignal,
  ): Promise<AuthorityBaselineCaptureResult> {
    return this.baselineCaptures.capture(request, signal);
  }

  cancelBaselineCapture(captureId: number): Promise<AuthorityBaselineCaptureCancellation> {
    return this.baselineCaptures.cancel(captureId);
  }

  private generateCanonical(
    request: Readonly<{ key: string; cx: number; cy: number; cz: number }>,
    finish: (accepted: boolean) => void,
  ): void {
    const executor = this.options.executors.general;
    this.dispatch(
      {
        ...this.identity(executor),
        kind: 'generate-canonical',
        seed: this.runtime.server.seed,
        generatorVersion: this.runtime.server.generatorVersion,
        ...request,
      },
      (result) => finish(acceptDedicatedCanonicalResult(this.runtime, request, result)),
      () => {
        finish(false);
      },
    );
  }

  /** 受控测试/关停使用；正常运行由 wake 收回结果，不等待后台任务阻塞 tick。 */
  async waitForIdle(): Promise<void> {
    await this.drainAcceptedWork(false);
  }

  save(): Promise<SaveResult> {
    if (this.currentState === 'stopped') return Promise.reject(new Error('Dedicated server has stopped.'));
    if (this.saving) {
      if (!this.nextSave)
        this.nextSave = this.saving.then(
          () => {
            this.nextSave = null;
            return this.startSave();
          },
          (error: unknown) => {
            this.nextSave = null;
            throw error;
          },
        );
      return this.nextSave;
    }
    return this.startSave();
  }

  stop(): Promise<void> {
    if (!this.stopping) this.stopping = this.drain();
    return this.stopping;
  }

  diagnostics() {
    return {
      state: this.currentState,
      mailboxCount: this.mailbox.length,
      mailboxBytes: this.mailboxBytes,
      pendingCompute: this.work.size,
      computeScheduler: this.scheduler.diagnostics(),
      ...this.chunkRequests.diagnostics(),
      ...this.baselineCaptures.diagnostics(),
      ...this.activity.diagnostics(),
      pendingActions: this.pendingActions,
      acceptedJobs: this.acceptedJobs,
      failedJobs: this.failedJobs,
      inputLeaseExpired: this.inputExpired,
      persistenceHealthy: this.storageHealthy,
      durableCommitSequence: this.durableSequence,
      failure: this.failureMessage,
      tickCosts: this.tickCosts.snapshot(),
      candidateCosts: this.candidateCosts.snapshot(),
    };
  }

  private identity(executor: DedicatedComputeExecutor) {
    return {
      epoch: this.options.epoch,
      generation: executor.diagnostics().generation,
    };
  }

  private requestFluid(snapshot: FluidAuthoritySnapshot) {
    if (this.currentState !== 'running') {
      this.runtime.abortFluidWork(snapshot.workId, 'server-draining');
      return;
    }
    const executor = this.options.executors.fluid;
    this.dispatch(
      { ...this.identity(executor), kind: 'fluid', snapshot },
      (result) => {
        if (result.kind !== 'fluid-candidate' || result.candidate.workId !== snapshot.workId)
          throw new Error('Invalid fluid candidate identity.');
        const receipt = this.runtime.commitFluidCandidate(result.candidate);
        if (!receipt.accepted) this.runtime.abortFluidWork(snapshot.workId, receipt.reason);
      },
      () => {
        this.runtime.abortFluidWork(snapshot.workId, 'compute-failed');
      },
    );
  }

  private requestLogic(observation: LogicObservation) {
    if (this.currentState !== 'running') return;
    const executor = this.options.executors.logic;
    this.dispatch(
      {
        ...this.identity(executor),
        kind: 'logic',
        observation,
        physicsHz: this.runtime.frequencies.physicsHz,
      },
      (result) => {
        if (result.kind !== 'logic-intents') throw new Error('Invalid logic result.');
        this.runtime.receiveLogicIntentBatch(result.batch);
        if (this.currentState === 'running') this.runtime.requestLogicObservation();
      },
      () => {
        if (this.currentState === 'running') this.runtime.requestLogicObservation();
      },
    );
  }

  private dispatch(task: DedicatedComputeWork, accept: (result: DedicatedComputeResult) => void, reject: () => void) {
    const generation = this.lifecycleGeneration;
    const failed = (error: unknown) => {
      this.recordJobFailure(error);
      reject();
    };
    const pending = Promise.resolve()
      .then(() => this.scheduler.schedule(task, dedicatedComputePolicy(task)).candidate)
      .then((candidate) => {
        const { result } = candidate;
        const bytes = estimateComputeBytes(result, this.options.platform.utf8);
        if (this.mailbox.length >= this.limits.mailboxCount || this.mailboxBytes + bytes > this.limits.mailboxBytes) {
          const error = new Error('Dedicated candidate mailbox exceeded its budget.');
          candidate.fail(error);
          throw error;
        }
        this.mailboxBytes += bytes;
        this.mailbox.push({
          bytes,
          apply: () => {
            if (generation !== this.lifecycleGeneration || this.currentState === 'stopped') {
              const error = new Error('Stale host result.');
              candidate.fail(error);
              failed(error);
              return;
            }
            const startedAt = this.options.now();
            try {
              accept(result);
              candidate.acknowledge();
              this.acceptedJobs += 1;
            } catch (error) {
              candidate.fail(error);
              failed(error);
            }
            this.candidateCosts.record(Math.max(0, this.options.now() - startedAt));
          },
        });
      })
      .catch(failed)
      .finally(() => {
        this.work.delete(pending);
        this.notifyProgress();
      });
    this.work.add(pending);
  }

  private recordJobFailure(error: unknown): void {
    this.failedJobs += 1;
    this.failureMessage = error instanceof Error ? error.message : String(error);
  }

  private flushMailbox() {
    let remaining = this.limits.mailboxCount;
    while (remaining-- > 0 && this.mailbox.length) {
      const mail = this.mailbox.shift()!;
      this.mailboxBytes -= mail.bytes;
      mail.apply();
    }
  }

  private startSave(): Promise<SaveResult> {
    const pending = this.runtime.save().then(
      (result) => {
        this.storageHealthy = true;
        this.durableSequence = result.commitSequence;
        return result;
      },
      (error: unknown) => {
        this.storageHealthy = false;
        this.currentState = 'failed';
        this.failureMessage = error instanceof Error ? error.message : String(error);
        this.clearInput();
        throw error;
      },
    );
    this.saving = pending;
    void pending
      .finally(() => {
        if (this.saving === pending) this.saving = null;
      })
      .catch(() => {});
    return pending;
  }

  private notifyProgress() {
    for (const resolve of this.progressWaiters) resolve();
    this.progressWaiters.clear();
  }

  private async drainAcceptedWork(includeActions = true) {
    while (true) {
      let wake!: () => void;
      const progress = new Promise<void>((resolve) => {
        wake = resolve;
      });
      this.progressWaiters.add(wake);
      this.flushMailbox();
      if (
        (!includeActions || !this.pendingActions) &&
        !this.work.size &&
        !this.mailbox.length &&
        !this.chunkRequests.diagnostics().pendingChunks
      ) {
        this.progressWaiters.delete(wake);
        return;
      }
      await progress;
    }
  }

  private async drain() {
    const wasFailed = this.currentState === 'failed';
    this.currentState = 'draining';
    this.baselineCaptures.beginClose();
    this.clearInput();
    try {
      await this.drainAcceptedWork();
      await this.baselineCaptures.whenIdle();
      await this.scheduler.drain();
      this.runtime.pause(this.options.now());
      this.currentSnapshot = this.runtime.snapshot();
      await this.save();
      this.currentState = wasFailed ? 'failed' : 'stopped';
    } catch (error) {
      this.currentState = 'failed';
      throw error;
    } finally {
      this.lifecycleGeneration += 1;
      this.scheduler.close();
      await Promise.all([...new Set(Object.values(this.options.executors))].map((executor) => executor.close()));
      this.listeners.clear();
    }
  }
}
