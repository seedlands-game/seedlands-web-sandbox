export type AuthorityTransportPort<Message = unknown> = {
  onmessage: ((event: MessageEvent<Message>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
};

export type AuthorityTransportFaults = Readonly<{
  harnessEnabled: boolean;
  latencyMs?: 0 | 50 | 150;
  duplicateOutbound?: boolean;
  duplicateInbound?: boolean;
  reorderInbound?: boolean;
}>;

type Timer = ReturnType<typeof globalThis.setTimeout>;
const REORDER_HOLD_MS = 34;

const hasFault = (options: AuthorityTransportFaults) =>
  (options.latencyMs ?? 0) > 0 ||
  Boolean(options.duplicateOutbound || options.duplicateInbound || options.reorderInbound);

const isRepeatableOutbound = (message: unknown) => {
  if (!message || typeof message !== 'object' || !('kind' in message)) return false;
  const kind = (message as { kind: unknown }).kind;
  return kind === 'input' || kind === 'pause-authority' || kind === 'resume-authority' || 'transaction' in message;
};

export function createAuthorityTransport<Message>(
  raw: AuthorityTransportPort<Message>,
  options: AuthorityTransportFaults,
): AuthorityTransportPort<Message> {
  if (!options.harnessEnabled && hasFault(options))
    throw new Error('Authority transport faults are available only in Harness sessions.');
  const latencyMs = options.latencyMs ?? 0;
  const timers = new Set<Timer>();
  let disposed = false;
  let inboundSequence = 0;
  let onmessage: ((event: MessageEvent<Message>) => void) | null = null;
  let onerror: ((event: ErrorEvent) => void) | null = null;

  const later = (callback: () => void, delayMs: number) => {
    if (delayMs === 0) {
      if (!disposed) callback();
      return;
    }
    const timer = globalThis.setTimeout(() => {
      timers.delete(timer);
      if (!disposed) callback();
    }, delayMs);
    timers.add(timer);
  };
  const reportError = (error: unknown) =>
    onerror?.({ message: error instanceof Error ? error.message : String(error) } as ErrorEvent);
  const send = (message: unknown, transfer: Transferable[]) => {
    try {
      raw.postMessage(message, transfer);
    } catch (error) {
      reportError(error);
    }
  };

  raw.onmessage = (event) => {
    const reorderDelay = options.reorderInbound && inboundSequence++ % 2 === 0 ? REORDER_HOLD_MS : 0;
    if (!options.duplicateInbound) {
      later(() => onmessage?.(event), latencyMs + reorderDelay);
      return;
    }
    try {
      // Harness may deliver a copy after the first consumer transfers its buffers.
      // Clone both copies before either callback can detach the source graph.
      const first = structuredClone(event.data);
      const duplicate = structuredClone(event.data);
      later(() => onmessage?.({ data: first } as MessageEvent<Message>), latencyMs + reorderDelay);
      later(() => onmessage?.({ data: duplicate } as MessageEvent<Message>), latencyMs + reorderDelay + 1);
    } catch (error) {
      reportError(error);
    }
  };
  raw.onerror = (event) => later(() => onerror?.(event), latencyMs);

  return {
    get onmessage() {
      return onmessage;
    },
    set onmessage(value) {
      onmessage = value;
    },
    get onerror() {
      return onerror;
    },
    set onerror(value) {
      onerror = value;
    },
    postMessage(message, transfer = []) {
      if (disposed) return;
      let queuedMessage = message;
      let queuedTransfer = transfer;
      if (hasFault(options) && transfer.length > 0) {
        try {
          // A delayed Harness transport cannot retain references to buffers that
          // the caller still owns and may transfer immediately after this call.
          queuedMessage = structuredClone(message);
          queuedTransfer = [];
        } catch (error) {
          reportError(error);
          return;
        }
      }
      later(() => send(queuedMessage, queuedTransfer), latencyMs);
      if (options.duplicateOutbound && transfer.length === 0 && isRepeatableOutbound(message))
        later(() => {
          try {
            send(structuredClone(message), []);
          } catch (error) {
            reportError(error);
          }
        }, latencyMs + 1);
    },
    terminate() {
      if (disposed) return;
      disposed = true;
      timers.forEach((timer) => globalThis.clearTimeout(timer));
      timers.clear();
      raw.onmessage = null;
      raw.onerror = null;
      onmessage = null;
      onerror = null;
      raw.terminate();
    },
  };
}
