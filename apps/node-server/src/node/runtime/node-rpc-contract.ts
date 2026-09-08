import type { Transferable as NodeTransferable } from 'node:worker_threads';

/** Authority 与 Persistence 专用 MessagePort 的通用、有界 RPC 合同。 */
export type NodeRpcPortEvent = 'message' | 'close' | 'messageerror';

export type NodeRpcPort = Readonly<{
  postMessage(value: unknown, transferList?: readonly NodeTransferable[]): void;
  on(event: NodeRpcPortEvent, listener: (value?: unknown) => void): unknown;
  off(event: NodeRpcPortEvent, listener: (value?: unknown) => void): unknown;
  close(): void;
}>;

export type NodeRpcPayload = Readonly<{ value: unknown; bytes: number }>;
export type NodeRpcPayloadValidator = (kind: string, value: unknown) => NodeRpcPayload;

export type NodeRpcLimits = Readonly<{
  maxRequests: number;
  maxQueuedBytes: number;
  maxInFlightBytes: number;
  maxResponseBytes: number;
  maxReservedResponseBytes: number;
  maxConcurrentRequests: number;
}>;

export type NodeRpcRequest = Readonly<{
  type: 'request';
  epoch: string;
  generation: number;
  requestId: number;
  kind: string;
  payload: unknown;
  payloadBytes: number;
}>;

export type NodeRpcResponse =
  | Readonly<{
      type: 'response';
      epoch: string;
      generation: number;
      requestId: number;
      kind: string;
      ok: true;
      payload: unknown;
      payloadBytes: number;
    }>
  | Readonly<{
      type: 'response';
      epoch: string;
      generation: number;
      requestId: number;
      kind: string;
      ok: false;
      error: string;
      payloadBytes: 0;
    }>;

export type NodeRpcResponseAck = Readonly<{
  type: 'response-ack';
  epoch: string;
  generation: number;
  requestId: number;
  kind: string;
  payloadBytes: number;
}>;

export type NodeRpcClose = Readonly<{
  type: 'close';
  epoch: string;
  generation: number;
  reason?: string;
}>;

export type NodeRpcWireMessage = NodeRpcRequest | NodeRpcResponse | NodeRpcResponseAck | NodeRpcClose;

export type NodeRpcDiagnostics = Readonly<{
  accepted: number;
  rejected: number;
  pending: number;
  queuedBytes: number;
  inFlightBytes: number;
  responseBytes: number;
  staleMessages: number;
  nextRequestId: number;
  closed: boolean;
  activeHandlers: number;
}>;

export type NodeRpcClientTerminalCause =
  'local-close' | 'peer-close' | 'transport-close' | 'protocol-error' | 'request-cancel';

export type NodeRpcClientTerminal = Readonly<{
  cause: NodeRpcClientTerminalCause;
  error: Error;
}>;

export class NodeRpcProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NodeRpcProtocolError';
  }
}

export class NodeRpcClosedError extends Error {
  constructor(message = 'Node RPC port is closed.') {
    super(message);
    this.name = 'NodeRpcClosedError';
  }
}

export type NodeRpcRequestOptions = Readonly<{
  transfer?: readonly NodeTransferable[];
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export type NodeRpcClient = Readonly<{
  request(kind: string, payload: unknown, options?: NodeRpcRequestOptions): Promise<unknown>;
  diagnostics(): NodeRpcDiagnostics;
  whenClosed(): Promise<NodeRpcClientTerminal>;
  close(error?: Error): void;
}>;

export type NodeRpcHandlerRequest = Readonly<{
  kind: string;
  payload: unknown;
  requestId: number;
  signal: AbortSignal;
}>;

export type NodeRpcHandlerResult = Readonly<{
  payload: unknown;
  transfer?: readonly NodeTransferable[];
}>;

export type NodeRpcServer = Readonly<{
  diagnostics(): NodeRpcDiagnostics;
  whenIdle(): Promise<void>;
  close(error?: Error): void;
}>;

export type NodeRpcClientOptions = Readonly<{
  port: NodeRpcPort;
  epoch: string;
  generation: number;
  limits: NodeRpcLimits;
  validateRequest: NodeRpcPayloadValidator;
  validateResponse: NodeRpcPayloadValidator;
}>;

export type NodeRpcServerOptions = Readonly<{
  port: NodeRpcPort;
  epoch: string;
  generation: number;
  limits: NodeRpcLimits;
  validateRequest: NodeRpcPayloadValidator;
  validateResponse: NodeRpcPayloadValidator;
  reserveResponseBytes?: (kind: string, payloadBytes: number) => number;
  /** 同组请求不能越过仍在队列中的前项；已派发请求可并发完成。 */
  dispatchOrderKey?: (kind: string) => string | undefined;
  handle(request: NodeRpcHandlerRequest): Promise<NodeRpcHandlerResult> | NodeRpcHandlerResult;
}>;

export function assertNodeRpcLimits(limits: NodeRpcLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`Invalid Node RPC limit: ${name}`);
  }
  if (limits.maxConcurrentRequests > limits.maxRequests)
    throw new RangeError('Node RPC maxConcurrentRequests must not exceed maxRequests.');
  if (limits.maxReservedResponseBytes < limits.maxResponseBytes)
    throw new RangeError('Node RPC maxReservedResponseBytes must cover one maxResponseBytes reply.');
}

export function assertNodeRpcIdentity(epoch: string, generation: number): void {
  if (!epoch.trim()) throw new TypeError('Node RPC epoch must not be empty.');
  if (!Number.isSafeInteger(generation) || generation < 0) throw new RangeError('Node RPC generation is invalid.');
}

export function validateNodeRpcPayload(payload: NodeRpcPayload, label: string): NodeRpcPayload {
  if (!Number.isSafeInteger(payload.bytes) || payload.bytes < 0)
    throw new NodeRpcProtocolError(`${label} byte measurement is invalid.`);
  return payload;
}

export function isNodeRpcRequest(value: unknown): value is NodeRpcRequest {
  const message = value as Partial<NodeRpcRequest>;
  return message?.type === 'request';
}

export function isNodeRpcResponse(value: unknown): value is NodeRpcResponse {
  const message = value as Partial<NodeRpcResponse>;
  return message?.type === 'response';
}

export function isNodeRpcResponseAck(value: unknown): value is NodeRpcResponseAck {
  const message = value as Partial<NodeRpcResponseAck>;
  return message?.type === 'response-ack';
}

export function isNodeRpcClose(value: unknown): value is NodeRpcClose {
  const message = value as Partial<NodeRpcClose>;
  return message?.type === 'close';
}

export { createNodeRpcClient } from './node-rpc-client';
export { attachNodeRpcServer } from './node-rpc-server';
