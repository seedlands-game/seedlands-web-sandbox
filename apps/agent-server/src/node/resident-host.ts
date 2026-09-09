import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { WebSocket } from 'ws';
import { createResidentListener, listenResident } from './resident-host-listener.js';
import type {
  HostPayload,
  ChannelState,
  Pending,
  ExportTransfer,
  ImportTransfer,
  ResidentServerOptions,
} from './resident-host-types.js';
export type { ResidentServerOptions } from './resident-host-types.js';
import {
  RESIDENT_FRAME_MAX_BYTES,
  RESIDENT_MAX_CHARACTERS,
  RESIDENT_PROTOCOL_VERSION,
  RESIDENT_TRANSFER_CHUNK_BYTES,
  RESIDENT_TRANSFER_MAX_BYTES,
  type ResidentClientMessage,
  type ResidentWorldBinding,
} from '@seedlands/cognition-protocol';
import type { BehaviorCapability } from '@seedlands/game-core/runtime/behavior-control-protocol';
import { ResidentChannel } from '../resident-channel.js';
import { validatePortableWorkspace } from '../workspace/index.js';
import {
  decodeChunk,
  object,
  observationMatches,
  parseManifest,
  sameJson,
  textId,
  validBinding,
  validBirth,
  validCapabilities,
  validWorld,
  type PortableManifest,
} from './resident-host-validation.js';
import { ResidentChannelRetirement } from './resident-channel-retirement.js';

export async function startResidentServer(options: ResidentServerOptions) {
  const pairingToken = options.pairingToken ?? randomBytes(32).toString('base64url');
  const transferTtlMs = options.transferTtlMs ?? 120_000;
  if (!Number.isSafeInteger(transferTtlMs) || transferTtlMs < 1000 || transferTtlMs > 600_000)
    throw new Error('Invalid checkpoint transfer TTL');
  const factory = options.factory ?? null;
  const sockets = new Set<WebSocket>();
  const { server, ws } = createResidentListener(options.allowedOrigins, sockets);
  const owners = new Set<() => void>();
  const retirements = new ResidentChannelRetirement();
  ws.on('connection', (socket) => {
    sockets.add(socket);
    let world: ResidentWorldBinding | null = null;
    let worldCapabilities: readonly BehaviorCapability[] | null = null;
    let sequence = 0;
    let received = -1;
    let paused = false;
    let closed = false;
    let inbound = Promise.resolve();
    const channels = new Map<string, ChannelState>();
    const pending = new Map<string, Pending>();
    const exports = new Map<string, ExportTransfer>();
    const imports = new Map<string, ImportTransfer>();
    const pruneTransfers = () => {
      const now = Date.now();
      for (const [id, transfer] of exports) if (transfer.expiresAt <= now) exports.delete(id);
      for (const [id, transfer] of imports) if (transfer.expiresAt <= now) imports.delete(id);
    };
    const send = (payload: HostPayload) => {
      if (closed || socket.readyState !== WebSocket.OPEN) return false;
      const frame = JSON.stringify({ ...payload, protocolVersion: RESIDENT_PROTOCOL_VERSION, sequence: sequence++ });
      if (Buffer.byteLength(frame) > RESIDENT_FRAME_MAX_BYTES || socket.bufferedAmount > RESIDENT_FRAME_MAX_BYTES * 4) {
        socket.close(1009, 'bounded transport exceeded');
        return false;
      }
      socket.send(frame);
      return true;
    };
    const error = (code: string, message: string, requestId?: string, channelId?: string) =>
      send({ kind: 'error', code, message, requestId, channelId });
    const reject = (message: string) => {
      error('BAD_FRAME', message);
      socket.close(1008, 'invalid resident frame');
    };
    const rejectChannel = (channelId: string, message: string, requestId?: string) => {
      const channel = channels.get(channelId);
      if (channel) {
        channels.delete(channelId);
        void retirements.retire(channel.resident).catch(() => undefined);
      }
      error('BAD_CHANNEL_FRAME', message, requestId, channelId);
    };
    const request = (channelId: string, payload: Record<string, unknown>): Promise<ResidentClientMessage> => {
      const ownPending = [...pending.values()].filter((entry) => entry.channelId === channelId).length;
      if (closed || pending.size >= 16 || ownPending >= 8)
        return Promise.reject(new Error('world request queue unavailable'));
      const requestId = randomBytes(16).toString('hex');
      return new Promise((resolve, rejectRequest) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          rejectRequest(new Error('world receipt deadline exceeded'));
        }, 10_000);
        pending.set(requestId, { channelId, resolve, reject: rejectRequest, timer });
        send({ ...payload, channelId, requestId } as HostPayload);
      });
    };
    const authTimer = setTimeout(() => reject('pairing deadline exceeded'), 5000);
    const dispose = () => {
      if (closed) return;
      closed = true;
      clearTimeout(authTimer);
      for (const channel of channels.values()) void retirements.retire(channel.resident).catch(() => undefined);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('world disconnected'));
      }
      channels.clear();
      pending.clear();
      exports.clear();
      imports.clear();
      sockets.delete(socket);
      owners.delete(dispose);
    };
    owners.add(dispose);

    const receive = async (message: ResidentClientMessage) => {
      pruneTransfers();
      if (!world) {
        if (
          message.kind !== 'hello' ||
          message.sequence !== 0 ||
          !validWorld(message.world) ||
          !validCapabilities(message.capabilities) ||
          typeof message.pairingToken !== 'string' ||
          message.pairingToken.length > 512
        )
          return reject('pairing required');
        const token = Buffer.from(message.pairingToken);
        const expected = Buffer.from(pairingToken);
        if (token.length !== expected.length || !timingSafeEqual(token, expected)) return reject('pairing rejected');
        world = { ...message.world };
        worldCapabilities = structuredClone(message.capabilities);
        clearTimeout(authTimer);
        send({ kind: 'ready', world, modelAvailable: Boolean(options.flash && options.pro) });
        return;
      }
      if (message.kind === 'hello') return reject('world identity is immutable');
      if (message.kind === 'clock') {
        if (typeof message.paused !== 'boolean') return reject('invalid clock');
        paused = message.paused;
        for (const channel of channels.values()) channel.resident.setPaused(paused);
        return;
      }
      if (message.kind === 'birth') {
        if (!factory || !textId(message.requestId) || !Array.isArray(message.tags))
          return error('FACTORY_UNAVAILABLE', '出生服务暂不可用', message.requestId);
        try {
          const birth = await factory.generate(world, message.requestId, message.tags, worldCapabilities);
          if (!validBirth(birth)) throw new Error('generated birth failed validation');
          send({ kind: 'birth-package', requestId: message.requestId, birth });
        } catch {
          error('BIRTH_REJECTED', '出生资料生成失败', message.requestId);
        }
        return;
      }
      if (message.kind === 'checkpoint-export') {
        if (!paused || !textId(message.requestId))
          return error('CHECKPOINT_UNAVAILABLE', '请先暂停世界', message.requestId);
        await Promise.all([...channels.values()].map((channel) => channel.resident.flush()));
        const bindings = await options.workspace.listBindings(world.worldId, world.timelineId);
        const manifest: PortableManifest = {
          format: 'seedlands-resident-cognition',
          version: 1,
          source: world,
          workspaces: await Promise.all(bindings.map((binding) => options.workspace.exportPortable(binding))),
        };
        const bytes = Buffer.from(JSON.stringify(manifest), 'utf8');
        if (bytes.byteLength > RESIDENT_TRANSFER_MAX_BYTES)
          return error('CHECKPOINT_TOO_LARGE', '认知存档超过64MiB上限', message.requestId);
        const transferId = randomBytes(16).toString('hex');
        const chunks = Array.from({ length: Math.ceil(bytes.byteLength / RESIDENT_TRANSFER_CHUNK_BYTES) }, (_, index) =>
          bytes
            .subarray(index * RESIDENT_TRANSFER_CHUNK_BYTES, (index + 1) * RESIDENT_TRANSFER_CHUNK_BYTES)
            .toString('base64'),
        );
        if (exports.size >= 4) exports.delete(exports.keys().next().value!);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        exports.set(transferId, {
          expiresAt: Date.now() + transferTtlMs,
          chunks,
          byteLength: bytes.byteLength,
          sha256,
        });
        send({
          kind: 'checkpoint-ready',
          requestId: message.requestId,
          transferId,
          parts: chunks.length,
          byteLength: bytes.byteLength,
          sha256,
        });
        return;
      }
      if (message.kind === 'checkpoint-read') {
        const transfer = exports.get(message.transferId);
        if (
          !transfer ||
          !Number.isSafeInteger(message.part) ||
          message.part < 0 ||
          message.part >= transfer.chunks.length
        )
          return error('CHECKPOINT_UNAVAILABLE', '认知存档分块已失效', message.requestId);
        send({
          kind: 'checkpoint-part',
          requestId: message.requestId,
          transferId: message.transferId,
          part: message.part,
          content: transfer.chunks[message.part]!,
        });
        return;
      }
      if (message.kind === 'checkpoint-import') {
        if (!paused || channels.size !== 0)
          return error('CHECKPOINT_IMPORT_REJECTED', '导入只允许在新时间线绑定角色之前执行', message.requestId);
        const bytes = decodeChunk(message.content);
        if (
          !textId(message.requestId) ||
          !textId(message.transferId) ||
          !Number.isSafeInteger(message.part) ||
          !Number.isSafeInteger(message.parts) ||
          message.part < 0 ||
          message.parts < 1 ||
          message.part >= message.parts ||
          message.parts > Math.ceil(RESIDENT_TRANSFER_MAX_BYTES / RESIDENT_TRANSFER_CHUNK_BYTES) ||
          !/^[a-f0-9]{64}$/u.test(message.sha256) ||
          !bytes
        )
          return error('CHECKPOINT_IMPORT_REJECTED', '认知存档分块无效', message.requestId);
        let transfer = imports.get(message.transferId);
        if (!transfer) {
          if (imports.size >= 4) imports.delete(imports.keys().next().value!);
          transfer = {
            expiresAt: Date.now() + transferTtlMs,
            parts: message.parts,
            sha256: message.sha256,
            chunks: new Map(),
            byteLength: 0,
          };
          imports.set(message.transferId, transfer);
        }
        if (transfer.parts !== message.parts || transfer.sha256 !== message.sha256)
          return error('CHECKPOINT_IMPORT_REJECTED', '认知存档分块清单冲突', message.requestId);
        const prior = transfer.chunks.get(message.part);
        if (prior && !prior.equals(bytes))
          return error('CHECKPOINT_IMPORT_REJECTED', '认知存档分块重复冲突', message.requestId);
        if (!prior) {
          transfer.chunks.set(message.part, bytes);
          transfer.byteLength += bytes.byteLength;
        }
        if (transfer.byteLength > RESIDENT_TRANSFER_MAX_BYTES) {
          imports.delete(message.transferId);
          return error('CHECKPOINT_TOO_LARGE', '认知存档超过64MiB上限', message.requestId);
        }
        if (transfer.chunks.size < transfer.parts) {
          send({
            kind: 'checkpoint-imported',
            requestId: message.requestId,
            transferId: message.transferId,
            complete: false,
          });
          return;
        }
        try {
          const payload = Buffer.concat(
            Array.from({ length: transfer.parts }, (_, index) => transfer.chunks.get(index)!),
          );
          if (createHash('sha256').update(payload).digest('hex') !== transfer.sha256)
            throw new Error('checkpoint digest mismatch');
          const manifest = parseManifest(payload, world);
          await Promise.all(manifest.workspaces.map((portable) => validatePortableWorkspace(portable)));
          const targetScope = { worldId: world.worldId, timelineId: world.timelineId };
          await options.workspace.importPortableBatch(
            targetScope,
            manifest.workspaces.map((portable) => ({
              target: {
                ...targetScope,
                actorId: portable.binding.actorId,
                incarnation: portable.binding.incarnation,
              },
              portable,
            })),
          );
          imports.delete(message.transferId);
          send({
            kind: 'checkpoint-imported',
            requestId: message.requestId,
            transferId: message.transferId,
            complete: true,
          });
        } catch {
          imports.delete(message.transferId);
          error('CHECKPOINT_IMPORT_REJECTED', '认知存档校验或导入失败', message.requestId);
        }
        return;
      }
      if (message.kind === 'bind') {
        if (
          channels.size >= RESIDENT_MAX_CHARACTERS ||
          channels.has(message.binding?.sessionId) ||
          !validBinding(message.binding, world) ||
          [...channels.values()].some((entry) => entry.binding.entityId === message.binding.entityId) ||
          !observationMatches(message.observation, message.binding) ||
          !validCapabilities(message.capabilities) ||
          !sameJson(message.capabilities, worldCapabilities) ||
          (message.birth !== undefined && !validBirth(message.birth, message.observation))
        )
          return reject('invalid resident binding');
        const binding = message.binding;
        const channelId = binding.sessionId;
        const identity = {
          worldId: world.worldId,
          timelineId: world.timelineId,
          actorId: binding.entityId,
          incarnation: binding.incarnation,
        };
        await retirements.wait(identity);
        if (closed) return;
        const ask = async (payload: Record<string, unknown>) => {
          const result = await request(channelId, payload);
          if (closed || channels.get(channelId)?.binding !== binding) throw new Error('resident binding expired');
          return result;
        };
        const resident = new ResidentChannel({
          ...options,
          world,
          binding,
          observation: message.observation,
          birth: message.birth,
          capabilities: message.capabilities,
          paused,
          worldPort: {
            observe: async () => {
              const result = await ask({ kind: 'observation-request' });
              if (result.kind !== 'observation-reply' || !observationMatches(result.observation, binding))
                throw new Error('invalid observation receipt');
              await resident.receive(result.observation);
              return result.observation;
            },
            proposeBehavior: async (candidate) => {
              const result = await ask({ kind: 'behavior-proposal', proposal: candidate });
              if (result.kind !== 'receipt') throw new Error('invalid behavior receipt');
              return result.result;
            },
            speak: async ({ requestId: effectRequestId, text }) => {
              if (!textId(effectRequestId) || effectRequestId.length > 128)
                throw new Error('invalid speech effect request id');
              const result = await ask({ kind: 'speak', effectRequestId, text });
              if (result.kind !== 'receipt') throw new Error('invalid speech receipt');
              return result.result;
            },
          },
          status: (status) => {
            if (channels.get(channelId)?.binding === binding && channels.get(channelId)?.ready)
              send({ kind: 'status', channelId, status });
          },
        });
        const channel = { resident, binding, ready: false };
        channels.set(channelId, channel);
        try {
          const status = await resident.initialize();
          if (closed || channels.get(channelId) !== channel) {
            await retirements.retire(resident);
            return;
          }
          channel.ready = true;
          send({ kind: 'bound', channelId, binding, status });
        } catch {
          channels.delete(channelId);
          await retirements.retire(resident).catch(() => undefined);
          error('WORKSPACE_UNAVAILABLE', '角色工作区暂不可用', undefined, channelId);
        }
        return;
      }
      if (!('channelId' in message) || !textId(message.channelId))
        return error('UNSUPPORTED_REQUEST', '此请求尚不可用', 'requestId' in message ? message.requestId : undefined);
      const channel = channels.get(message.channelId);
      if (!channel)
        return error(
          'CHANNEL_UNAVAILABLE',
          '角色连接已失效',
          'requestId' in message ? message.requestId : undefined,
          message.channelId,
        );
      if (message.kind === 'unbind') {
        channels.delete(message.channelId);
        await retirements.retire(channel.resident);
        for (const [id, entry] of pending)
          if (entry.channelId === message.channelId) {
            clearTimeout(entry.timer);
            pending.delete(id);
            entry.reject(new Error('resident unbound'));
          }
        return;
      }
      if (!channel.ready) return error('CHANNEL_NOT_READY', '角色工作区正在准备', undefined, message.channelId);
      if (message.kind === 'receipt' || message.kind === 'observation-reply') {
        const entry = pending.get(message.requestId);
        if (!entry || entry.channelId !== message.channelId)
          return error('STALE_RECEIPT', '回执不属于当前角色请求', message.requestId, message.channelId);
        if (
          (message.kind === 'receipt' && (!object(message.result) || typeof message.result.ok !== 'boolean')) ||
          (message.kind === 'observation-reply' && !observationMatches(message.observation, channel.binding))
        ) {
          clearTimeout(entry.timer);
          pending.delete(message.requestId);
          entry.reject(new Error('invalid world response'));
          rejectChannel(message.channelId, 'invalid world response', message.requestId);
          return;
        }
        clearTimeout(entry.timer);
        pending.delete(message.requestId);
        entry.resolve(message);
        return;
      }
      if (message.kind === 'observe') {
        if (!observationMatches(message.observation, channel.binding)) {
          rejectChannel(message.channelId, 'invalid observation');
          return;
        }
        await channel.resident.receive(message.observation);
        return;
      }
      if (message.kind === 'configure') {
        channel.resident.configure(message.fallbackSeconds);
        return;
      }
      if (message.kind === 'workspace-read') {
        if (!textId(message.requestId)) return rejectChannel(message.channelId, 'invalid workspace request');
        const document = await options.workspace.readFile(channel.resident.identity, message.path, 'resident');
        send({
          kind: 'workspace-result',
          channelId: message.channelId,
          requestId: message.requestId,
          path: message.path,
          content: document.content,
        });
        return;
      }
      return;
    };

    socket.on('message', (data, binary) => {
      if (closed) return;
      if (binary || Buffer.byteLength(data.toString()) > RESIDENT_FRAME_MAX_BYTES)
        return reject('binary or oversized frame');
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return reject('invalid JSON');
      }
      if (
        !object(parsed) ||
        parsed.protocolVersion !== RESIDENT_PROTOCOL_VERSION ||
        !Number.isSafeInteger(parsed.sequence) ||
        (parsed.sequence as number) <= received ||
        typeof parsed.kind !== 'string'
      )
        return reject('invalid version or sequence');
      received = parsed.sequence as number;
      const run = async (): Promise<void> => {
        await receive(parsed as ResidentClientMessage);
      };
      const failed = () => {
        error(
          'REQUEST_FAILED',
          '本次请求失败，当前生活继续',
          textId(parsed.requestId) ? parsed.requestId : undefined,
          textId(parsed.channelId) ? parsed.channelId : undefined,
        );
      };
      // World replies must not wait behind an operation whose model tool is awaiting that reply.
      if (parsed.kind === 'receipt' || parsed.kind === 'observation-reply') void run().catch(failed);
      else inbound = inbound.then(run).catch(failed);
    });
    socket.once('close', dispose);
    socket.once('error', dispose);
  });
  const url = await listenResident(server, options.port ?? 0);
  return {
    url,
    pairingToken,
    close: async () => {
      for (const dispose of owners) dispose();
      for (const socket of ws.clients) socket.terminate();
      await retirements.drain();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export const ResidentServerWebSocketClient = WebSocket;
