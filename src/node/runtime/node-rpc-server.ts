import {
  NodeRpcClosedError,
  NodeRpcProtocolError,
  assertNodeRpcIdentity,
  assertNodeRpcLimits,
  isNodeRpcClose,
  isNodeRpcRequest,
  isNodeRpcResponseAck,
  validateNodeRpcPayload,
  type NodeRpcDiagnostics,
  type NodeRpcHandlerResult,
  type NodeRpcRequest,
  type NodeRpcServer,
  type NodeRpcServerOptions,
} from './node-rpc-contract';

type QueuedRequest = Readonly<{ request: NodeRpcRequest; payload: unknown; reserveBytes: number; orderKey?: string }>;
type InFlightRequest = QueuedRequest & Readonly<{ controller: AbortController }>;
type RetainedResponse = Readonly<{ request: NodeRpcRequest; reserveBytes: number; payloadBytes: number }>;

function errorMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  return raw.slice(0, 1_024) || 'Node RPC request failed.';
}

function validRequestIdentity(request: NodeRpcRequest, options: NodeRpcServerOptions): boolean {
  return (
    request.epoch === options.epoch &&
    request.generation === options.generation &&
    Number.isSafeInteger(request.requestId) &&
    request.requestId >= 0 &&
    typeof request.kind === 'string' &&
    request.kind.trim().length > 0 &&
    Number.isSafeInteger(request.payloadBytes) &&
    request.payloadBytes >= 0
  );
}

/** Server keeps a response reservation until the client validates and acknowledges it. */
export function attachNodeRpcServer(options: NodeRpcServerOptions): NodeRpcServer {
  assertNodeRpcIdentity(options.epoch, options.generation);
  assertNodeRpcLimits(options.limits);
  let closed = false;
  let accepted = 0;
  let rejected = 0;
  let staleMessages = 0;
  let lastRequestId = -1;
  let queuedBytes = 0;
  let inFlightBytes = 0;
  let responseBytes = 0;
  const queue: QueuedRequest[] = [];
  const inFlight = new Map<number, InFlightRequest>();
  const retained = new Map<number, RetainedResponse>();
  const idleWaiters = new Set<() => void>();

  const onMessage = (value?: unknown) => {
    if (isNodeRpcClose(value)) {
      if (value.epoch === options.epoch && value.generation === options.generation)
        close(new NodeRpcClosedError(value.reason));
      else staleMessages += 1;
      return;
    }
    if (isNodeRpcResponseAck(value)) {
      acknowledge(value);
      return;
    }
    if (!isNodeRpcRequest(value)) {
      staleMessages += 1;
      return;
    }
    receive(value);
  };
  const onClose = () => close(new NodeRpcClosedError());
  const onError = () => close(new NodeRpcClosedError('Node RPC port failed.'), true);
  options.port.on('message', onMessage);
  options.port.on('close', onClose);
  options.port.on('messageerror', onError);

  function detach(): void {
    options.port.off('message', onMessage);
    options.port.off('close', onClose);
    options.port.off('messageerror', onError);
  }

  function postRejected(request: NodeRpcRequest, error: unknown): void {
    try {
      options.port.postMessage({
        type: 'response',
        epoch: options.epoch,
        generation: options.generation,
        requestId: request.requestId,
        kind: request.kind,
        ok: false,
        error: errorMessage(error),
        payloadBytes: 0,
      });
    } catch {
      close(new NodeRpcClosedError('Node RPC rejection could not be sent.'), true);
    }
  }

  function receive(request: NodeRpcRequest): void {
    if (closed) return;
    if (!validRequestIdentity(request, options)) {
      staleMessages += 1;
      return;
    }
    if (request.requestId <= lastRequestId) {
      close(new NodeRpcProtocolError('Node RPC request id is not strictly increasing.'), true);
      return;
    }
    lastRequestId = request.requestId;
    try {
      const payload = validateNodeRpcPayload(
        options.validateRequest(request.kind, request.payload),
        'Node RPC request',
      );
      if (payload.bytes !== request.payloadBytes)
        throw new NodeRpcProtocolError('Node RPC request declared bytes do not match measured bytes.');
      if (payload.bytes > options.limits.maxInFlightBytes || payload.bytes > options.limits.maxQueuedBytes)
        throw new RangeError('Node RPC request exceeds a byte limit.');
      const reserveBytes =
        options.reserveResponseBytes?.(request.kind, payload.bytes) ?? options.limits.maxResponseBytes;
      if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0 || reserveBytes > options.limits.maxResponseBytes)
        throw new RangeError('Node RPC response reservation is invalid.');
      if (reserveBytes > options.limits.maxReservedResponseBytes)
        throw new RangeError('Node RPC response reservation exceeds the total limit.');
      if (queue.length + inFlight.size + retained.size >= options.limits.maxRequests)
        throw new RangeError('Node RPC request count limit reached.');
      if (queuedBytes + payload.bytes > options.limits.maxQueuedBytes)
        throw new RangeError('Node RPC queued byte limit reached.');
      const orderKey = options.dispatchOrderKey?.(request.kind);
      if (orderKey !== undefined && (typeof orderKey !== 'string' || !orderKey.trim()))
        throw new TypeError('Node RPC dispatch order key is invalid.');
      queue.push({ request, payload: payload.value, reserveBytes, ...(orderKey === undefined ? {} : { orderKey }) });
      queuedBytes += payload.bytes;
      accepted += 1;
      pump();
    } catch (error) {
      rejected += 1;
      postRejected(request, error);
    }
  }

  function acknowledge(ack: {
    epoch: string;
    generation: number;
    requestId: number;
    kind: string;
    payloadBytes: number;
  }): void {
    const response = retained.get(ack.requestId);
    if (!response) {
      if (inFlight.has(ack.requestId) || queue.some((entry) => entry.request.requestId === ack.requestId)) {
        close(new NodeRpcProtocolError('Node RPC acknowledgement arrived before its response.'), true);
        return;
      }
      staleMessages += 1;
      return;
    }
    if (
      ack.epoch !== options.epoch ||
      ack.generation !== options.generation ||
      ack.kind !== response.request.kind ||
      ack.payloadBytes !== response.payloadBytes
    ) {
      close(new NodeRpcProtocolError('Node RPC response acknowledgement is invalid.'), true);
      return;
    }
    retained.delete(ack.requestId);
    responseBytes -= response.reserveBytes;
    pump();
  }

  function nextDispatchable(): number {
    const blockedGroups = new Set<string>();
    for (let index = 0; index < queue.length; index += 1) {
      const entry = queue[index]!;
      if (entry.orderKey !== undefined && blockedGroups.has(entry.orderKey)) continue;
      if (
        entry.request.payloadBytes + inFlightBytes <= options.limits.maxInFlightBytes &&
        entry.reserveBytes + responseBytes <= options.limits.maxReservedResponseBytes
      )
        return index;
      if (entry.orderKey !== undefined) blockedGroups.add(entry.orderKey);
    }
    return -1;
  }

  function pump(): void {
    while (!closed && inFlight.size < options.limits.maxConcurrentRequests) {
      const index = nextDispatchable();
      if (index < 0) return;
      const entry = queue.splice(index, 1)[0];
      queuedBytes -= entry.request.payloadBytes;
      inFlightBytes += entry.request.payloadBytes;
      responseBytes += entry.reserveBytes;
      const current: InFlightRequest = { ...entry, controller: new AbortController() };
      inFlight.set(entry.request.requestId, current);
      void execute(current);
    }
  }

  async function execute(entry: InFlightRequest): Promise<void> {
    try {
      const result = await options.handle({
        kind: entry.request.kind,
        payload: entry.payload,
        requestId: entry.request.requestId,
        signal: entry.controller.signal,
      });
      postResult(entry, result);
    } catch (error) {
      postError(entry, error);
    }
  }

  function takeInFlight(entry: InFlightRequest): boolean {
    if (!inFlight.delete(entry.request.requestId)) return false;
    inFlightBytes -= entry.request.payloadBytes;
    return true;
  }

  function notifyIdle(): void {
    if (inFlight.size) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  }

  function postResult(entry: InFlightRequest, result: NodeRpcHandlerResult): void {
    if (!takeInFlight(entry)) return;
    if (closed) {
      responseBytes -= entry.reserveBytes;
      notifyIdle();
      return;
    }
    try {
      const payload = validateNodeRpcPayload(
        options.validateResponse(entry.request.kind, result.payload),
        'Node RPC response',
      );
      if (payload.bytes > options.limits.maxResponseBytes || payload.bytes > entry.reserveBytes)
        throw new RangeError('Node RPC response exceeds its reservation.');
      retained.set(entry.request.requestId, {
        request: entry.request,
        reserveBytes: entry.reserveBytes,
        payloadBytes: payload.bytes,
      });
      options.port.postMessage(
        {
          type: 'response',
          epoch: options.epoch,
          generation: options.generation,
          requestId: entry.request.requestId,
          kind: entry.request.kind,
          ok: true,
          payload: payload.value,
          payloadBytes: payload.bytes,
        },
        result.transfer ? [...result.transfer] : undefined,
      );
    } catch (error) {
      postErrorAfterTake(entry, error);
    }
    notifyIdle();
    pump();
  }

  function postError(entry: InFlightRequest, error: unknown): void {
    if (!takeInFlight(entry)) return;
    if (closed) {
      responseBytes -= entry.reserveBytes;
      notifyIdle();
      return;
    }
    postErrorAfterTake(entry, error);
    notifyIdle();
    pump();
  }

  function postErrorAfterTake(entry: InFlightRequest, error: unknown): void {
    retained.set(entry.request.requestId, {
      request: entry.request,
      reserveBytes: entry.reserveBytes,
      payloadBytes: 0,
    });
    try {
      options.port.postMessage({
        type: 'response',
        epoch: options.epoch,
        generation: options.generation,
        requestId: entry.request.requestId,
        kind: entry.request.kind,
        ok: false,
        error: errorMessage(error),
        payloadBytes: 0,
      });
    } catch {
      retained.delete(entry.request.requestId);
      responseBytes -= entry.reserveBytes;
      close(new NodeRpcClosedError('Node RPC error response could not be sent.'), true);
    }
  }

  function close(error = new NodeRpcClosedError(), closePort = false): void {
    if (closed) return;
    closed = true;
    detach();
    for (const entry of inFlight.values()) entry.controller.abort(error);
    queue.splice(0);
    for (const response of retained.values()) responseBytes -= response.reserveBytes;
    retained.clear();
    queuedBytes = 0;
    notifyIdle();
    if (closePort) {
      try {
        options.port.postMessage({
          type: 'close',
          epoch: options.epoch,
          generation: options.generation,
          reason: error.message,
        });
      } catch {
        // Physical close below is the terminal signal when the peer cannot receive a reason.
      }
      options.port.close();
    }
  }

  return {
    diagnostics(): NodeRpcDiagnostics {
      return {
        accepted,
        rejected,
        pending: queue.length + inFlight.size + retained.size,
        queuedBytes,
        inFlightBytes,
        responseBytes,
        staleMessages,
        nextRequestId: lastRequestId + 1,
        closed,
        activeHandlers: inFlight.size,
      };
    },
    whenIdle: () =>
      inFlight.size
        ? new Promise<void>((resolve) => {
            idleWaiters.add(resolve);
          })
        : Promise.resolve(),
    close: (error?: Error) => close(error, true),
  };
}
