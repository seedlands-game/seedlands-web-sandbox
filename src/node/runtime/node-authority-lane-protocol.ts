import type { NodeRpcPayload } from './node-rpc-contract';
import type { NodeAuthorityPublication } from './node-authority-lane';
import { measureNodeRpcBytes } from './node-rpc-bytes';
import { Buffer } from 'node:buffer';

const U32_BYTES = 4;
const NUMBER_BYTES = 8;
const REFERENCE_BYTES = 1 + U32_BYTES;
export const MAX_AUTHORITY_PUBLICATION_BYTES = 16 * 1_024 * 1_024;

export const AUTHORITY_OPERATION_KINDS = [
  'authority-receive-input',
  'authority-perform-action',
  'authority-request-chunk',
  'authority-set-interest-radius',
  'authority-request-checkpoint',
  'authority-wait-for-idle',
  'authority-read-diagnostics',
  'authority-stop',
] as const;

export type AuthorityOperationKind = (typeof AUTHORITY_OPERATION_KINDS)[number];

export type AuthorityPublicationMessage = Readonly<{
  type: 'publication';
  epoch: string;
  sequence: number;
  publication: NodeAuthorityPublication;
}>;

export type AuthorityPublicationAck = Readonly<{
  type: 'publication-ack';
  epoch: string;
  sequence: number;
}>;

const SEQUENCE_DECISIONS = new Set([
  'accepted',
  'invalid',
  'duplicate',
  'out-of-order',
  'late',
  'target-out-of-order',
  'too-far-ahead',
  'capacity',
  'wrong-epoch',
  'wrong-stream',
]);

function measured(value: unknown): NodeRpcPayload {
  return { value, bytes: measureNodeRpcBytes(value) };
}

/**
 * Publication 保留结构化克隆的别名关系：同一对象第二次出现只记固定引用成本，
 * 但循环图没有公开语义，直接拒绝。它不能替代控制 RPC 的无共享 DTO 计量规则。
 */
export function measureAuthorityPublicationBytes(value: unknown): number {
  const seen = new WeakSet<object>();
  const visiting = new WeakSet<object>();
  const textBytes = (text: string) => Buffer.byteLength(text, 'utf8');
  const visit = (candidate: unknown): number => {
    if (candidate === null || candidate === undefined) return 1;
    if (typeof candidate === 'boolean') return 1;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new TypeError('Authority publication 不能包含非有限数字。');
      return 1 + NUMBER_BYTES;
    }
    if (typeof candidate === 'bigint') return 1 + U32_BYTES + textBytes(candidate.toString(10));
    if (typeof candidate === 'string') return 1 + U32_BYTES + textBytes(candidate);
    if (typeof candidate === 'symbol' || typeof candidate === 'function')
      throw new TypeError('Authority publication 包含不可传输值。');
    if (!candidate || typeof candidate !== 'object') throw new TypeError('Authority publication 类型不受支持。');
    if (visiting.has(candidate)) throw new TypeError('Authority publication 不支持循环引用。');
    if (seen.has(candidate)) return REFERENCE_BYTES;
    seen.add(candidate);
    visiting.add(candidate);
    try {
      if (candidate instanceof ArrayBuffer) return 1 + U32_BYTES + candidate.byteLength;
      if (ArrayBuffer.isView(candidate)) {
        const name = Object.getPrototypeOf(candidate).constructor.name;
        return 1 + U32_BYTES + textBytes(name) + U32_BYTES + candidate.byteOffset + U32_BYTES + visit(candidate.buffer);
      }
      if (Array.isArray(candidate)) return 1 + U32_BYTES + candidate.reduce((total, entry) => total + visit(entry), 0);
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null)
        throw new TypeError('Authority publication 必须是普通对象。');
      return Object.keys(candidate as Record<string, unknown>)
        .sort()
        .reduce(
          (total, key) => total + U32_BYTES + textBytes(key) + visit((candidate as Record<string, unknown>)[key]),
          1 + U32_BYTES,
        );
    } finally {
      visiting.delete(candidate);
    }
  };
  const bytes = visit(value);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('Authority publication 字节计量溢出。');
  return bytes;
}

function record(value: unknown, label = 'Authority RPC payload'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} 必须是对象。`);
  return value as Record<string, unknown>;
}

function only(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function action(value: unknown): void {
  const candidate = record(value);
  const number = (key: string) => Number.isSafeInteger(candidate[key]) && (candidate[key] as number) >= 0;
  const text = (key: string) =>
    typeof candidate[key] === 'string' &&
    (candidate[key] as string).length > 0 &&
    (candidate[key] as string).length <= 256;
  const position =
    Array.isArray(candidate.position) && candidate.position.length === 3 && candidate.position.every(Number.isFinite);
  if ((candidate.type === 'cancel-break' || candidate.type === 'respawn') && only(candidate, ['type'])) return;
  if (
    (candidate.type === 'select-hotbar' || candidate.type === 'use-inventory') &&
    number('slot') &&
    only(candidate, ['type', 'slot'])
  )
    return;
  if (
    (candidate.type === 'craft' && text('recipeId') && only(candidate, ['type', 'recipeId'])) ||
    (candidate.type === 'attack' && text('targetId') && only(candidate, ['type', 'targetId']))
  )
    return;
  if (
    (candidate.type === 'begin-break' || candidate.type === 'place') &&
    position &&
    only(candidate, ['type', 'position'])
  )
    return;
  if (
    candidate.type === 'move-inventory' &&
    number('source') &&
    number('target') &&
    only(candidate, ['type', 'source', 'target'])
  )
    return;
  throw new TypeError('Authority action 无效。');
}

function input(value: unknown): void {
  const candidate = record(value);
  const state = record(candidate.state);
  const edges = record(candidate.edges);
  if (
    candidate.kind !== 'input' ||
    !Number.isSafeInteger(candidate.protocolVersion) ||
    typeof candidate.epoch !== 'string' ||
    typeof candidate.stream !== 'string' ||
    !Number.isSafeInteger(candidate.sequence) ||
    !Number.isSafeInteger(candidate.targetPhysicsTick) ||
    !Number.isFinite(candidate.issuedAtMs) ||
    !Number.isFinite(state.moveX) ||
    !Number.isFinite(state.moveZ) ||
    ![-1, 0, 1].includes(state.verticalIntent as number) ||
    typeof state.jumpHeld !== 'boolean' ||
    typeof edges.jumpPressed !== 'boolean'
  )
    throw new TypeError('Authority input 无效。');
  if (
    !only(candidate, [
      'kind',
      'protocolVersion',
      'epoch',
      'stream',
      'sequence',
      'targetPhysicsTick',
      'issuedAtMs',
      'state',
      'edges',
    ]) ||
    !only(state, ['moveX', 'moveZ', 'verticalIntent', 'jumpHeld']) ||
    !only(edges, ['jumpPressed'])
  )
    throw new TypeError('Authority input 不能携带额外字段。');
}

function receipt(value: unknown): void {
  const candidate = record(value, 'Authority action receipt');
  if (!nonNegativeInteger(candidate.commitSequence))
    throw new TypeError('Authority action receipt commitSequence 无效。');
  if (candidate.status === 'executed') {
    if (!Object.hasOwn(candidate, 'result') || !only(candidate, ['status', 'commitSequence', 'result']))
      throw new TypeError('Authority action receipt 无效。');
    return;
  }
  if (
    (candidate.status === 'conflict' || candidate.status === 'expired' || candidate.status === 'capacity') &&
    only(candidate, ['status', 'commitSequence'])
  )
    return;
  throw new TypeError('Authority action receipt 无效。');
}

function checkpoint(value: unknown): void {
  const candidate = record(value, 'Authority checkpoint');
  if (
    !Array.isArray(candidate.savedChunks) ||
    candidate.savedChunks.some((key) => typeof key !== 'string') ||
    typeof candidate.gameplaySaved !== 'boolean' ||
    !nonNegativeInteger(candidate.commitSequence) ||
    (candidate.storageBytes !== undefined &&
      (typeof candidate.storageBytes !== 'number' ||
        !Number.isFinite(candidate.storageBytes) ||
        candidate.storageBytes < 0)) ||
    !only(candidate, ['savedChunks', 'gameplaySaved', 'commitSequence', 'storageBytes'])
  )
    throw new TypeError('Authority checkpoint 回复无效。');
}

function stopResult(value: unknown): void {
  const candidate = record(value, 'Authority stop');
  if (
    candidate.status !== 'stopped' ||
    !nonNegativeInteger(candidate.durableCommitSequence) ||
    !only(candidate, ['status', 'durableCommitSequence'])
  )
    throw new TypeError('Authority stop 回复无效。');
}

function diagnostics(value: unknown): void {
  const candidate = record(value, 'Authority diagnostics');
  if (
    !['starting', 'running', 'stopping', 'stopped', 'failed'].includes(candidate.state as string) ||
    typeof candidate.epoch !== 'string' ||
    !candidate.epoch ||
    !nonNegativeInteger(candidate.wakeCount) ||
    (candidate.failure !== null && typeof candidate.failure !== 'string') ||
    !only(candidate, ['state', 'epoch', 'wakeCount', 'failure', 'host', 'compute'])
  )
    throw new TypeError('Authority diagnostics 回复无效。');
  record(candidate.host, 'Authority diagnostics host');
  const compute = record(candidate.compute, 'Authority diagnostics compute');
  if (!only(compute, ['general', 'fluid', 'logic'])) throw new TypeError('Authority diagnostics compute 无效。');
  record(compute.general, 'Authority diagnostics general');
  record(compute.fluid, 'Authority diagnostics fluid');
  record(compute.logic, 'Authority diagnostics logic');
}

export function validateAuthorityRequestPayload(kind: string, value: unknown): NodeRpcPayload {
  if (!(AUTHORITY_OPERATION_KINDS as readonly string[]).includes(kind))
    throw new TypeError(`Authority lane 不支持 RPC：${kind}`);
  const request = record(value);
  if (kind === 'authority-receive-input') {
    if (!only(request, ['input'])) throw new TypeError('Authority input 请求无效。');
    input(request.input);
  } else if (kind === 'authority-perform-action') {
    if (!only(request, ['action', 'sequence'])) throw new TypeError('Authority action 请求无效。');
    action(request.action);
    if (!nonNegativeInteger(request.sequence)) throw new TypeError('Authority action sequence 无效。');
  } else if (kind === 'authority-request-chunk') {
    if (!only(request, ['key'])) throw new TypeError('Authority Chunk 请求无效。');
    if (typeof request.key !== 'string' || !request.key) throw new TypeError('Authority Chunk key 无效。');
  } else if (kind === 'authority-set-interest-radius') {
    if (!only(request, ['radius']) || (request.radius !== 1 && request.radius !== 2 && request.radius !== 3))
      throw new TypeError('Authority 半径无效。');
  } else if (!only(request, [])) throw new TypeError('Authority 空请求无效。');
  return measured(value);
}

export function validateAuthorityResponsePayload(kind: string, value: unknown): NodeRpcPayload {
  if (!(AUTHORITY_OPERATION_KINDS as readonly string[]).includes(kind))
    throw new TypeError(`Authority lane 不支持 RPC：${kind}`);
  if (kind === 'authority-receive-input') {
    if (typeof value !== 'string' || !SEQUENCE_DECISIONS.has(value)) throw new TypeError('Authority input 回复无效。');
  } else if (kind === 'authority-perform-action') receipt(value);
  else if (kind === 'authority-request-chunk') {
    if (typeof value !== 'boolean') throw new TypeError('Authority Chunk 回复无效。');
  } else if (kind === 'authority-set-interest-radius' || kind === 'authority-wait-for-idle') {
    if (!only(record(value, 'Authority empty response'), [])) throw new TypeError('Authority 空回复无效。');
  } else if (kind === 'authority-request-checkpoint') checkpoint(value);
  else if (kind === 'authority-read-diagnostics') diagnostics(value);
  else stopResult(value);
  return measured(value);
}

export function validateAuthorityPublicationMessage(value: unknown, epoch: string): AuthorityPublicationMessage {
  const message = record(value, 'Authority publication') as Partial<AuthorityPublicationMessage>;
  if (
    message.type !== 'publication' ||
    message.epoch !== epoch ||
    !nonNegativeInteger(message.sequence) ||
    !message.publication
  )
    throw new TypeError('Authority publication epoch 或序号无效。');
  const publication = record(message.publication, 'Authority publication payload');
  if (
    !only(publication, ['snapshot', 'gameplay', 'commits', 'resyncRequired']) ||
    !publication.snapshot ||
    !Array.isArray(publication.commits) ||
    (publication.gameplay !== undefined && (!publication.gameplay || typeof publication.gameplay !== 'object')) ||
    (publication.resyncRequired !== undefined && publication.resyncRequired !== true)
  )
    throw new TypeError('Authority publication payload 无效。');
  record(publication.snapshot, 'Authority publication snapshot');
  if (measureAuthorityPublicationBytes(message) > MAX_AUTHORITY_PUBLICATION_BYTES)
    throw new RangeError('Authority publication 超过字节预算。');
  return message as AuthorityPublicationMessage;
}

export function validateAuthorityPublicationAck(value: unknown, epoch: string): AuthorityPublicationAck | null {
  const ack = value as Partial<AuthorityPublicationAck>;
  if (
    ack?.type !== 'publication-ack' ||
    ack.epoch !== epoch ||
    !Number.isSafeInteger(ack.sequence) ||
    ack.sequence! < 0
  )
    return null;
  return ack as AuthorityPublicationAck;
}
