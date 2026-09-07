import {
  NodeRpcClosedError,
  NodeRpcProtocolError,
  assertNodeRpcIdentity,
  assertNodeRpcLimits,
  isNodeRpcClose,
  isNodeRpcResponse,
  validateNodeRpcPayload,
  type NodeRpcClient,
  type NodeRpcClientTerminal,
  type NodeRpcClientTerminalCause,
  type NodeRpcClientOptions,
  type NodeRpcDiagnostics,
  type NodeRpcRequest,
  type NodeRpcRequestOptions,
} from './node-rpc-contract';
import type { Transferable as NodeTransferable } from 'node:worker_threads';

type PendingRequest = {
  request: NodeRpcRequest;
  transfer?: readonly NodeTransferable[];
  state: 'queued' | 'inflight';
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
  abort?: () => void;
};

function errorMessage(value: unknown, fallback: string): string {
  return value instanceof Error && value.message ? value.message : fallback;
}

/** Client side owns the request queue; server acknowledgement frees reply reservation. */
export function createNodeRpcClient(options: NodeRpcClientOptions): NodeRpcClient {
  assertNodeRpcIdentity(options.epoch, options.generation);
  assertNodeRpcLimits(options.limits);
  let closed = false;
  let nextRequestId = 0;
  let accepted = 0;
  let rejected = 0;
  let staleMessages = 0;
  let queuedBytes = 0;
  let inFlightBytes = 0;
  const pending = new Map<number, PendingRequest>();
  const queue: PendingRequest[] = [];
  let resolveTerminal!: (terminal: NodeRpcClientTerminal) => void;
  const terminal = new Promise<NodeRpcClientTerminal>((resolve) => {
    resolveTerminal = resolve;
  });

  const onMessage = (value?: unknown) => {
    if (isNodeRpcClose(value)) {
      if (value.epoch !== options.epoch || value.generation !== options.generation) {
        staleMessages += 1;
        return;
      }
      failAll(new NodeRpcClosedError(value.reason ?? 'Node RPC peer closed the port.'), 'peer-close', true);
      return;
    }
    if (!isNodeRpcResponse(value)) {
      staleMessages += 1;
      return;
    }
    const entry = pending.get(value.requestId);
    if (!entry) {
      staleMessages += 1;
      return;
    }
    if (
      value.epoch !== options.epoch ||
      value.generation !== options.generation ||
      value.kind !== entry.request.kind ||
      !Number.isSafeInteger(value.payloadBytes) ||
      value.payloadBytes < 0
    ) {
      failAll(new NodeRpcProtocolError('Node RPC peer violated the response contract.'), 'protocol-error', true);
      return;
    }
    try {
      if (value.payloadBytes > options.limits.maxResponseBytes)
        throw new NodeRpcProtocolError('Node RPC response exceeds maxResponseBytes.');
      if (value.ok) {
        const decoded = validateNodeRpcPayload(
          options.validateResponse(value.kind, value.payload),
          'Node RPC response',
        );
        if (decoded.bytes !== value.payloadBytes)
          throw new NodeRpcProtocolError(
            `Node RPC response byte mismatch: declared=${value.payloadBytes}, measured=${decoded.bytes}.`,
          );
        acknowledge(value);
        settle(entry, undefined, decoded.value);
      } else {
        if (value.payloadBytes !== 0 || typeof value.error !== 'string')
          throw new NodeRpcProtocolError('Node RPC error response is invalid.');
        acknowledge(value);
        settle(entry, new Error(value.error));
      }
    } catch (error) {
      failAll(
        new NodeRpcProtocolError(
          `Node RPC response validation failed: ${errorMessage(error, 'unknown validation error')}`,
        ),
        'protocol-error',
        true,
      );
    }
  };

  const onClose = () => failAll(new NodeRpcClosedError(), 'transport-close');
  const onError = (error?: unknown) =>
    failAll(new NodeRpcClosedError(errorMessage(error, 'Node RPC port failed.')), 'transport-close', true);
  options.port.on('message', onMessage);
  options.port.on('close', onClose);
  options.port.on('messageerror', onError);

  function detach(): void {
    options.port.off('message', onMessage);
    options.port.off('close', onClose);
    options.port.off('messageerror', onError);
  }

  function acknowledge(response: { requestId: number; kind: string; payloadBytes: number }): void {
    if (closed) return;
    options.port.postMessage({
      type: 'response-ack',
      epoch: options.epoch,
      generation: options.generation,
      requestId: response.requestId,
      kind: response.kind,
      payloadBytes: response.payloadBytes,
    });
  }

  function settle(entry: PendingRequest, error?: Error, result?: unknown): void {
    if (!pending.delete(entry.request.requestId)) return;
    if (entry.state === 'queued') {
      const index = queue.indexOf(entry);
      if (index >= 0) queue.splice(index, 1);
      queuedBytes = Math.max(0, queuedBytes - entry.request.payloadBytes);
    } else inFlightBytes = Math.max(0, inFlightBytes - entry.request.payloadBytes);
    if (entry.timeout) clearTimeout(entry.timeout);
    entry.abort?.();
    if (error) entry.reject(error);
    else entry.resolve(result);
    pump();
  }

  function failAll(error: Error, cause: NodeRpcClientTerminalCause, closePort = false): void {
    if (closed) return;
    closed = true;
    detach();
    for (const entry of [...pending.values()]) settle(entry, error);
    queue.splice(0);
    if (closePort) {
      try {
        options.port.postMessage({
          type: 'close',
          epoch: options.epoch,
          generation: options.generation,
          reason: error.message,
        });
      } catch {
        // close() below is still required to release the peer's retained response reservations.
      }
      options.port.close();
    }
    resolveTerminal({ cause, error });
  }

  function cancel(entry: PendingRequest, error: Error): void {
    if (entry.state === 'queued') settle(entry, error);
    else failAll(error, 'request-cancel', true);
  }

  function pump(): void {
    if (closed) return;
    while (queue.length) {
      const entry = queue[0];
      if (entry.request.payloadBytes + inFlightBytes > options.limits.maxInFlightBytes) return;
      queue.shift();
      entry.state = 'inflight';
      queuedBytes -= entry.request.payloadBytes;
      inFlightBytes += entry.request.payloadBytes;
      try {
        options.port.postMessage(entry.request, entry.transfer ? [...entry.transfer] : undefined);
      } catch (error) {
        settle(entry, new NodeRpcClosedError(errorMessage(error, 'Node RPC request could not be sent.')));
      }
    }
  }

  return {
    request(kind: string, rawPayload: unknown, requestOptions: NodeRpcRequestOptions = {}): Promise<unknown> {
      try {
        if (closed) throw new NodeRpcClosedError();
        if (!kind.trim()) throw new TypeError('Node RPC kind must not be empty.');
        if (
          requestOptions.timeoutMs !== undefined &&
          (!Number.isSafeInteger(requestOptions.timeoutMs) || requestOptions.timeoutMs < 1)
        )
          throw new RangeError('Node RPC timeoutMs must be a positive safe integer.');
        if (requestOptions.signal?.aborted)
          throw new NodeRpcClosedError('Node RPC request was aborted before acceptance.');
        const payload = validateNodeRpcPayload(options.validateRequest(kind, rawPayload), 'Node RPC request');
        if (payload.bytes > options.limits.maxInFlightBytes || payload.bytes > options.limits.maxQueuedBytes)
          throw new RangeError('Node RPC request exceeds a byte limit.');
        if (pending.size >= options.limits.maxRequests) throw new RangeError('Node RPC request count limit reached.');
        if (queuedBytes + payload.bytes > options.limits.maxQueuedBytes)
          throw new RangeError('Node RPC queued byte limit reached.');
        if (nextRequestId >= Number.MAX_SAFE_INTEGER) throw new RangeError('Node RPC request id space exhausted.');
        const request: NodeRpcRequest = {
          type: 'request',
          epoch: options.epoch,
          generation: options.generation,
          requestId: nextRequestId++,
          kind,
          payload: payload.value,
          payloadBytes: payload.bytes,
        };
        accepted += 1;
        return new Promise<unknown>((resolve, reject) => {
          const entry: PendingRequest = {
            request,
            transfer: requestOptions.transfer,
            state: 'queued',
            resolve,
            reject,
          };
          pending.set(request.requestId, entry);
          queue.push(entry);
          queuedBytes += request.payloadBytes;
          if (requestOptions.timeoutMs !== undefined) {
            entry.timeout = setTimeout(
              () => cancel(entry, new NodeRpcClosedError(`Node RPC request ${request.requestId} timed out.`)),
              requestOptions.timeoutMs,
            );
          }
          if (requestOptions.signal) {
            const abort = () =>
              cancel(entry, new NodeRpcClosedError(`Node RPC request ${request.requestId} was aborted.`));
            requestOptions.signal.addEventListener('abort', abort, { once: true });
            entry.abort = () => requestOptions.signal?.removeEventListener('abort', abort);
          }
          pump();
        });
      } catch (error) {
        rejected += 1;
        return Promise.reject(error);
      }
    },
    diagnostics(): NodeRpcDiagnostics {
      return {
        accepted,
        rejected,
        pending: pending.size,
        queuedBytes,
        inFlightBytes,
        responseBytes: 0,
        staleMessages,
        nextRequestId,
        closed,
        activeHandlers: 0,
      };
    },
    whenClosed: () => terminal,
    close(error = new NodeRpcClosedError()): void {
      if (closed) return;
      failAll(error, 'local-close', true);
    },
  };
}
