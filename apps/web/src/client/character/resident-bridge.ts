import {
  RESIDENT_FRAME_MAX_BYTES,
  RESIDENT_MAX_CHARACTERS,
  RESIDENT_PROTOCOL_VERSION,
  type ResidentBirthPackage,
  type ResidentClientMessage,
  type ResidentDocumentPath,
  type ResidentHostMessage,
  type ResidentStatus,
  type ResidentWorldBinding,
} from '@seedlands/cognition-protocol';
import type { BehaviorCapability } from '@seedlands/game-core/runtime/behavior-control-protocol';
import type { BoundCharacterControlPort } from '../authority/browser-authority-client-contract';
import { validateControllerUrl } from './controller-bridge-validation';

type Channel = {
  port: BoundCharacterControlPort;
  birth?: ResidentBirthPackage;
  receivedThrough: number;
  ready: boolean;
  polling: boolean;
};
type Pending = {
  resolve(message: ResidentHostMessage): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};
type ClientPayload = ResidentClientMessage extends infer Message
  ? Message extends ResidentClientMessage
    ? Omit<Message, 'protocolVersion' | 'sequence'>
    : never
  : never;
type RequestPayload = ClientPayload extends infer Message
  ? Message extends { requestId: string }
    ? Omit<Message, 'requestId'>
    : never
  : never;
type Options = Readonly<{
  paused(): boolean;
  onConnection(state: 'disconnected' | 'connecting' | 'ready' | 'failed', message: string): void;
  onCharacter(entityId: string, status: ResidentStatus): void;
  socket?(url: string): WebSocket;
}>;

/** One browser-initiated connection, isolated bound actor channels, no global world inspection. */
export class ResidentBridge {
  private socket: WebSocket | null = null;
  private generation = 0;
  private sequence = 0;
  private hostSequence = -1;
  private requestSequence = 0;
  private inbound = 0;
  private world: ResidentWorldBinding | null = null;
  private capabilities: readonly BehaviorCapability[] = [];
  private ready = false;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly channels = new Map<string, Channel>();
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly options: Options) {}

  connect(url: string, token: string, world: ResidentWorldBinding, capabilities: readonly BehaviorCapability[]): void {
    const address = validateControllerUrl(url);
    if (!token.trim() || token.length > 512) throw new TypeError('请填写本机服务显示的配对码');
    this.disconnect(false);
    this.world = { ...world };
    this.capabilities = capabilities;
    const generation = this.generation;
    const socket = (this.options.socket ?? ((value: string) => new WebSocket(value)))(address);
    this.socket = socket;
    this.options.onConnection('connecting', '正在连接本机思考服务…');
    this.authTimer = setTimeout(() => {
      if (generation === this.generation && !this.ready) this.fail('本机服务连接超时');
    }, 10000);
    socket.onopen = () => {
      if (generation === this.generation) this.send({ kind: 'hello', pairingToken: token, world });
    };
    socket.onmessage = (event) => {
      if (generation !== this.generation) return;
      if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).byteLength > RESIDENT_FRAME_MAX_BYTES)
        return this.fail('本机服务消息超出预算');
      let value: unknown;
      try {
        value = JSON.parse(event.data);
      } catch {
        return this.fail('本机服务消息格式无效');
      }
      if (
        !value ||
        typeof value !== 'object' ||
        !('protocolVersion' in value) ||
        value.protocolVersion !== RESIDENT_PROTOCOL_VERSION ||
        !('sequence' in value) ||
        !Number.isSafeInteger(value.sequence) ||
        (value.sequence as number) <= this.hostSequence ||
        !('kind' in value) ||
        typeof value.kind !== 'string'
      )
        return this.fail('本机服务消息的版本或顺序无效');
      const message = value as ResidentHostMessage;
      this.hostSequence = message.sequence;
      if (this.inbound >= 16) return this.fail('思考服务消息过多，伙伴继续当前生活');
      this.inbound++;
      void this.receive(message, generation)
        .catch(() => {
          if (generation === this.generation) this.fail('角色连接已失效，请重新连接');
        })
        .finally(() => {
          if (generation === this.generation) this.inbound--;
        });
    };
    socket.onerror = () => {
      if (generation === this.generation) this.fail('本机思考服务暂不可用，伙伴继续当前生活');
    };
    socket.onclose = () => {
      if (generation === this.generation) this.fail('连接已断开，伙伴继续当前生活');
    };
  }

  async bind(port: BoundCharacterControlPort, birth?: ResidentBirthPackage): Promise<void> {
    const binding = port.binding;
    if (
      !this.world ||
      binding.worldId !== this.world.worldId ||
      binding.epoch !== this.world.epoch ||
      this.channels.size >= RESIDENT_MAX_CHARACTERS ||
      [...this.channels.values()].some((entry) => entry.port.binding.entityId === binding.entityId)
    ) {
      await port.dispose();
      throw new Error('世界身份不匹配、角色已绑定或伙伴数量已达上限');
    }
    const channel: Channel = { port, birth, receivedThrough: 0, ready: false, polling: false };
    this.channels.set(binding.sessionId, channel);
    if (this.ready) await this.sendBinding(channel, this.generation);
  }

  async unbind(entityId: string): Promise<void> {
    for (const [channelId, channel] of this.channels)
      if (channel.port.binding.entityId === entityId) {
        this.channels.delete(channelId);
        this.send({ kind: 'unbind', channelId });
        await channel.port.dispose();
      }
  }

  configure(entityId: string, fallbackSeconds: number): void {
    if (!Number.isFinite(fallbackSeconds) || fallbackSeconds < 60 || fallbackSeconds > 600)
      throw new RangeError('思考兜底间隔须为1–10分钟');
    this.send({ kind: 'configure', channelId: this.channelId(entityId), fallbackSeconds });
  }

  setPaused(paused: boolean): void {
    if (!this.ready || this.paused === paused) return;
    this.paused = paused;
    this.send({ kind: 'clock', paused });
  }

  async readDocument(entityId: string, path: ResidentDocumentPath): Promise<string> {
    const result = await this.request({ kind: 'workspace-read', channelId: this.channelId(entityId), path });
    if (result.kind !== 'workspace-result' || result.path !== path || typeof result.content !== 'string')
      throw new Error('工作区文档回执无效');
    return result.content;
  }

  async generateBirth(tags: readonly string[]): Promise<ResidentBirthPackage> {
    const result = await this.request({ kind: 'birth', tags }, 120000);
    if (result.kind !== 'birth-package' || !result.birth) throw new Error('出生资料回执无效');
    return result.birth;
  }

  request(payload: RequestPayload, timeoutMs = 10000): Promise<ResidentHostMessage> {
    if (!this.ready || this.pending.size >= 16) return Promise.reject(new Error('思考服务尚未就绪或请求过多'));
    const requestId = `browser-${this.generation}-${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('思考服务请求超时'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      if (!this.send({ ...payload, requestId } as ClientPayload)) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error('思考服务连接不可用'));
      }
    });
  }

  disconnect(notify = true): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    if (this.authTimer) clearTimeout(this.authTimer);
    this.timer = this.authTimer = null;
    if (this.socket) {
      this.socket.onmessage = this.socket.onopen = this.socket.onclose = this.socket.onerror = null;
      this.socket.close();
    }
    this.socket = null;
    for (const { port } of this.channels.values()) void port.dispose().catch(() => undefined);
    this.channels.clear();
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('思考服务已断开'));
    }
    this.pending.clear();
    this.world = null;
    this.ready = false;
    this.sequence = 0;
    this.inbound = 0;
    this.hostSequence = -1;
    this.paused = false;
    if (notify) this.options.onConnection('disconnected', '按当前行为树生活 · 未连接模型');
  }

  private fail(message: string) {
    this.disconnect(false);
    this.options.onConnection('failed', message);
  }
  private channelId(entityId: string) {
    const entry = [...this.channels].find(([, channel]) => channel.port.binding.entityId === entityId);
    if (!entry) throw new Error('伙伴尚未连接思考服务');
    return entry[0];
  }

  private send(payload: ClientPayload): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    const body = JSON.stringify({ ...payload, protocolVersion: RESIDENT_PROTOCOL_VERSION, sequence: this.sequence++ });
    if (
      new TextEncoder().encode(body).byteLength > RESIDENT_FRAME_MAX_BYTES ||
      this.socket.bufferedAmount > 4 * RESIDENT_FRAME_MAX_BYTES
    ) {
      this.fail('思考连接超出传输预算，伙伴继续当前生活');
      return false;
    }
    this.socket.send(body);
    return true;
  }

  private async sendBinding(channel: Channel, generation: number) {
    const result = await channel.port.observe(0);
    if (generation !== this.generation || !this.channels.has(channel.port.binding.sessionId)) return;
    if (!result.ok || result.data.kind !== 'observation') throw new Error('绑定角色不可观察');
    this.send({
      kind: 'bind',
      binding: channel.port.binding,
      observation: result.data.observation,
      capabilities: this.capabilities,
      ...(channel.birth ? { birth: channel.birth } : {}),
    });
  }

  private async receive(message: ResidentHostMessage, generation: number): Promise<void> {
    if (message.kind === 'error') {
      const pending = message.requestId ? this.pending.get(message.requestId) : undefined;
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.requestId!);
        pending.reject(new Error(message.message));
      } else this.fail('本机服务拒绝请求，伙伴继续当前生活');
      return;
    }
    if (message.kind === 'ready') {
      if (
        this.ready ||
        !message.world ||
        !this.world ||
        message.world.worldId !== this.world.worldId ||
        message.world.timelineId !== this.world.timelineId ||
        message.world.epoch !== this.world.epoch
      )
        throw new Error('世界绑定不一致');
      if (this.authTimer) clearTimeout(this.authTimer);
      this.authTimer = null;
      this.ready = true;
      this.options.onConnection('ready', message.modelAvailable ? '思考服务已连接' : '模型不可用，伙伴继续当前生活');
      this.setPaused(this.options.paused());
      for (const channel of this.channels.values())
        void this.sendBinding(channel, generation).catch(() => {
          if (generation === this.generation) void this.unbind(channel.port.binding.entityId);
        });
      if (generation === this.generation) void this.poll(generation);
      return;
    }
    if (!this.ready) throw new Error('连接未完成握手');
    if ('requestId' in message && this.pending.has(message.requestId)) {
      const entry = this.pending.get(message.requestId)!;
      clearTimeout(entry.timer);
      this.pending.delete(message.requestId);
      entry.resolve(message);
      return;
    }
    if (!('channelId' in message)) throw new Error('未知回执');
    const channel = this.channels.get(message.channelId);
    if (!channel) return; // Removed channels cannot acquire a new body through a late response.
    if (message.kind === 'bound' || message.kind === 'status') {
      if (
        message.kind === 'bound' &&
        (!message.binding ||
          (['sessionId', 'worldId', 'epoch', 'entityId', 'incarnation', 'policyRevision'] as const).some(
            (key) => message.binding[key] !== channel.port.binding[key],
          ))
      )
        throw new Error('角色身份不一致');
      const status = message.status;
      if (
        !status ||
        !['living', 'thinking', 'compressing', 'paused', 'blocked'].includes(status.phase) ||
        !Number.isSafeInteger(status.receivedThrough) ||
        status.receivedThrough < channel.receivedThrough
      )
        throw new Error('角色状态回执无效');
      channel.receivedThrough = status.receivedThrough;
      channel.ready = true;
      this.options.onCharacter(channel.port.binding.entityId, status);
      return;
    }
    if (message.kind === 'observation-request') {
      const result = await channel.port.observe(channel.receivedThrough);
      if (generation !== this.generation || !channel.ready) return;
      if (!result.ok || result.data.kind !== 'observation') throw new Error('观察不可用');
      this.send({
        kind: 'observation-reply',
        requestId: message.requestId,
        channelId: message.channelId,
        observation: result.data.observation,
      });
      return;
    }
    if (message.kind === 'behavior-proposal' || message.kind === 'speak') {
      if (this.options.paused()) {
        this.setPaused(true);
        const observed = await channel.port.observe(channel.receivedThrough);
        if (generation === this.generation && this.channels.has(message.channelId))
          this.send({
            kind: 'receipt',
            channelId: message.channelId,
            requestId: message.requestId,
            result: {
              ok: false,
              frontier: observed.frontier,
              error: { code: 'WORLD_PAUSED', message: 'World is paused', kind: 'unavailable' },
            },
          });
        return;
      }
      const result =
        message.kind === 'behavior-proposal'
          ? await channel.port.behavior({ ...message.proposal, requestId: message.requestId })
          : await channel.port.speak(message.requestId, message.text);
      if (generation === this.generation && this.channels.has(message.channelId))
        this.send({ kind: 'receipt', channelId: message.channelId, requestId: message.requestId, result });
      return;
    }
    throw new Error('不支持的角色消息');
  }

  private poll(generation: number): void {
    if (generation !== this.generation || !this.ready) return;
    this.setPaused(this.options.paused());
    for (const [channelId, channel] of this.channels) {
      void (async () => {
        if (!channel.ready || channel.polling) return;
        channel.polling = true;
        try {
          let cursor = channel.receivedThrough;
          let through: number | undefined;
          for (let page = 0; page < 4; page++) {
            const result = await channel.port.observe(cursor, through);
            if (generation !== this.generation || !this.channels.has(channelId)) return;
            if (!result.ok || result.data.kind !== 'observation') {
              await this.unbind(channel.port.binding.entityId);
              return;
            }
            const observation = result.data.observation;
            if (!this.send({ kind: 'observe', channelId, observation })) return;
            through = observation.eventCoverage.through;
            cursor = observation.eventCoverage.returnedThrough;
            if (!observation.eventCoverage.hasMore) break;
          }
        } finally {
          channel.polling = false;
        }
      })().catch(() => {
        if (generation === this.generation) void this.unbind(channel.port.binding.entityId);
      });
    }
    if (generation === this.generation && this.ready) this.timer = setTimeout(() => void this.poll(generation), 500);
  }
}
