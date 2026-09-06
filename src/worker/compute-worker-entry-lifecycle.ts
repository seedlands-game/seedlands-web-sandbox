import { PROTOCOL_VERSION } from '../runtime/session-protocol';
import type { ComputeTask } from '../runtime/compute-task-queue';
import type { ComputeWorkerRequest } from './compute-worker-protocol';

const RECENTLY_SETTLED_LIMIT = 256;

export type ComputeWorkerExecution =
  | Readonly<{
      ok: true;
      result: unknown;
      workerDurationMs?: number;
      transfer?: readonly Transferable[];
    }>
  | Readonly<{
      ok: false;
      error: unknown;
      workerDurationMs?: number;
    }>;

type ActiveTask = { task: ComputeTask; cancelled: boolean };

type Options = Readonly<{
  run: (task: ComputeTask, isCancelled: () => boolean) => Promise<ComputeWorkerExecution>;
  postMessage: (message: unknown, transfer: Transferable[]) => void;
}>;

const taskKey = (epoch: string, taskId: number) => `${epoch}\u0000${taskId}`;
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createComputeWorkerEntryLifecycle(options: Options) {
  const active = new Map<string, ActiveTask>();
  const recentlySettled = new Set<string>();
  let disposed = false;

  const rememberSettled = (key: string) => {
    recentlySettled.add(key);
    while (recentlySettled.size > RECENTLY_SETTLED_LIMIT)
      recentlySettled.delete(recentlySettled.values().next().value!);
  };

  const handle = (message: ComputeWorkerRequest) => {
    if (disposed) return;
    if (message.kind === 'cancel-compute-task') {
      if (message.protocolVersion !== PROTOCOL_VERSION) return;
      const state = active.get(taskKey(message.epoch, message.taskId));
      if (state) state.cancelled = true;
      return;
    }

    const task = message.task;
    const key = taskKey(task.epoch, task.taskId);
    if (active.size >= 1 || active.has(key) || recentlySettled.has(key)) return;
    const state: ActiveTask = { task, cancelled: false };
    active.set(key, state);
    const isCancelled = () => disposed || state.cancelled;
    void Promise.resolve()
      .then(() => options.run(task, isCancelled))
      .catch((error): ComputeWorkerExecution => ({
        ok: false,
        error,
      }))
      .then((execution) => {
        if (disposed || active.get(key) !== state) return;
        const workerDurationMs = execution.workerDurationMs;
        if (state.cancelled) {
          options.postMessage(
            {
              kind: 'compute-result',
              protocolVersion: PROTOCOL_VERSION,
              epoch: task.epoch,
              taskId: task.taskId,
              ok: false,
              ...(workerDurationMs === undefined ? {} : { workerDurationMs }),
              error: 'cancelled',
            },
            [],
          );
          return;
        }
        if (!execution.ok) {
          options.postMessage(
            {
              kind: 'compute-result',
              protocolVersion: PROTOCOL_VERSION,
              epoch: task.epoch,
              taskId: task.taskId,
              ok: false,
              ...(workerDurationMs === undefined ? {} : { workerDurationMs }),
              error: errorMessage(execution.error),
            },
            [],
          );
          return;
        }
        options.postMessage(
          {
            kind: 'compute-result',
            protocolVersion: PROTOCOL_VERSION,
            epoch: task.epoch,
            taskId: task.taskId,
            ok: true,
            ...(workerDurationMs === undefined ? {} : { workerDurationMs }),
            result: execution.result,
          },
          [...(execution.transfer ?? [])],
        );
      })
      .finally(() => {
        if (active.get(key) !== state) return;
        active.delete(key);
        if (!disposed) rememberSettled(key);
      });
  };

  return {
    handle,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      active.forEach((state) => {
        state.cancelled = true;
      });
      active.clear();
      recentlySettled.clear();
    },
    diagnostics: () => ({
      activeTaskCount: active.size,
      cancelledTaskCount: [...active.values()].filter((state) => state.cancelled).length,
      recentlySettledTaskCount: recentlySettled.size,
      recentlySettledLimit: RECENTLY_SETTLED_LIMIT,
      disposed,
    }),
  };
}
