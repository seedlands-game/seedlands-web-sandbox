import { PROTOCOL_VERSION } from '@seedlands/stdlib/runtime/session-protocol';
import type { AuthorityRuntime } from '@seedlands/stdlib/server/authority/authority-runtime';
import type { AuthorityRequest, AuthorityResponse } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';

type Post = (message: AuthorityResponse) => void;
export const authorityErrorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
type TransactionMessage = Extract<
  AuthorityRequest,
  {
    kind:
      | 'world-edit'
      | 'set-player-position'
      | 'gameplay-action'
      | 'server-command'
      | 'set-world-time'
      | 'set-world-clock-rate'
      | 'pause-authority'
      | 'resume-authority';
  }
>;
type TransactionResponse = Readonly<{
  result: unknown;
  gameplay?: ReturnType<AuthorityRuntime['view']>;
  commits?: ReturnType<AuthorityRuntime['takeCommits']>;
}>;

export const postAuthoritySuccess = (
  post: Post,
  epoch: string,
  current: AuthorityRuntime,
  requestId: number,
  result: unknown,
  options: { gameplay?: boolean; commits?: boolean } = {},
) =>
  post({
    kind: 'authority-response',
    protocolVersion: PROTOCOL_VERSION,
    epoch,
    requestId,
    ok: true,
    result,
    ...(options.gameplay ? { gameplay: current.view() } : {}),
    ...(options.commits ? { commits: current.takeCommits() } : {}),
  });

export const postAuthorityFailure = (post: Post, epoch: string, requestId: number, error: unknown) =>
  post({
    kind: 'authority-response',
    protocolVersion: PROTOCOL_VERSION,
    epoch,
    requestId,
    ok: false,
    error: authorityErrorText(error),
  });

export async function transactAuthorityRequest(
  post: Post,
  epoch: string,
  runtimeEpoch: string,
  current: AuthorityRuntime,
  message: TransactionMessage,
  operation: () => TransactionResponse | Promise<TransactionResponse>,
): Promise<void> {
  const receipt = await current.executeTransaction({ epoch: runtimeEpoch, ...message.transaction }, operation);
  if (receipt.status !== 'executed') {
    postAuthorityFailure(
      post,
      epoch,
      message.requestId ?? -1,
      new Error(`Authority transaction ${receipt.status} at ${receipt.commitSequence}.`),
    );
    return;
  }
  if (message.requestId === undefined) return;
  post({
    kind: 'authority-response',
    protocolVersion: PROTOCOL_VERSION,
    epoch,
    requestId: message.requestId,
    ok: true,
    result: receipt.result.result,
    commitSequence: receipt.commitSequence,
    ...(receipt.result.gameplay ? { gameplay: receipt.result.gameplay } : {}),
    ...(receipt.result.commits?.length ? { commits: receipt.result.commits } : {}),
  });
}
