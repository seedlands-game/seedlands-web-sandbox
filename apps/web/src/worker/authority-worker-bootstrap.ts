import type { AuthorityInitialWorldBootstrap } from '@seedlands/stdlib/server/authority/authority-runtime';
import type { AuthorityRequest, AuthorityResponse } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { PROTOCOL_VERSION } from '@seedlands/stdlib/runtime/session-protocol';
import type { StarterEcologyConfiguration } from '@seedlands/stdlib/server/gameplay/actor-profile';
import type { KernelWorldgenProviderIdentity } from '@seedlands/kernel/spatial';

export const decodeAuthorityBootstrapResult = (
  message: Extract<AuthorityRequest, { kind: 'authority-bootstrap-result' }>,
): AuthorityInitialWorldBootstrap => {
  if (
    message.playerBodyPosition.length !== 3 ||
    !message.playerBodyPosition.every((value) => Number.isFinite(value)) ||
    !Array.isArray(message.starterChunks)
  )
    throw new Error('Safe spawn compute result is invalid.');
  return {
    playerBodyPosition: message.playerBodyPosition,
    starterChunks: message.starterChunks.map((chunk) => ({
      ...chunk,
      canonical: new Uint16Array(chunk.canonical),
    })),
  };
};

type BootstrapResult = Extract<AuthorityRequest, { kind: 'authority-bootstrap-result' }>;

export class AuthorityWorkerBootstrap {
  private sequence = 0;
  private pending: {
    requestId: number;
    resolve: (bootstrap: AuthorityInitialWorldBootstrap) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(private readonly post: (message: AuthorityResponse) => void) {}

  request(
    epoch: string,
    seed: number,
    generatorVersion: number,
    provider: KernelWorldgenProviderIdentity,
    starterEcology: StarterEcologyConfiguration | null,
  ): Promise<AuthorityInitialWorldBootstrap> {
    if (this.pending) return Promise.reject(new Error('Authority bootstrap generation is already pending.'));
    const requestId = ++this.sequence;
    const promise = new Promise<AuthorityInitialWorldBootstrap>((resolve, reject) => {
      this.pending = { requestId, resolve, reject };
    });
    this.post({
      kind: 'authority-bootstrap-needed',
      protocolVersion: PROTOCOL_VERSION,
      epoch,
      requestId,
      seed,
      generatorVersion,
      provider,
      starterEcology,
    });
    return promise;
  }

  receive(epoch: string, message: BootstrapResult): void {
    if (message.epoch !== epoch || !this.pending || message.requestId !== this.pending.requestId) return;
    const pending = this.pending;
    this.pending = null;
    try {
      pending.resolve(decodeAuthorityBootstrapResult(message));
    } catch (error) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  close(): void {
    this.pending?.reject(new Error('Authority Worker was disposed during bootstrap.'));
    this.pending = null;
  }
}
