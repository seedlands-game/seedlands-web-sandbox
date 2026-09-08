import { runDedicatedComputeTask } from '@seedlands/game-core/server/compute/run-dedicated-compute-task';
import { measureNodeComputeBytes } from './node-compute-byte-budget';
import { isNodeComputeRequest, type NodeComputeResponse } from './node-compute-messages';

process.on('message', (message: unknown) => {
  if (!process.send || !isNodeComputeRequest(message)) return;
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
      process.send?.(response);
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
      process.send?.(response);
    },
  );
});
