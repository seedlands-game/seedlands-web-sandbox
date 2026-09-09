import type {
  CharacterControlRequest,
  CharacterControlResult,
  CharacterObservation,
  CharacterState,
} from '@seedlands/game-core/runtime/character-control-protocol';
import type { WorldHarnessResult } from '@seedlands/game-core/server/harness/world-harness-contract';
import {
  CharacterControllerBridge,
  type CharacterControllerPort,
  type ControllerConnectionState,
} from '../../../client/character/controller-bridge';

export type CompanionState = Readonly<{
  character: CharacterState | null;
  observation: CharacterObservation | null;
  connection: ControllerConnectionState;
  busy: boolean;
  error: string;
}>;
type AuthorityPort = {
  character(request: CharacterControlRequest): Promise<WorldHarnessResult<CharacterControlResult>>;
  bindCharacter(entityId: string): Promise<CharacterControllerPort>;
};
export class CompanionSession {
  private value: CompanionState = {
    character: null,
    observation: null,
    connection: { phase: 'disconnected', message: '基础生活中 · 未连接模型' },
    busy: false,
    error: '',
  };
  private listeners = new Set<(value: CompanionState) => void>();
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly controller: CharacterControllerBridge;
  constructor(
    private readonly authority: () => AuthorityPort | null,
    paused: () => boolean,
  ) {
    this.controller = new CharacterControllerBridge({ paused, onState: (connection) => this.publish({ connection }) });
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
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.controller.disconnect();
    this.publish({ character: null, observation: null, error: '', busy: false });
  }
  private async refresh(generation: number): Promise<void> {
    const authority = this.authority();
    if (!authority || generation !== this.generation) return;
    try {
      const list = await authority.character({ kind: 'list' });
      if (generation !== this.generation) return;
      if (!list.ok || list.data.kind !== 'list') return;
      const character = list.data.characters[0] ?? null;
      if (character?.lifecycle === 'deceased' && this.value.character?.lifecycle !== 'deceased')
        this.controller.disconnect();
      this.publish({ character });
      if (character) {
        const result = await authority.character({
          kind: 'observe',
          entityId: character.entityId,
          sinceCursor: Math.max(0, character.eventCursor - 8),
        });
        if (generation === this.generation && result.ok && result.data.kind === 'observation')
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
  create = () =>
    this.run(async (authority) => {
      const generation = this.generation;
      const result = await authority.character({
        kind: 'create',
        profile: {
          name: '阿岚',
          personality:
            '谨慎而好奇，珍惜朋友，喜欢收集食物。会坚持自己的目标，也会认真回应身边的人。遇到危险先保护自己。',
          background: '初来这片土地的旅行者，希望找到可以安心生活的地方。',
          riskTolerance: 0.3,
        },
      });
      if (!result.ok) throw new Error('暂时无法邀请伙伴，请在开阔、平坦的地方重试。');
      if (generation === this.generation && result.data.kind === 'created')
        this.publish({ character: result.data.character });
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
  connect = (url: string, token: string) =>
    this.run(async (authority) => {
      const character = this.value.character;
      if (!character || character.lifecycle !== 'active') return;
      const generation = this.generation;
      const port = await authority.bindCharacter(character.entityId);
      if (generation !== this.generation) {
        await port.dispose();
        return;
      }
      try {
        this.controller.connect(url, token, port);
      } catch (error) {
        await port.dispose();
        throw error;
      }
    });
  disconnect = () => this.controller.disconnect();
  configure = (seconds: number, context: 128000 | 256000 = 128000) => this.controller.configure(seconds, context);
}
