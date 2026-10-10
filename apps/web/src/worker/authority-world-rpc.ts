import type { AuthorityRuntime } from '@seedlands/stdlib/server/authority/authority-runtime';
import type { AuthorityWorldHarness } from '@seedlands/stdlib/server/harness/authority-world-harness';
import { dispatchWorldHarnessRpc } from '@seedlands/stdlib/server/harness/world-harness-jsonl';
import type { AuthorityRequest, AuthorityResponse } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import { PROTOCOL_VERSION } from '@seedlands/stdlib/runtime/session-protocol';

/** Original world RPC lifecycle; read current context again after a checkpoint restore. */
export async function handleBrowserWorldRpc(
  message: Extract<AuthorityRequest, { kind: 'world-harness-rpc' }>,
  harness: AuthorityWorldHarness,
  context: () => { epoch: string; runtimeEpoch: string; runtime: AuthorityRuntime },
  post: (message: AuthorityResponse) => void,
  fail: (requestId: number, error: unknown) => void,
): Promise<void> {
  if (message.runtimeEpoch !== context().runtimeEpoch) {
    fail(message.requestId, new Error('WORLD_EPOCH_STALE: World request was submitted for a stale runtime epoch.'));
    return;
  }
  const result = await dispatchWorldHarnessRpc(harness, {
    protocolVersion: 1,
    requestId: message.requestId,
    method: message.method,
    args: message.args,
  });
  const current = context();
  post({
    kind: 'world-harness-response',
    protocolVersion: PROTOCOL_VERSION,
    epoch: current.epoch,
    requestId: message.requestId,
    result: result.result,
    ...(message.method === 'checkpoint' &&
    result.result.ok &&
    result.result.data &&
    typeof result.result.data === 'object' &&
    'restored' in result.result.data
      ? { ready: current.runtime.ready(), runtimeEpoch: current.runtimeEpoch }
      : {}),
  });
}
