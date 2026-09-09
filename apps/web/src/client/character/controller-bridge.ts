import { CONTROLLER_FRAME_MAX_BYTES } from '@seedlands/cognition-protocol';
import type {
  CharacterControlResult,
  CharacterGoal,
  ControlBinding,
} from '@seedlands/game-core/runtime/character-control-protocol';
import type { ControllerClientMessage, ControllerHostMessage, ControllerUsage } from '@seedlands/cognition-protocol';
import type { WorldHarnessResult } from '@seedlands/game-core/server/harness/world-harness-contract';
import { validateControllerHostMessage, validateControllerUrl } from './controller-bridge-validation';

export type CharacterControllerPort = Readonly<{
  binding: ControlBinding;
  dispose: () => void | Promise<void>;
  observe: (sinceCursor?: number) => Promise<WorldHarnessResult<CharacterControlResult>>;
  intent: (
    requestId: string,
    revision: number,
    goal: CharacterGoal,
    say?: string,
  ) => Promise<WorldHarnessResult<CharacterControlResult>>;
  memory: (revision: number, cursor: number, summary: string) => Promise<WorldHarnessResult<CharacterControlResult>>;
}>;
export type ControllerConnectionState = Readonly<{
  phase:
    'disconnected' | 'connecting' | 'ready' | 'thinking' | 'compressing' | 'awaiting-receipt' | 'fallback' | 'paused';
  message: string;
  usage?: ControllerUsage;
}>;
const stateText = {
  ready: '已连接，按当前计划行动',
  thinking: '正在考虑接下来做什么',
  compressing: '正在整理经历',
  'awaiting-receipt': '正在提交新的计划',
  fallback: '暂按基础行为活动',
  paused: '世界已暂停',
} as const;
const failureText: Record<string, string> = {
  'missing-key': '本机服务未配置模型凭据',
  timeout: '模型暂未响应',
  'rate-limited': '模型服务暂时限流',
  'invalid-tool': '这次决定未通过校验',
  'over-budget': '已达到本轮计算预算',
  transport: '模型连接暂不可用',
  stale: '世界已变化，等待更新决定',
};

/** 浏览器只传递绑定角色投影与有界意图；无开发者任意方法分派。 */
export class CharacterControllerBridge {
  private socket: WebSocket | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;
  private hostSequence = -1;
  private cursor = 0;
  private paused = false;
  private ready = false;
  private port: CharacterControllerPort | null = null;
  private pendingCount = 0;
  private pending: Promise<void> = Promise.resolve();
  private fallbackSeconds = 180;
  private contextLimit: 128000 | 256000 = 128000;

  constructor(
    private readonly options: Readonly<{
      paused: () => boolean;
      onState: (state: ControllerConnectionState) => void;
      socket?: (url: string) => WebSocket;
    }>,
  ) {}

  connect(url: string, token: string, port: CharacterControllerPort): void {
    const address = validateControllerUrl(url);
    if (!token.trim() || token.length > 512) throw new TypeError('请填写本机服务显示的配对码');
    this.disconnect(false);
    const generation = this.generation;
    this.port = port;
    this.options.onState({ phase: 'connecting', message: '正在连接本机思考服务…' });
    const socket = (this.options.socket ?? ((target) => new WebSocket(target)))(address);
    this.socket = socket;
    this.connectTimer = setTimeout(() => {
      if (generation === this.generation && !this.ready) this.fail('本机服务连接超时');
    }, 10000);
    socket.onopen = () => {
      if (generation !== this.generation) return;
      this.send({ kind: 'hello', pairingToken: token });
    };
    socket.onmessage = (event) => {
      if (generation !== this.generation) return;
      if (
        typeof event.data !== 'string' ||
        new TextEncoder().encode(event.data).byteLength > CONTROLLER_FRAME_MAX_BYTES
      )
        return this.fail('本机服务返回了无效消息');
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return this.fail('本机服务返回了无效消息');
      }
      const message = validateControllerHostMessage(parsed, port.binding, this.hostSequence);
      if (!message) return this.fail('本机服务消息的身份或顺序不匹配');
      this.hostSequence = message.sequence;
      if (this.pendingCount >= 16) return this.fail('本机服务消息过多，已暂停连接');
      this.pendingCount += 1;
      this.pending = this.pending
        .then(async () => {
          if (generation === this.generation) await this.receive(message, generation);
        })
        .catch(() => {
          if (generation === this.generation) this.fail('角色状态已变化，请重新连接');
        })
        .finally(() => {
          if (generation === this.generation) this.pendingCount -= 1;
        });
    };
    socket.onerror = () => {
      if (generation === this.generation) this.fail('连接失败，请确认本机服务已启动');
    };
    socket.onclose = () => {
      if (generation === this.generation) this.fail('连接已断开，伙伴继续按基础行为活动');
    };
  }

  configure(fallbackSeconds: number, contextLimit: 128000 | 256000 = 128000): void {
    if (!Number.isFinite(fallbackSeconds) || fallbackSeconds < 60 || fallbackSeconds > 600)
      throw new RangeError('决策兜底间隔须为1–10分钟');
    this.fallbackSeconds = Math.round(fallbackSeconds);
    if (contextLimit !== 128000 && contextLimit !== 256000) throw new RangeError('经历窗口须为128K或256K');
    this.contextLimit = contextLimit;
    if (this.ready) this.send({ kind: 'configure', fallbackSeconds: this.fallbackSeconds, contextLimit });
  }

  disconnect(notify = true): void {
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.timer = this.connectTimer = null;
    if (this.socket) {
      this.socket.onopen = this.socket.onmessage = this.socket.onerror = this.socket.onclose = null;
      this.socket.close();
    }
    this.socket = null;
    if (this.port) void Promise.resolve(this.port.dispose()).catch(() => undefined);
    this.port = null;
    this.ready = false;
    this.sequence = 0;
    this.hostSequence = -1;
    this.cursor = 0;
    this.paused = false;
    this.pending = Promise.resolve();
    this.pendingCount = 0;
    if (notify) this.options.onState({ phase: 'disconnected', message: '基础生活中 · 未连接模型' });
  }

  private fail(message: string): void {
    this.disconnect(false);
    this.options.onState({ phase: 'fallback', message });
  }

  private send(
    payload: Omit<ControllerClientMessage, 'protocolVersion' | 'binding' | 'sequence'> | Record<string, unknown>,
  ): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.port) return;
    if (this.socket.bufferedAmount > 262144) return this.fail('本机服务处理较慢，已暂停连接');
    const body = JSON.stringify({
      ...payload,
      protocolVersion: 1,
      binding: this.port.binding,
      sequence: this.sequence++,
    });
    if (new TextEncoder().encode(body).byteLength > CONTROLLER_FRAME_MAX_BYTES)
      return this.fail('角色观察超出传输预算');
    this.socket.send(body);
  }

  private async receive(message: ControllerHostMessage, generation: number): Promise<void> {
    if (!this.port) return;
    if (message.kind === 'error')
      return this.fail(message.code === 'PAIRING_REJECTED' ? '配对码无效，请重新连接' : '本机服务拒绝了连接');
    if (message.kind === 'ready') {
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectTimer = null;
      if (this.ready) return this.fail('本机服务重复初始化');
      this.ready = true;
      this.configure(this.fallbackSeconds, this.contextLimit);
      this.options.onState(
        message.modelAvailability === 'available'
          ? { phase: 'ready', message: stateText.ready }
          : { phase: 'fallback', message: '模型暂不可用，伙伴继续基础生活' },
      );
      await this.poll(generation);
      return;
    }
    if (!this.ready) return this.fail('本机服务尚未完成身份绑定');
    if (message.kind === 'status') {
      this.options.onState({
        phase: message.state,
        message: message.reason ? (failureText[message.reason] ?? stateText[message.state]) : stateText[message.state],
        ...(message.usage ? { usage: message.usage } : {}),
      });
      return;
    }
    const result =
      message.kind === 'intent'
        ? await this.port.intent(message.requestId, message.observedRevision, message.intent.goal, message.intent.say)
        : await this.port.memory(message.expectedMemoryRevision, message.throughCursor, message.summary);
    if (generation !== this.generation) return;
    const character = result.ok && 'character' in result.data ? result.data.character : null;
    const accepted = result.ok && !(result.data.kind === 'intent' && !result.data.accepted);
    this.send({
      kind: 'receipt',
      receipt: {
        requestId: message.requestId,
        status: accepted ? 'accepted' : 'rejected',
        cursor: character?.eventCursor ?? this.cursor,
        revision: character?.revision ?? 0,
        ...(!result.ok ? { reason: result.error.code } : {}),
      },
    });
  }

  private async poll(generation: number): Promise<void> {
    if (generation !== this.generation || !this.port) return;
    try {
      const paused = this.options.paused();
      if (paused !== this.paused) {
        this.paused = paused;
        this.send({ kind: 'control', command: paused ? 'pause' : 'resume' });
      }
      if (!paused) {
        const result = await this.port.observe(this.cursor);
        if (generation !== this.generation) return;
        if (!result.ok || result.data.kind !== 'observation') return this.fail('角色世界已变化，请重新连接');
        this.cursor = result.data.observation.cursor;
        this.send({ kind: 'observe', observation: result.data.observation });
      }
    } catch {
      if (generation === this.generation) this.fail('角色观察暂不可用，请重新连接');
    } finally {
      if (generation === this.generation && this.ready) this.timer = setTimeout(() => void this.poll(generation), 500);
    }
  }
}
