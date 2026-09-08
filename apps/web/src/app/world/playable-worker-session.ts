import type { AuthorityReady } from '@seedlands/game-core/compute/authority-worker-protocol';
import type { AuthorityClientOptions } from '../../client/authority/browser-authority-client-contract';
import type { BrowserAuthorityClient } from '../../client/authority/browser-authority-client';
import { RemoteAuthorityClient } from '../../client/authority/remote-authority-client';
import { BrowserComputeRuntime } from '../../client/compute/browser-compute-runtime';
import type { WasmWorkerSelection } from '../../compute/wasm-kernel-contract';
import type { BrowserLogicClient } from '../../client/authority/browser-logic-client';
import { startBrowserWorkerSession } from '../browser-worker-session';

type LocalOptions = Parameters<typeof startBrowserWorkerSession>[0];

export const startPlayableWorkerSession = async (options: {
  remote: Readonly<{ url: string; accessKey: string }> | null;
  client: AuthorityClientOptions;
  local: LocalOptions;
  wasm: WasmWorkerSelection;
  generalWorkerCount: 1 | 2;
  signal?: AbortSignal;
}): Promise<{
  authority: BrowserAuthorityClient | RemoteAuthorityClient;
  compute: BrowserComputeRuntime;
  logic: BrowserLogicClient | null;
  ready: AuthorityReady;
}> => {
  if (!options.remote) return startBrowserWorkerSession(options.local);
  const connected = await RemoteAuthorityClient.connect({
    ...options.remote,
    ...options.client,
    signal: options.signal,
  });
  return {
    authority: connected.authority,
    compute: new BrowserComputeRuntime({
      epoch: connected.authority.epoch,
      generalWorkerCount: options.generalWorkerCount,
      fluidWorkerEnabled: false,
      wasm: options.wasm,
      onFluidCandidate: () => undefined,
    }),
    logic: null,
    ready: connected.ready,
  };
};
