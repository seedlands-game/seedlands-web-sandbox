import type { WorldComposition } from './contracts';
import type { ModuleScheduleSnapshot } from './lifecycle-contracts';
import type { RegisteredOperationRequest, RegisteredOperationResult } from './operation-contracts';

const round = (value: number) => Math.round(value * 1e9) / 1e9;
const MAX_OPERATIONS_PER_ADVANCE = 256;

/** Logical scheduling only. The host binds each module to its approved service principal. */
export function createModuleLifecycle(
  options: Readonly<{
    composition: WorldComposition;
    invoke(moduleId: string, request: RegisteredOperationRequest): RegisteredOperationResult;
  }>,
) {
  const { systems, lifecycles } = options.composition.registrations;
  const remainders = new Map(systems.map(({ definition }) => [definition.id, 0]));
  let status: 'created' | 'running' | 'failed' | 'disposed' = 'created';
  let time = 0;
  let busy = false;
  const started: (typeof lifecycles)[number][] = [];
  const invoke = (moduleId: string, operationId: string, seconds?: number) => {
    busy = true;
    let result: RegisteredOperationResult;
    try {
      result = options.invoke(moduleId, {
        operationId,
        target: { kind: 'world' },
        ...(seconds === undefined ? {} : { input: { seconds } }),
      });
    } finally {
      busy = false;
    }
    if (!result.ok) throw new Error(`Module lifecycle failed: ${operationId}: ${result.code}: ${result.message}`);
  };
  const requireRunning = () => {
    if (busy) throw new Error('Module lifecycle reentry is forbidden.');
    if (status !== 'running') throw new Error(`Module lifecycle is not running: ${status}`);
  };
  const stop = () => {
    const failures: string[] = [];
    for (const { moduleId, definition } of started.splice(0).reverse()) {
      try {
        if (definition.stopOperationId) invoke(moduleId, definition.stopOperationId);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (failures.length) throw new Error(failures.join('; '));
  };
  return Object.freeze({
    start() {
      if (busy) throw new Error('Module lifecycle reentry is forbidden.');
      if (status !== 'created') throw new Error(`Cannot start module lifecycle: ${status}`);
      try {
        for (const entry of lifecycles) {
          if (entry.definition.startOperationId) invoke(entry.moduleId, entry.definition.startOperationId);
          started.push(entry);
        }
        status = 'running';
      } catch (error) {
        status = 'failed';
        try {
          stop();
        } catch (cleanup) {
          throw new Error(`Module startup and cleanup failed: ${String(error)}; ${String(cleanup)}`, {
            cause: cleanup,
          });
        }
        throw error;
      }
    },
    advance(seconds: number) {
      requireRunning();
      if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(time + seconds))
        throw new TypeError('Module logical advance must be finite and non-negative.');
      let count = 0;
      const due = systems.map(({ moduleId, definition }) => {
        const elapsed = round(remainders.get(definition.id)! + seconds);
        const ticks = Math.floor(round(elapsed / definition.intervalSeconds));
        count += ticks;
        return { moduleId, definition, ticks, remainder: round(elapsed - ticks * definition.intervalSeconds) };
      });
      if (count > MAX_OPERATIONS_PER_ADVANCE)
        throw new RangeError('Module schedule catch-up exceeds operation budget.');
      try {
        const events = due.flatMap((entry, order) =>
          Array.from({ length: entry.ticks }, (_, index) => ({
            entry,
            order,
            at: round((index + 1) * entry.definition.intervalSeconds - remainders.get(entry.definition.id)!),
          })),
        );
        events.sort((a, b) => a.at - b.at || a.order - b.order);
        for (const { entry } of events)
          invoke(entry.moduleId, entry.definition.operationId, entry.definition.intervalSeconds);
        for (const entry of due) remainders.set(entry.definition.id, entry.remainder);
        time = round(time + seconds);
      } catch (error) {
        status = 'failed';
        throw error;
      }
    },
    snapshot(): ModuleScheduleSnapshot {
      requireRunning();
      return {
        version: 1,
        time,
        systems: systems.map(({ definition }) => ({ id: definition.id, remainder: remainders.get(definition.id)! })),
      };
    },
    restore(snapshot: ModuleScheduleSnapshot) {
      requireRunning();
      if (
        snapshot.version !== 1 ||
        !Number.isFinite(snapshot.time) ||
        snapshot.time < 0 ||
        snapshot.systems.length !== systems.length
      )
        throw new TypeError('Module schedule snapshot is invalid.');
      for (let index = 0; index < systems.length; index++) {
        const saved = snapshot.systems[index],
          definition = systems[index].definition;
        if (
          saved.id !== definition.id ||
          !Number.isFinite(saved.remainder) ||
          saved.remainder < 0 ||
          saved.remainder >= definition.intervalSeconds
        )
          throw new TypeError(`Module schedule entry is invalid: ${definition.id}`);
      }
      time = snapshot.time;
      snapshot.systems.forEach((entry) => remainders.set(entry.id, entry.remainder));
    },
    dispose() {
      if (busy) throw new Error('Module lifecycle reentry is forbidden.');
      if (status === 'disposed') return;
      status = 'disposed';
      stop();
    },
  });
}
