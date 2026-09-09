import type { WorldComposition } from './contracts';
import type { ModSystemDefinition, ModuleScheduleSnapshot } from './lifecycle-contracts';
import type { RegisteredOperationRequest, RegisteredOperationResult } from './operation-contracts';

const TIME_SCALE = 1e9;
const MAX_OPERATIONS_PER_ADVANCE = 256;
const TOP_LEVEL_KEYS = ['systems', 'time', 'version'] as const;
const ENTRY_KEYS = ['id', 'remainder'] as const;

type ScheduleEntry = Readonly<{
  id: string;
  remainderUnits: number;
}>;
type DueEvent = Readonly<{
  moduleId: string;
  systemId: string;
  operationId: string;
  seconds: number;
  atUnits: number;
  order: number;
}>;

const exactObject = (value: unknown, keys: readonly string[], label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`Module schedule ${label} is invalid.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`Module schedule ${label} is invalid.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || keys.some((key) => !actual.includes(key)))
    throw new TypeError(`Module schedule ${label} has unknown or missing fields.`);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor))
      throw new TypeError(`Module schedule ${label} cannot contain accessor fields.`);
    result[key] = descriptor.value;
  }
  return result;
};

const denseArray = (value: unknown, length: number): readonly unknown[] => {
  if (!Array.isArray(value) || value.length !== length) throw new TypeError('Module schedule systems are incomplete.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors).filter((key) => key !== 'length');
  const expected = Array.from({ length }, (_, index) => String(index));
  if (actual.length !== length || !expected.every((key) => actual.includes(key)))
    throw new TypeError('Module schedule systems must be a dense array without extra fields.');
  return expected.map((key) => {
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor))
      throw new TypeError('Module schedule systems cannot contain accessor entries.');
    return descriptor.value;
  });
};

const secondsToUnits = (value: unknown, label: string, allowZero: boolean): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0) || value < 0)
    throw new TypeError(`Module ${label} must be finite and non-negative.`);
  const units = Math.round(value * TIME_SCALE);
  if (!Number.isSafeInteger(units) || (!allowZero && units <= 0) || (value > 0 && units === 0))
    throw new RangeError(`Module ${label} exceeds schedule precision or range.`);
  return units;
};

const canonicalSnapshotUnits = (value: unknown, label: string): number => {
  const units = secondsToUnits(value, `schedule ${label}`, true);
  if (units / TIME_SCALE !== value) throw new TypeError(`Module schedule ${label} is not canonical.`);
  return units;
};

const intervalUnits = (definition: ModSystemDefinition): number => {
  if (definition.cadence === 'every-advance') return 0;
  return secondsToUnits(definition.intervalSeconds, `system interval ${definition.id}`, false);
};

/** Logical scheduling only. The host binds each module to its approved service principal. */
export function createModuleLifecycle(
  options: Readonly<{
    composition: WorldComposition;
    invoke(moduleId: string, request: RegisteredOperationRequest, systemId: string): RegisteredOperationResult;
  }>,
) {
  const { systems, lifecycles } = options.composition.registrations;
  const intervals = new Map(systems.map(({ definition }) => [definition.id, intervalUnits(definition)]));
  const remainders = new Map(systems.map(({ definition }) => [definition.id, 0]));
  let status: 'created' | 'running' | 'failed' | 'disposed' = 'created';
  let timeUnits = 0;
  let busy = false;
  const active: (typeof lifecycles)[number][] = [];

  const rejectReentry = () => {
    if (busy) throw new Error('Module lifecycle reentry is forbidden.');
  };
  const requireRunning = () => {
    rejectReentry();
    if (status !== 'running') throw new Error(`Module lifecycle is not running: ${status}`);
  };
  const invoke = (moduleId: string, operationId: string, seconds?: number, systemId = `${moduleId}/lifecycle`) => {
    busy = true;
    let result: RegisteredOperationResult;
    try {
      result = options.invoke(
        moduleId,
        {
          operationId,
          target: { kind: 'world' },
          ...(seconds === undefined ? {} : { input: { seconds } }),
        },
        systemId,
      );
    } finally {
      busy = false;
    }
    if (!result.ok) throw new Error(`Module lifecycle failed: ${operationId}: ${result.code}: ${result.message}`);
  };
  const stopActive = () => {
    const failures: string[] = [];
    for (const { moduleId, definition } of active.splice(0).reverse()) {
      try {
        if (definition.stopOperationId) invoke(moduleId, definition.stopOperationId);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (failures.length) throw new Error(failures.join('; '));
  };
  const validateSnapshot = (
    snapshot: ModuleScheduleSnapshot,
  ): Readonly<{ timeUnits: number; entries: ScheduleEntry[] }> => {
    const root = exactObject(snapshot, TOP_LEVEL_KEYS, 'snapshot');
    if (root.version !== 1) throw new TypeError('Module schedule version is invalid.');
    const candidateTime = canonicalSnapshotUnits(root.time, 'time');
    const savedSystems = denseArray(root.systems, systems.length);
    const seen = new Set<string>();
    const entries = systems.map(({ definition }, index) => {
      const saved = exactObject(savedSystems[index], ENTRY_KEYS, 'entry');
      if (typeof saved.id !== 'string' || seen.has(saved.id) || saved.id !== definition.id)
        throw new TypeError(`Module schedule system order is invalid: ${definition.id}`);
      seen.add(saved.id);
      const remainderUnits = canonicalSnapshotUnits(saved.remainder, `remainder ${definition.id}`);
      const interval = intervals.get(definition.id)!;
      if (
        (definition.cadence === 'every-advance' && remainderUnits !== 0) ||
        (definition.cadence !== 'every-advance' && remainderUnits >= interval)
      )
        throw new TypeError(`Module schedule entry is invalid: ${definition.id}`);
      return { id: definition.id, remainderUnits };
    });
    return { timeUnits: candidateTime, entries };
  };
  const install = (schedule: ReturnType<typeof validateSnapshot>) => {
    timeUnits = schedule.timeUnits;
    for (const entry of schedule.entries) remainders.set(entry.id, entry.remainderUnits);
  };
  const activateFresh = () => {
    rejectReentry();
    if (status !== 'created') throw new Error(`Cannot activate module lifecycle: ${status}`);
    try {
      for (const entry of lifecycles) {
        if (entry.definition.startOperationId) invoke(entry.moduleId, entry.definition.startOperationId);
        active.push(entry);
      }
      status = 'running';
    } catch (error) {
      status = 'failed';
      try {
        stopActive();
      } catch (cleanup) {
        throw new Error(`Module startup and cleanup failed: ${String(error)}; ${String(cleanup)}`, {
          cause: cleanup,
        });
      }
      throw error;
    }
  };

  return Object.freeze({
    activateFresh,
    start: activateFresh,
    validate(snapshot: ModuleScheduleSnapshot): void {
      rejectReentry();
      validateSnapshot(snapshot);
    },
    resume(snapshot: ModuleScheduleSnapshot) {
      rejectReentry();
      if (status !== 'created') throw new Error(`Cannot resume module lifecycle: ${status}`);
      const schedule = validateSnapshot(snapshot);
      install(schedule);
      active.push(...lifecycles);
      status = 'running';
    },
    advance(seconds: number) {
      requireRunning();
      const elapsedUnits = secondsToUnits(seconds, 'logical advance', true);
      if (elapsedUnits === 0) return;
      if (!Number.isSafeInteger(timeUnits + elapsedUnits))
        throw new RangeError('Module logical advance exceeds schedule precision or range.');
      let count = 0;
      const nextRemainders = new Map<string, number>();
      const events: DueEvent[] = [];
      for (let order = 0; order < systems.length; order++) {
        const { moduleId, definition } = systems[order];
        if (definition.cadence === 'every-advance') {
          count += 1;
          events.push({
            moduleId,
            systemId: definition.id,
            operationId: definition.operationId,
            seconds: elapsedUnits / TIME_SCALE,
            atUnits: elapsedUnits,
            order,
          });
          nextRemainders.set(definition.id, 0);
          continue;
        }
        const previous = remainders.get(definition.id)!;
        const elapsed = previous + elapsedUnits;
        if (!Number.isSafeInteger(elapsed))
          throw new RangeError('Module logical advance exceeds schedule precision or range.');
        const interval = intervals.get(definition.id)!;
        const ticks = Math.floor(elapsed / interval);
        count += ticks;
        if (count > MAX_OPERATIONS_PER_ADVANCE)
          throw new RangeError('Module schedule catch-up exceeds operation budget.');
        for (let index = 0; index < ticks; index++)
          events.push({
            moduleId,
            systemId: definition.id,
            operationId: definition.operationId,
            seconds: interval / TIME_SCALE,
            atUnits: (index + 1) * interval - previous,
            order,
          });
        nextRemainders.set(definition.id, elapsed - ticks * interval);
      }
      if (count > MAX_OPERATIONS_PER_ADVANCE)
        throw new RangeError('Module schedule catch-up exceeds operation budget.');
      events.sort((left, right) => left.atUnits - right.atUnits || left.order - right.order);
      try {
        for (const event of events) invoke(event.moduleId, event.operationId, event.seconds, event.systemId);
        for (const [id, remainder] of nextRemainders) remainders.set(id, remainder);
        timeUnits += elapsedUnits;
      } catch (error) {
        status = 'failed';
        throw error;
      }
    },
    get time() {
      requireRunning();
      return timeUnits / TIME_SCALE;
    },
    snapshot(): ModuleScheduleSnapshot {
      requireRunning();
      return {
        version: 1,
        time: timeUnits / TIME_SCALE,
        systems: systems.map(({ definition }) => ({
          id: definition.id,
          remainder: definition.cadence === 'every-advance' ? 0 : remainders.get(definition.id)! / TIME_SCALE,
        })),
      };
    },
    restore(snapshot: ModuleScheduleSnapshot) {
      requireRunning();
      install(validateSnapshot(snapshot));
    },
    dispose() {
      rejectReentry();
      if (status === 'disposed') return;
      status = 'disposed';
      stopActive();
    },
  });
}
