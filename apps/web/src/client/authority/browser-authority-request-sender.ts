import { PROTOCOL_VERSION } from '@seedlands/stdlib/runtime/session-protocol';
import type { AuthorityRequest } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { ClientRequestRegistry } from '../client-request-registry';

/** Existing request/transaction counters and rejection lifecycle, kept together at the client boundary. */
export class BrowserAuthorityRequestSender {
  private sequence = 0;
  private readonly transactionSequences = new Map<string, number>();
  constructor(
    private readonly options: Readonly<{
      epoch: string;
      requests: ClientRequestRegistry;
      blocked(): Error | null;
      post(message: AuthorityRequest, transfer: Transferable[]): void;
    }>,
  ) {}

  nextRequestId(): number {
    return ++this.sequence;
  }

  send(payload: Record<string, unknown>, transfer: Transferable[], transactionStream?: string): Promise<unknown> {
    const blocked = this.options.blocked();
    if (blocked) return Promise.reject(blocked);
    const requestId = this.nextRequestId();
    const promise = this.options.requests.create(requestId);
    const transaction = transactionStream
      ? {
          issuer: `browser:${this.options.epoch}`,
          stream: transactionStream,
          sequence: (this.transactionSequences.get(transactionStream) ?? -1) + 1,
        }
      : undefined;
    if (transaction) this.transactionSequences.set(transactionStream!, transaction.sequence);
    try {
      this.options.post(
        {
          ...payload,
          protocolVersion: PROTOCOL_VERSION,
          epoch: this.options.epoch,
          requestId,
          ...(transaction ? { transaction } : {}),
        } as AuthorityRequest,
        transfer,
      );
    } catch (error) {
      this.options.requests.reject(requestId, error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }
}
