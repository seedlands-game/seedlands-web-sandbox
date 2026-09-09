import type {
  CharacterControlRequest,
  CharacterControlResult,
  CharacterObservation,
  CharacterState,
} from '@seedlands/game-core/runtime/character-control-protocol';
import type { WorldHarnessResult } from '@seedlands/game-core/server/harness/world-harness-contract';
import type { ResidentBirthPackage, ResidentDocumentPath, ResidentStatus } from '@seedlands/cognition-protocol';
import type { BoundCharacterControlPort } from '../../../client/authority/browser-authority-client-contract';
import { ResidentBridge } from '../../../client/character/resident-bridge';

export type CompanionState = Readonly<{
  characters: readonly CharacterState[];
  character: CharacterState | null;
  observation: CharacterObservation | null;
  connection: Readonly<{ phase: 'disconnected' | 'connecting' | 'ready' | 'failed'; message: string }>;
  cognition: ResidentStatus | null;
  document: Readonly<{ path: ResidentDocumentPath; content: string }> | null;
  busy: boolean;
  error: string;
}>;
type AuthorityPort = {
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
    busy: false,
    error: '',
  };
  private readonly listeners = new Set<(value: CompanionState) => void>();
  private readonly statuses = new Map<string, ResidentStatus>();
  private readonly births = new Map<string, ResidentBirthPackage>();
  private readonly bound = new Set<string>();
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly controller: ResidentBridge;
  private timelineId: string | null = null;
  private connected = false;

  constructor(
    private readonly authority: () => AuthorityPort | null,
    paused: () => boolean,
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
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller.disconnect();
    this.bound.clear();
    this.statuses.clear();
    this.births.clear();
    this.publish({
      characters: [],
      character: null,
      observation: null,
      cognition: null,
      document: null,
      error: '',
      busy: false,
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
      if (this.connected)
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
    this.publish({ busy: true, error: '' });
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
      const generation = this.generation;
      const birth = tags?.length ? await this.controller.generateBirth(tags) : undefined;
      if (generation !== this.generation) return;
      const result = await authority.character({
        kind: 'create',
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
  connect = (url: string, token: string) =>
    this.run(async (authority) => {
      const character = this.value.characters.find((entry) => entry.lifecycle === 'active');
      if (!character) throw new Error('请先邀请一位伙伴');
      const generation = this.generation;
      const port = await authority.bindCharacter(character.entityId);
      if (generation !== this.generation) {
        await port.dispose();
        return;
      }
      try {
        const capabilities = await authority.character({ kind: 'capabilities' });
        if (generation !== this.generation) {
          await port.dispose();
          return;
        }
        if (!capabilities.ok || capabilities.data.kind !== 'capabilities') throw new Error('世界能力暂不可用');
        const key = `seedlands.cognition.timeline:${port.binding.worldId}`;
        this.timelineId = localStorage.getItem(key) ?? crypto.randomUUID();
        localStorage.setItem(key, this.timelineId);
        this.controller.connect(
          url,
          token,
          { worldId: port.binding.worldId, epoch: port.binding.epoch, timelineId: this.timelineId },
          capabilities.data.capabilities,
        );
        this.bound.clear();
        this.bound.add(character.entityId);
        await this.controller.bind(port, this.births.get(character.entityId));
      } catch (error) {
        await port.dispose();
        throw error;
      }
    });
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
  closeDocument = () => this.publish({ document: null });
}
