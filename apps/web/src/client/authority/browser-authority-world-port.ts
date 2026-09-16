import type { WorldHarnessPort, WorldPrepareRequest } from '@seedlands/stdlib/server/harness/world-harness-contract';

type Request = <Method extends keyof WorldHarnessPort>(
  method: Method,
  ...args: unknown[]
) => ReturnType<WorldHarnessPort[Method]>;

export const createBrowserAuthorityWorldPort = (
  request: Request,
  prepareWorldRequest: (request: WorldPrepareRequest) => Promise<void>,
): WorldHarnessPort => ({
  identity: () => request('identity'),
  inspect: (value) => request('inspect', value),
  prepare: async (value) => {
    const result = await request('prepare', value);
    if (!result.ok) return result;
    try {
      await prepareWorldRequest(value);
      return result;
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'WORLD_PREPARE_UNAVAILABLE',
          message: error instanceof Error ? error.message : String(error),
          kind: 'unavailable',
        },
        frontier: result.frontier,
      };
    }
  },
  command: (command, options) => request('command', command, options),
  clock: (value) => request('clock', value),
  logic: (value) => request('logic', value),
  actions: (query) => request('actions', query),
  character: (value) => request('character', value),
  barrier: (value) => request('barrier', value),
  trace: (value) => request('trace', value),
  checkpoint: (value) => request('checkpoint', value),
});
