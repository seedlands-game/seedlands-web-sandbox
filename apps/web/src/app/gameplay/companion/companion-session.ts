import { CognitionTimeline } from '../../../client/persistence/cognition-timeline';
import type {
  CharacterControlRequest,
  CharacterControlResult,
  CharacterObservation,
  CharacterState,
} from '@seedlands/game-core/runtime/character-control-protocol';
import type { WorldHarnessPort, WorldHarnessResult } from '@seedlands/game-core/server/harness/world-harness-contract';
import type { ResidentBirthPackage, ResidentDocumentPath, ResidentStatus } from '@seedlands/cognition-protocol';
import type { BoundCharacterControlPort } from '../../../client/authority/browser-authority-client-contract';
import {
  captureApplicationCheckpoint,
  decodeApplicationCheckpoint,
  encodeApplicationCheckpoint,
} from '../../../client/persistence/application-checkpoint';
import {
  exportResidentCheckpoint,
  importResidentCheckpoint,
} from '../../../client/character/resident-checkpoint-transfer';
import { ResidentBridge } from '../../../client/character/resident-bridge';

export type CompanionState = Readonly<{
  characters: readonly CharacterState[];
  character: CharacterState | null;
  observation: CharacterObservation | null;
  connection: Readonly<{ phase: 'disconnected' | 'connecting' | 'ready' | 'failed'; message: string }>;
  cognition: ResidentStatus | null;
  document: Readonly<{ path: ResidentDocumentPath; content: string }> | null;
  download: Readonly<{ url: string; filename: string }> | null;
  busy: boolean;
  error: string;
  notice: string;
}>;
type AuthorityPort = {
  world?: WorldHarnessPort;
  character(request: CharacterControlRequest): Promise<WorldHarnessResult<CharacterControlResult>>;
  bindCharacter(entityId: string): Promise<BoundCharacterControlPort>;
};

/** Product owner for a world's three residents. Models never receive this global UI port. */
export class CompanionSession {
  private value: CompanionState = {
    characters: [],
    character: null,
    observation: null,
    connection: { phase: 'disconnected', message: '按当前行为树生活 · 未连接模型' },
    cognition: null,
    document: null,
    download: null,
    busy: false,
    error: '',
    notice: '',
  };
  private readonly listeners = new Set<(value: CompanionState) => void>();
  private readonly statuses = new Map<string, ResidentStatus>();
  private readonly births = new Map<string, ResidentBirthPackage>();
  private readonly bound = new Set<string>();
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly controller: ResidentBridge;
  private get timelines() {
    return new CognitionTimeline(localStorage);
  }
  private timelineId: string | null = null;
  private worldId: string | null = null;
  private forkedTimeline: string | null = null;
  private connected = false;
  private connectingBindings = false;
  private timelineMustFork = false;
  private recoveryBlocked = false;
  private pendingCognition: string | null = null;
  private restoringCheckpoint = false;
  private connectionSettings: { url: string; token: string } | null = null;

  constructor(
    private readonly authority: () => AuthorityPort | null,
    paused: () => boolean,
    private readonly changePause: (paused: boolean) => void = () => undefined,
  ) {
    this.controller = new ResidentBridge({
      paused,
      onConnection: (phase, message) => {
        this.connected = phase === 'ready';
        if (phase === 'disconnected' || phase === 'failed') this.bound.clear();
        this.publish({ connection: { phase, message } });
      },
      onCharacter: (entityId, status) => {
        this.statuses.set(entityId, status);
        if (entityId === this.value.character?.entityId) this.publish({ cognition: status });
      },
    });
  }
  get = () => this.value;
  subscribe = (listener: (value: CompanionState) => void) => {
    this.listeners.add(listener);
    listener(this.value);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<CompanionState>) {
    this.value = { ...this.value, ...patch };
    for (const listener of this.listeners) listener(this.value);
  }
  start() {
    this.stop();
    void this.refresh(this.generation);
  }
  stop() {
    if (this.value.download) URL.revokeObjectURL(this.value.download.url);
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller.disconnect();
    this.bound.clear();
    this.statuses.clear();
    this.births.clear();
    this.worldId = this.timelineId = this.forkedTimeline = null;
    this.timelineMustFork = false;
    this.pendingCognition = null;
    this.recoveryBlocked = false;
    this.connectionSettings = null;
    this.publish({
      download: null,
      characters: [],
      character: null,
      observation: null,
      cognition: null,
      document: null,
      error: '',
      busy: false,
      notice: '',
    });
  }
  select = (entityId: string) => {
    const character = this.value.characters.find((entry) => entry.entityId === entityId);
    if (character)
      this.publish({ character, observation: null, cognition: this.statuses.get(entityId) ?? null, document: null });
  };
  private async refresh(generation: number): Promise<void> {
    const authority = this.authority();
    if (!authority || generation !== this.generation) return;
    try {
      const list = await authority.character({ kind: 'list' });
      if (generation !== this.generation || !list.ok || list.data.kind !== 'list') return;
      this.worldId = list.frontier.worldId;
      const characters = list.data.characters;
      const character =
        characters.find((entry) => entry.entityId === this.value.character?.entityId) ?? characters[0] ?? null;
      this.publish({
        characters,
        character,
        cognition: character ? (this.statuses.get(character.entityId) ?? null) : null,
      });
      for (const id of this.bound) {
        if (!characters.some((entry) => entry.entityId === id && entry.lifecycle === 'active')) {
          this.bound.delete(id);
          await this.controller.unbind(id);
        }
      }
      if (this.connected && !this.connectingBindings && !this.recoveryBlocked)
        for (const entry of characters.filter((item) => item.lifecycle === 'active').slice(0, 3))
          if (!this.bound.has(entry.entityId)) await this.bind(authority, entry.entityId, generation);
      if (character) {
        const result = await authority.character({
          kind: 'observe',
          entityId: character.entityId,
          sinceCursor: Math.max(0, character.eventCursor - 8),
        });
        if (
          generation === this.generation &&
          this.value.character?.entityId === character.entityId &&
          result.ok &&
          result.data.kind === 'observation'
        )
          this.publish({ observation: result.data.observation, character: result.data.observation.character });
      }
    } catch {
      if (generation === this.generation) this.publish({ error: '伙伴状态暂不可用' });
    } finally {
      if (generation === this.generation) this.timer = setTimeout(() => void this.refresh(generation), 1000);
    }
  }
  private async run(action: (authority: AuthorityPort) => Promise<void>) {
    const authority = this.authority();
    if (!authority || this.value.busy) return;
    const generation = this.generation;
    this.publish({ busy: true, error: '', notice: '' });
    try {
      await action(authority);
    } catch (error) {
      if (generation === this.generation)
        this.publish({
          error:
            error instanceof Error && /[\u4e00-\u9fff]/u.test(error.message)
              ? error.message
              : '操作暂未完成，请稍后再试。',
        });
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  create = (tags?: readonly string[]) =>
    this.run(async (authority) => {
      if (this.value.characters.filter((entry) => entry.lifecycle === 'active').length >= 3)
        throw new Error('这个世界已有三位伙伴');
      if (this.recoveryBlocked) throw new Error('请先完成原存档的伙伴记忆恢复');
      const generation = this.generation;
      const birth = tags?.length ? await this.controller.generateBirth(tags) : undefined;
      if (generation !== this.generation) return;
      const result = await authority.character({
        kind: 'create',
        creationRequestId: birth?.birthId ?? crypto.randomUUID(),
        profile: birth?.profile ?? {
          name: ['阿岚', '小满', '石川'][this.value.characters.length % 3]!,
          personality: '谨慎而好奇，珍惜朋友，喜欢收集食物。会坚持自己的目标，也会认真回应身边的人。',
          background: '初来这片土地的旅行者，希望找到可以安心生活的地方。',
          riskTolerance: 0.3,
        },
        ...(birth ? { behaviorTree: { goal: birth.goal, definition: birth.definition } } : {}),
      });
      if (!result.ok) throw new Error('暂时无法邀请伙伴，请在开阔、平坦的地方重试。');
      if (generation === this.generation && result.data.kind === 'created') {
        const character = result.data.character;
        if (birth) this.births.set(character.entityId, birth);
        this.publish({
          character,
          characters: [...this.value.characters, character],
          observation: null,
          cognition: null,
        });
        if (this.connected) await this.bind(authority, character.entityId, generation);
      }
    });
  dialogue = (text: string) =>
    this.run(async (authority) => {
      const character = this.value.character;
      if (!character || character.lifecycle !== 'active' || !text.trim()) return;
      const result = await authority.character({
        kind: 'dialogue',
        entityId: character.entityId,
        text: text.trim().slice(0, 280),
      });
      if (!result.ok)
        throw new Error(
          result.error.code === 'CHARACTER_UNAVAILABLE'
            ? '暂时无法交流，请靠近伙伴后再试。'
            : '这句话暂时没能传达，请稍后再试。',
        );
    });
  private async bind(authority: AuthorityPort, entityId: string, generation: number) {
    this.bound.add(entityId);
    try {
      const port = await authority.bindCharacter(entityId);
      if (generation !== this.generation) {
        await port.dispose();
        return;
      }
      await this.controller.bind(port, this.births.get(entityId));
    } catch (error) {
      this.bound.delete(entityId);
      throw error;
    }
  }
  connect = (url: string, token: string) => this.run((authority) => this.connectTo(authority, url, token));
  private async connectTo(authority: AuthorityPort, url: string, token: string): Promise<void> {
    const character = this.value.characters.find((entry) => entry.lifecycle === 'active');
    const generation = this.generation;
    const port = character ? await authority.bindCharacter(character.entityId) : null;
    if (generation !== this.generation) {
      await port?.dispose();
      return;
    }
    try {
      const identity = port?.binding ?? (await authority.world?.identity());
      const binding = identity && 'ok' in identity ? (identity.ok ? identity.data : null) : identity;
      if (!binding) throw new Error('世界身份暂不可用');
      const capabilities = await authority.character({ kind: 'capabilities' });
      if (generation !== this.generation) {
        await port?.dispose();
        return;
      }
      if (!capabilities.ok || capabilities.data.kind !== 'capabilities') throw new Error('世界能力暂不可用');
      this.worldId = binding.worldId;
      this.recoveryBlocked = this.timelines.requiresRestore(binding.worldId);
      this.timelineId = this.timelineMustFork
        ? (this.forkedTimeline ?? crypto.randomUUID())
        : this.timelines.current(binding.worldId);
      this.timelineMustFork = false;
      this.timelines.select(binding.worldId, this.timelineId);
      this.connectingBindings = true;
      this.connectionSettings = { url, token };
      this.controller.connect(
        url,
        token,
        { worldId: binding.worldId, epoch: binding.epoch, timelineId: this.timelineId },
        capabilities.data.capabilities,
      );
      await this.controller.whenReady();
      if (generation !== this.generation) {
        await port?.dispose();
        return;
      }
      if (this.pendingCognition !== null) {
        await importResidentCheckpoint(this.controller, this.pendingCognition);
        this.timelines.finishRestore(binding.worldId);
        this.pendingCognition = null;
        this.recoveryBlocked = false;
        this.publish({ notice: '世界与伙伴记忆已恢复。世界保持暂停，可以继续游玩。' });
      }
      this.bound.clear();
      if (this.recoveryBlocked) {
        await port?.dispose();
        this.publish({ notice: '上次伙伴记忆尚未恢复。请重新导入原存档文件，完成前伙伴只执行当前行为树。' });
        return;
      }
      if (character && port) {
        this.bound.add(character.entityId);
        await this.controller.bind(port, this.births.get(character.entityId));
      }
    } catch (error) {
      await port?.dispose();
      this.controller.disconnect();
      throw error;
    } finally {
      this.connectingBindings = false;
    }
  }

  disconnect = () => this.controller.disconnect();
  setPaused = (paused: boolean) => this.controller.setPaused(paused);
  configure = (seconds: number) => {
    const id = this.value.character?.entityId;
    if (this.connected && id) this.controller.configure(id, seconds);
  };
  readDocument = (path: ResidentDocumentPath) =>
    this.run(async () => {
      const id = this.value.character?.entityId;
      const generation = this.generation;
      if (!id) return;
      const content = await this.controller.readDocument(id, path);
      if (generation === this.generation && this.value.character?.entityId === id)
        this.publish({ document: { path, content } });
    });
  worldRestored = (worldId = this.worldId) => {
    if (this.restoringCheckpoint) return;
    this.worldId = worldId;
    this.timelineMustFork = true;
    this.forkedTimeline = crypto.randomUUID();
    if (this.worldId) this.timelines.select(this.worldId, this.forkedTimeline);
    this.controller.disconnect();
    this.bound.clear();
    this.statuses.clear();
    this.publish({ cognition: null, document: null });
  };
  exportCheckpoint = () =>
    this.run(async (authority) => {
      if (!authority.world) throw new Error('世界存档接口不可用');
      if (this.recoveryBlocked) throw new Error('请先完成原存档的伙伴记忆恢复');
      if (this.worldId && this.timelines.hasMemory(this.worldId) && !this.connected)
        throw new Error('这个世界已有伙伴记忆，请连接思考服务后一起保存。');
      const before = await authority.world.clock({ kind: 'status' });
      if (!before.ok) throw new Error('世界时钟不可用');
      this.changePause(true);
      const paused = await authority.world.clock({ kind: 'pause' });
      if (!paused.ok) throw new Error('世界无法暂停');
      this.controller.setPaused(true);
      try {
        const checkpoint = await captureApplicationCheckpoint(
          authority.world,
          this.connected ? () => exportResidentCheckpoint(this.controller) : null,
          this.connected ? this.timelineId : null,
        );
        const url = URL.createObjectURL(
          new Blob([encodeApplicationCheckpoint(checkpoint)], { type: 'application/json' }),
        );
        if (this.value.download) URL.revokeObjectURL(this.value.download.url);
        this.publish({ download: { url, filename: `seedlands-${Date.now()}.json` } });
      } finally {
        if (!before.data.paused) await authority.world.clock({ kind: 'run' });
        this.changePause(before.data.paused);
        this.controller.setPaused(before.data.paused);
      }
    });
  importCheckpoint = (file: File) =>
    this.run(async (authority) => {
      if (!authority.world || file.size > 128 * 1024 * 1024) throw new Error('世界存档接口不可用或文件过大');
      const checkpoint = await decodeApplicationCheckpoint(await file.text());
      if (checkpoint.cognition !== null && !this.connectionSettings)
        throw new Error('这份存档包含伙伴记忆，请先连接本机思考服务');
      const settings = this.connectionSettings;
      this.changePause(true);
      const paused = await authority.world.clock({ kind: 'pause' });
      if (!paused.ok) throw new Error('世界无法暂停');
      this.controller.setPaused(true);
      const restoreWorldId = `seedlands:g${checkpoint.world.generatorVersion}:${checkpoint.world.seedText}`;
      const alreadyPending = this.timelines.requiresRestore(restoreWorldId);
      if (checkpoint.cognition !== null) this.timelines.beginRestore(restoreWorldId);
      this.restoringCheckpoint = true;
      let result;
      try {
        result = await authority.world.checkpoint({ kind: 'restore', snapshot: checkpoint.world });
      } finally {
        this.restoringCheckpoint = false;
      }
      if (!result.ok) {
        if (!alreadyPending) this.timelines.finishRestore(restoreWorldId);
        throw new Error('世界存档恢复失败，原世界保持不变');
      }
      this.worldRestored(restoreWorldId);
      this.pendingCognition = checkpoint.cognition;
      if (checkpoint.cognition === null) this.timelines.finishRestore(restoreWorldId);
      const listed = await authority.character({ kind: 'list' });
      if (listed.ok && listed.data.kind === 'list')
        this.publish({
          characters: listed.data.characters,
          character: listed.data.characters[0] ?? null,
          observation: null,
        });
      this.publish({
        notice: checkpoint.cognition ? '世界已恢复并暂停；正在恢复对应的伙伴记忆。' : '世界已恢复并暂停。',
      });
      if (checkpoint.cognition !== null && settings) await this.connectTo(authority, settings.url, settings.token);
    });
  resumeWorld = () =>
    this.run(async (authority) => {
      if (!authority.world) throw new Error('世界时钟不可用');
      const result = await authority.world.clock({ kind: 'run' });
      if (!result.ok) throw new Error('世界暂时无法继续');
      this.changePause(false);
      this.controller.setPaused(false);
      this.publish({ notice: '世界已继续。' });
    });
  closeDocument = () => this.publish({ document: null });
}
