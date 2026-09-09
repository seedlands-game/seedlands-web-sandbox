import {
  WORLD_HARNESS_PROTOCOL_VERSION,
  type WorldHarnessPort,
  type WorldHarnessRpcRequest,
  type WorldHarnessRpcResponse,
} from './world-harness-contract';

export const WORLD_HARNESS_JSONL_MAX_LINE_BYTES = 1024 * 1024;

const requestError = (requestId: number, code: string, message: string): WorldHarnessRpcResponse => ({
  protocolVersion: WORLD_HARNESS_PROTOCOL_VERSION,
  requestId,
  result: { ok: false, error: { kind: 'validation', code, message } },
});

export function readWorldHarnessRpcRequest(value: unknown): WorldHarnessRpcRequest {
  if (!value || typeof value !== 'object') throw new TypeError('World Harness RPC request must be an object.');
  const request = value as Partial<WorldHarnessRpcRequest>;
  if (request.protocolVersion !== WORLD_HARNESS_PROTOCOL_VERSION)
    throw new TypeError('Unsupported World Harness RPC protocol version.');
  if (!Number.isSafeInteger(request.requestId) || request.requestId! < 0)
    throw new TypeError('World Harness RPC requestId must be a non-negative safe integer.');
  if (
    !request.method ||
    ![
      'identity',
      'inspect',
      'prepare',
      'command',
      'clock',
      'logic',
      'actions',
      'barrier',
      'trace',
      'checkpoint',
    ].includes(request.method)
  )
    throw new TypeError(`Unsupported World Harness RPC method: ${String(request.method)}.`);
  if (!Array.isArray(request.args) || request.args.length > 2)
    throw new TypeError('World Harness RPC args must be an array with at most two entries.');
  return request as WorldHarnessRpcRequest;
}

export async function dispatchWorldHarnessRpc(
  world: WorldHarnessPort,
  value: unknown,
): Promise<WorldHarnessRpcResponse> {
  let request: WorldHarnessRpcRequest;
  try {
    request = readWorldHarnessRpcRequest(value);
  } catch (cause) {
    const requestId =
      value &&
      typeof value === 'object' &&
      Number.isSafeInteger((value as { requestId?: unknown }).requestId) &&
      (value as { requestId: number }).requestId >= 0
        ? ((value as { requestId: number }).requestId ?? 0)
        : 0;
    return requestError(requestId, 'WORLD_RPC_INVALID', cause instanceof Error ? cause.message : String(cause));
  }
  try {
    let result;
    switch (request.method) {
      case 'identity':
        result =
          request.args.length === 0
            ? await world.identity()
            : requestError(request.requestId, 'WORLD_RPC_INVALID', 'identity takes no arguments.').result;
        break;
      case 'inspect':
        result =
          request.args.length === 1
            ? await world.inspect(request.args[0] as never)
            : requestError(request.requestId, 'WORLD_RPC_INVALID', 'inspect takes one argument.').result;
        break;
      case 'prepare':
        result =
          request.args.length === 1
            ? await world.prepare(request.args[0] as never)
            : requestError(request.requestId, 'WORLD_RPC_INVALID', 'prepare takes one argument.').result;
        break;
      case 'command':
        result =
          request.args.length >= 1
            ? await world.command(request.args[0] as never, request.args[1] as never)
            : requestError(request.requestId, 'WORLD_RPC_INVALID', 'command takes one or two arguments.').result;
        break;
      case 'clock':
        result =
          request.args.length === 1
            ? await world.clock(request.args[0] as never)
            : requestError(request.requestId, 'WORLD_RPC_INVALID', 'clock takes one argument.').result;
        break;
      case 'logic':
        result =
          request.args.length === 1
            ? await world.logic(request.args[0] as never)
            : requestError(request.requestId, 'WORLD_RPC_INVALID', 'logic takes one argument.').result;
        break;
      case 'actions':
        result =
          request.args.length <= 1
            ? await world.actions(request.args[0] as never)
            : requestError(request.requestId, 'WORLD_RPC_INVALID', 'actions takes zero or one argument.').result;
        break;
      case 'barrier':
        result =
          request.args.length === 1
            ? await world.barrier(request.args[0] as never)
            : requestError(request.requestId, 'WORLD_RPC_INVALID', 'barrier takes one argument.').result;
        break;
      case 'trace':
        result =
          request.args.length === 1
            ? await world.trace(request.args[0] as never)
            : requestError(request.requestId, 'WORLD_RPC_INVALID', 'trace takes one argument.').result;
        break;
      case 'checkpoint':
        result =
          request.args.length === 1
            ? await world.checkpoint(request.args[0] as never)
            : requestError(request.requestId, 'WORLD_RPC_INVALID', 'checkpoint takes one argument.').result;
        break;
    }
    return {
      protocolVersion: WORLD_HARNESS_PROTOCOL_VERSION,
      requestId: request.requestId,
      result,
    };
  } catch (cause) {
    return requestError(request.requestId, 'WORLD_RPC_INVALID', cause instanceof Error ? cause.message : String(cause));
  }
}
