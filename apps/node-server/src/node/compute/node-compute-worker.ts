import { parentPort } from 'node:worker_threads';
import { runDedicatedComputeTask } from '@seedlands/game-core/server/compute/run-dedicated-compute-task';
import { measureNodeComputeBytes } from './node-compute-byte-budget';
import { isNodeComputeRequest, type NodeComputeResponse } from './node-compute-messages';

const port = parentPort;
if (!port) throw new Error('Node compute worker requires a parent port.');

port.on('message', (message: unknown) => {
  if (!isNodeComputeRequest(message)) return;
  void runDedicatedComputeTask(message.task).then(
    (result) => {
      const response: NodeComputeResponse = {
        kind: 'dedicated-compute-result',
        epoch: message.task.epoch,
        taskId: message.task.taskId,
        generation: message.task.generation,
        resourceGeneration: message.resourceGeneration,
        ...(measureNodeComputeBytes(result) > message.maxResultBytes
          ? { ok: false as const, error: 'Dedicated compute result exceeds byte budget.' }
          : { ok: true as const, result }),
      };
      port.postMessage(response);
    },
    (error: unknown) => {
      const response: NodeComputeResponse = {
        kind: 'dedicated-compute-result',
        epoch: message.task.epoch,
        taskId: message.task.taskId,
        generation: message.task.generation,
        resourceGeneration: message.resourceGeneration,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      port.postMessage(response);
    },
  );
});
