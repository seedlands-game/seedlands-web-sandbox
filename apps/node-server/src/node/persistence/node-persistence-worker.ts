import { parentPort, threadId, workerData } from 'node:worker_threads';
import { attachNodeRpcServer, type NodeRpcPort } from '../runtime/node-rpc-contract';
import { FileGamePersistence } from './file-game-persistence';
import { validatePersistenceLaneRequest, validatePersistenceLaneResponse } from './persistence-lane-codec';
import { createPersistenceLaneRequestHandler } from './persistence-lane-handler';
import type {
  PersistenceWorkerBootstrap,
  PersistenceWorkerControlEvent,
  PersistenceWorkerControlRequest,
} from './persistence-worker-control';

const control = parentPort;
if (!control) throw new Error('Persistence Worker 必须由 parentPort 启动。');
const bootstrap = workerData as Partial<PersistenceWorkerBootstrap>;
if (
  bootstrap?.type !== 'persistence-worker-bootstrap' ||
  !bootstrap.epoch ||
  !Number.isSafeInteger(bootstrap.generation) ||
  !bootstrap.port ||
  !bootstrap.store ||
  !bootstrap.rpcLimits
)
  throw new TypeError('Persistence Worker bootstrap 无效。');
const configuration = bootstrap as PersistenceWorkerBootstrap;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 2_048);

void (async () => {
  let store: FileGamePersistence | null = null;
  let closing: Promise<void> | null = null;
  try {
    store = await FileGamePersistence.open(configuration.store);
    const identity = {
      worldId: configuration.store.worldId ?? 'default',
      seedText: configuration.store.seedText,
      generatorVersion: configuration.store.generatorVersion,
    };
    const handler = createPersistenceLaneRequestHandler({ store, identity });
    const rpc = attachNodeRpcServer({
      port: configuration.port as unknown as NodeRpcPort,
      epoch: configuration.epoch,
      generation: configuration.generation,
      limits: configuration.rpcLimits,
      validateRequest: validatePersistenceLaneRequest,
      validateResponse: validatePersistenceLaneResponse,
      reserveResponseBytes: (kind) => {
        if (kind === 'persistence-open') return Math.min(72 * 1_024 * 1_024, configuration.rpcLimits.maxResponseBytes);
        if (kind === 'persistence-ensure-neighborhood')
          return Math.min(64 * 1_024 * 1_024, configuration.rpcLimits.maxResponseBytes);
        if (kind === 'persistence-ensure') return Math.min(4 * 1_024 * 1_024, configuration.rpcLimits.maxResponseBytes);
        return Math.min(1 * 1_024 * 1_024, configuration.rpcLimits.maxResponseBytes);
      },
      handle: async (request) => {
        const result = await handler.handleRpc(request);
        if (request.kind === 'persistence-close') {
          const event: PersistenceWorkerControlEvent = {
            type: 'persistence-worker-store-closed',
            epoch: configuration.epoch,
            generation: configuration.generation,
            rpc: rpc.diagnostics(),
          };
          control.postMessage(event);
        }
        return result;
      },
    });
    const ready: PersistenceWorkerControlEvent = {
      type: 'persistence-worker-ready',
      epoch: configuration.epoch,
      generation: configuration.generation,
      threadId,
      identity,
      rpc: rpc.diagnostics(),
    };
    control.postMessage(ready);
    control.on('message', (value: unknown) => {
      const request = value as Partial<PersistenceWorkerControlRequest>;
      if (
        request?.type !== 'persistence-worker-close' ||
        request.epoch !== configuration.epoch ||
        request.generation !== configuration.generation
      )
        return;
      if (!closing) {
        closing = handler.close().then(() => {
          rpc.close();
          configuration.port.close();
          const event: PersistenceWorkerControlEvent = {
            type: 'persistence-worker-store-closed',
            epoch: configuration.epoch,
            generation: configuration.generation,
            rpc: rpc.diagnostics(),
          };
          control.postMessage(event);
        });
      }
      void closing.catch(async (error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error));
        const event: PersistenceWorkerControlEvent = {
          type: 'persistence-worker-fatal',
          epoch: configuration.epoch,
          generation: configuration.generation,
          error: errorMessage(failure),
        };
        control.postMessage(event);
        rpc.close(failure);
        await rpc.whenIdle();
        configuration.port.close();
        control.close();
      });
    });
  } catch (error) {
    if (store) await store.close().catch(() => undefined);
    configuration.port.close();
    const event: PersistenceWorkerControlEvent = {
      type: 'persistence-worker-fatal',
      epoch: configuration.epoch,
      generation: configuration.generation,
      error: errorMessage(error),
    };
    control.postMessage(event);
    control.close();
  }
})();
