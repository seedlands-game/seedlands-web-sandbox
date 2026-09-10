import { HumanMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CharacterObservation, ControlBinding } from '@seedlands/game-core/runtime/character-control-protocol';
import type { BehaviorCapability } from '@seedlands/game-core/runtime/behavior-control-protocol';
import type { ResidentBirthPackage, ResidentStatus, ResidentWorldBinding } from '@seedlands/cognition-protocol';
import {
  createResidentAgent,
  createResidentAgentDocument,
  createResidentSoulDocument,
  type ResidentAgent,
  type ResidentWorldPort,
} from './resident-agent.js';
import { ResidentScheduler, type ResidentTrigger } from './resident-scheduler.js';
import { parseResidentRuntime, type ResidentRuntimeSnapshot } from './resident-runtime-codec.js';
import type { FrameworkPersistence, PersistentNpcWorkspace, WorkspaceBinding } from './workspace/index.js';

export type ResidentChannelOptions = Readonly<{
  world: ResidentWorldBinding;
  binding: ControlBinding;
  observation: CharacterObservation;
  birth?: ResidentBirthPackage;
  capabilities: readonly BehaviorCapability[];
  workspace: PersistentNpcWorkspace;
  framework: FrameworkPersistence;
  flash: BaseChatModel | null;
  pro: BaseChatModel | null;
  worldPort: ResidentWorldPort;
  paused: boolean;
  status(status: ResidentStatus): void;
}>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** One independent resident transaction. Supply concurrency belongs exclusively to the model gateway. */
export class ResidentChannel {
  readonly identity: WorkspaceBinding;
  private observation: CharacterObservation;
  private scheduler: ResidentScheduler | null = null;
  private agent: ResidentAgent | null = null;
  private phase: ResidentStatus['phase'] = 'living';
  private message = '按当前行为树生活';
  private logicalRounds = 0;
  private compactions = 0;
  private estimatedTokens = 0;
  private metadataRevision = 1;
  private disposed = false;
  private paused: boolean;
  private abort: AbortController | null = null;
  private ingestion: Promise<void> = Promise.resolve();
  private metadataWrites: Promise<void> = Promise.resolve();
  private maintenance: Promise<void> | null = null;
  private activeWork: Promise<void> = Promise.resolve();
  private queuedPages = 0;
  private behaviorRevision = -1;
  private needsBudgetCheck = true;
  private shutdownWork: Promise<void> | null = null;

  constructor(readonly options: ResidentChannelOptions) {
    this.identity = {
      worldId: options.world.worldId,
      timelineId: options.world.timelineId,
      actorId: options.binding.entityId,
      incarnation: options.binding.incarnation,
    };
    this.observation = options.observation;
    this.paused = options.paused;
  }

  async initialize(): Promise<ResidentStatus> {
    const { workspace, birth, observation, framework, flash, pro } = this.options;
    const existing = (await workspace.listBindings(this.identity.worldId, this.identity.timelineId)).some(
      (entry) => entry.actorId === this.identity.actorId && entry.incarnation === this.identity.incarnation,
    );
    if (!existing)
      await workspace.initializeNpc(this.identity, {
        agent: createResidentAgentDocument(this.options.capabilities, {
          profile: observation.character.profile,
          ...(birth ? { factoryAgent: birth.agent } : {}),
        }),
        soul: birth?.soul ?? createResidentSoulDocument(observation.character.profile),
        memory: birth?.memory ?? '刚刚来到这个世界，尚未经历任何事情。',
        memoryEstimatedTokens: 128,
        behavior: observation.character.behaviorTree,
        templateVersion: 'resident-v2',
      });
    const projected = await workspace.readFile(this.identity, '/behavior/current.json', 'system');
    if (projected.content === JSON.stringify(observation.character.behaviorTree))
      this.behaviorRevision = observation.character.behaviorTree.revision;
    const metadata = await workspace.getRuntimeMetadata(this.identity);
    this.metadataRevision = metadata.revision;
    this.logicalRounds = metadata.logicalRounds;
    this.compactions = metadata.compactions;
    if (flash && pro)
      this.agent = createResidentAgent({
        binding: this.identity,
        flashModel: flash,
        proModel: pro,
        workspace,
        world: this.options.worldPort,
        capabilities: this.options.capabilities,
        checkpointer: framework.checkpointer,
        store: framework.store,
        toolSchemaRevision: 'resident-tools-v2',
        modelConfigurationRevision: 'gateway-flash-pro-v1',
      });
    this.scheduler = new ResidentScheduler({
      restored: parseResidentRuntime(metadata.snapshot, metadata),
      dispatch: (trigger) => this.admit(trigger),
      onError: () => {
        this.phase = 'blocked';
        this.message = '思考暂不可用，当前行为继续';
        void this.persistAndPublish();
      },
    });
    let recovered = false;
    if (this.scheduler.needsRecovery()) {
      if (this.agent) {
        await this.agent.recoverInterruptedTurn();
        this.scheduler.finishRecovery();
        await this.persist();
        recovered = true;
      } else {
        this.phase = 'blocked';
        this.message = '上次思考尚待恢复，当前行为继续';
      }
    }
    if (this.paused) this.scheduler.pause();
    else this.scheduler.resume();
    if (!this.agent) {
      this.scheduler.block();
      this.phase = 'blocked';
      this.message = '模型未配置，当前行为继续';
    }
    await this.receive(observation);
    if (recovered) this.scheduler.activateRecovered();
    await this.persist();
    return this.snapshot();
  }

  receive(observation: CharacterObservation): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (
      observation.character.entityId !== this.identity.actorId ||
      observation.character.incarnation !== this.identity.incarnation
    )
      return Promise.reject(new Error('observation identity changed'));
    if (this.queuedPages >= 16) return Promise.reject(new Error('resident observation queue exceeded'));
    this.queuedPages++;
    const pending = this.ingestion.then(async () => {
      if (this.disposed) return;
      const coverage = observation.eventCoverage;
      await this.options.workspace.receiveEventPage(this.identity, {
        pageId: `world:${coverage.requestedAfter}:${coverage.through}:${coverage.returnedThrough}`,
        coverage,
        events: observation.events.map((event) => ({
          eventId: `world:${event.cursor}`,
          cursor: event.cursor,
          payload: event,
        })),
      });
      if (observation.character.behaviorTree.revision !== this.behaviorRevision) {
        const current = await this.options.workspace.readFile(this.identity, '/behavior/current.json', 'system');
        await this.options.workspace.projectBehavior(
          this.identity,
          current.revision,
          observation.character.behaviorTree,
        );
        this.behaviorRevision = observation.character.behaviorTree.revision;
      }
      this.observation = clone(observation);
      for (const event of observation.events)
        if (event.type === 'rejudge-requested')
          this.scheduler?.notify({
            source: event.nodeId ?? 'world',
            episode: event.episode ?? event.cursor,
            reason: (event.reason ?? event.text ?? '世界出现了新的变化').slice(0, 160),
          });
      if (observation.character.lifecycle !== 'active') {
        this.scheduler?.block();
        this.abort?.abort();
        this.phase = 'blocked';
        this.message = '角色生命已经结束';
      }
      await this.persistAndPublish();
    });
    this.ingestion = pending
      .catch(() => undefined)
      .finally(() => {
        this.queuedPages--;
      });
    return pending;
  }

  configure(seconds: number): void {
    this.scheduler?.configure(seconds);
    void this.persistAndPublish();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.scheduler?.pause();
      this.abort?.abort();
    } else this.scheduler?.resume();
    void this.persistAndPublish();
  }

  async snapshot(): Promise<ResidentStatus> {
    const [window, watermarks] = await Promise.all([
      this.options.workspace.getActiveWindow(this.identity),
      this.options.workspace.getWatermarks(this.identity),
    ]);
    return {
      phase: this.paused ? 'paused' : this.phase,
      message: this.paused ? '世界已暂停' : this.message,
      ...window,
      ...watermarks,
      estimatedContextTokens: this.estimatedTokens,
      remainingFallbackMs: this.scheduler?.snapshot().remainingMs ?? 180_000,
      logicalRounds: this.logicalRounds,
      compactions: this.compactions,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scheduler?.dispose();
    this.abort?.abort();
  }

  shutdown(): Promise<void> {
    if (this.shutdownWork) return this.shutdownWork;
    this.dispose();
    this.shutdownWork = (async () => {
      await this.ingestion.catch(() => undefined);
      await this.activeWork.catch(() => undefined);
      await Promise.resolve();
      this.scheduler?.settleStopped();
      await this.metadataWrites.catch(() => undefined);
      await this.persist(true);
    })();
    return this.shutdownWork;
  }

  async flush(): Promise<void> {
    await this.ingestion;
    if (this.abort) this.abort.abort();
    await this.activeWork.catch(() => undefined);
    await this.metadataWrites;
    await this.persist();
  }

  private admit(trigger: ResidentTrigger): { accepted: boolean; completion: Promise<void> } {
    if (!this.agent || this.disposed || this.paused) return { accepted: false, completion: Promise.resolve() };
    if (this.needsBudgetCheck) {
      const completion = this.prepareAdmission(trigger);
      this.activeWork = completion;
      return { accepted: false, completion };
    }
    const completion = this.run(trigger);
    this.activeWork = completion;
    return { accepted: true, completion };
  }

  private prepareAdmission(trigger: ResidentTrigger): Promise<void> {
    if (this.maintenance) return this.maintenance;
    const maintenance = (async () => {
      await this.ingestion;
      if (!this.agent || this.disposed || this.paused) return;
      const input = this.turnInput(trigger, clone(this.observation));
      const assessment = await this.agent.assessNextTurnBudget(input);
      this.estimatedTokens = assessment.estimatedTotalTokens;
      const budget = assessment.status;
      if (budget !== 'ready') {
        this.phase = 'compressing';
        this.message = '正在整理经历，身体继续当前生活';
        await this.publish();
        const abort = new AbortController();
        this.abort = abort;
        const timeout = setTimeout(() => abort.abort(), 300_000);
        const result = await this.agent
          .compactMemory({ hardLimitReached: budget === 'suspend', signal: abort.signal })
          .finally(() => clearTimeout(timeout));
        if (result.status === 'published') this.compactions++;
        else {
          this.phase = 'blocked';
          this.message =
            budget === 'suspend' ? '记忆达到上限，旧经历与当前行为保留' : '记忆整理暂未完成，旧经历与当前行为保留';
          return;
        }
      }
      this.needsBudgetCheck = false;
      this.phase = 'living';
    })().finally(async () => {
      this.abort = null;
      this.maintenance = null;
      if (!this.disposed && this.phase !== 'blocked') this.scheduler?.unblock();
      await this.persistAndPublish();
    });
    this.maintenance = maintenance;
    return maintenance;
  }

  private async run(trigger: ResidentTrigger): Promise<void> {
    await this.ingestion;
    if (this.disposed || !this.agent || this.paused) return;
    const observation = clone(this.observation);
    this.abort = new AbortController();
    const abort = this.abort;
    const timeout = setTimeout(() => abort.abort(), 120_000);
    this.logicalRounds++;
    this.needsBudgetCheck = true;
    try {
      this.phase = 'thinking';
      this.message = '正在思考，身体继续当前生活';
      await this.persistAndPublish();
      const input = this.turnInput(trigger, observation);
      await this.agent.invokeTurn({ requestId: input.id, message: input, signal: abort.signal });
      this.message = '本轮思考完成，继续自己的生活';
    } catch {
      this.message = abort.signal.aborted ? '本轮思考已停止，当前行为继续' : '思考暂不可用，当前行为继续';
    } finally {
      clearTimeout(timeout);
      if (this.abort === abort) this.abort = null;
      if (this.phase !== 'blocked') this.phase = 'living';
      await this.persistAndPublish();
    }
  }

  private turnInput(trigger: ResidentTrigger, observation: CharacterObservation): HumanMessage {
    return new HumanMessage({ id: crypto.randomUUID(), content: JSON.stringify({ trigger, observation }) });
  }

  private persist(force = false): Promise<void> {
    this.metadataWrites = this.metadataWrites
      .catch(() => undefined)
      .then(async () => {
        if (!this.scheduler || (this.disposed && !force)) return;
        const metadata = await this.options.workspace.setRuntimeMetadata(this.identity, {
          expectedRevision: this.metadataRevision,
          snapshot: { version: 1, scheduler: this.scheduler.snapshot() } satisfies ResidentRuntimeSnapshot,
          logicalRounds: this.logicalRounds,
          compactions: this.compactions,
        });
        this.metadataRevision = metadata.revision;
      });
    return this.metadataWrites;
  }

  private async publish(): Promise<void> {
    if (!this.disposed) this.options.status(await this.snapshot());
  }

  private async persistAndPublish(): Promise<void> {
    if (this.disposed) return;
    await this.persist();
    await this.publish();
  }
}
