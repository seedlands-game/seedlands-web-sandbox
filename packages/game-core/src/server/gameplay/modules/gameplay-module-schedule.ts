import type { WorldComposition } from '../../composition/contracts';
import { createModuleLifecycle } from '../../composition/module-lifecycle';
import type { ModuleScheduleSnapshot } from '../../composition/lifecycle-contracts';
import type { WorldResourceAuthorizer } from '../../harness/world-authorization';
import type { GameplayModuleRuntime } from './gameplay-module-runtime';

/** Supplied by the host policy; Pack permission requests cannot grant this authority. */
export type ModuleSystemAuthority = Readonly<{ authorizer: WorldResourceAuthorizer; principalId: string }>;

const field = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor && !('value' in descriptor)) throw new TypeError('Gameplay schedule accessors are forbidden.');
  return descriptor?.value;
};

export function createGameplayModuleSchedule(
  composition: WorldComposition,
  modules: GameplayModuleRuntime,
  authority?: ModuleSystemAuthority,
  afterSystem?: () => void,
) {
  let active = false;
  let disposed = false;
  let failed = false;
  const lifecycle = createModuleLifecycle({
    composition,
    invoke(moduleId, request, systemId) {
      if (!authority)
        return {
          ok: false,
          code: 'SYSTEM_AUTHORITY_MISSING',
          message: 'Host scheduled operation authority is missing.',
        };
      const execution = modules.bindSystem(authority.authorizer, {
        kind: 'system',
        moduleId,
        principalId: authority.principalId,
        systemId,
      });
      try {
        const result = execution.invoke(request);
        if (result.ok) afterSystem?.();
        return result;
      } finally {
        execution.dispose();
      }
    },
  });
  const activate = () => {
    if (disposed) throw new Error('Gameplay schedule is disposed.');
    if (!active) {
      try {
        lifecycle.activateFresh();
        active = true;
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const assertAdvance = (seconds: number) => {
    if (disposed || failed) throw new Error('Gameplay schedule is unavailable.');
    const units = Math.round(seconds * 1e9);
    if (
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      Object.is(seconds, -0) ||
      !Number.isSafeInteger(units) ||
      (seconds > 0 && units === 0) ||
      !Number.isSafeInteger(Math.round((active ? lifecycle.time : 0) * 1e9) + units)
    )
      throw new RangeError('Gameplay schedule advance exceeds precision or range.');
    return units / 1e9;
  };
  return Object.freeze({
    activate,
    assertAdvance,
    get time() {
      return active ? lifecycle.time : 0;
    },
    advance(seconds: number) {
      const canonical = assertAdvance(seconds);
      activate();
      try {
        lifecycle.advance(canonical);
      } catch (error) {
        failed = true;
        throw error;
      }
      return canonical;
    },
    snapshot() {
      activate();
      return lifecycle.snapshot();
    },
    prepareRestore(raw: unknown) {
      if (disposed || failed) throw new Error('Gameplay schedule is unavailable.');
      if (!raw || typeof raw !== 'object') throw new TypeError('Gameplay schedule header is invalid.');
      const time = field(raw, 'gameplayTime');
      if (typeof time !== 'number' || !Number.isFinite(time) || time < 0)
        throw new TypeError('Gameplay schedule time is invalid.');
      const sourceVersion = field(raw, 'version');
      const legacy = sourceVersion === 1 || sourceVersion === 2 || sourceVersion === 3;
      const schedule = legacy
        ? {
            version: 1 as const,
            time: Math.round(time * 1e9) / 1e9,
            systems: composition.registrations.systems.map(({ definition }) => ({
              id: definition.id,
              remainder:
                definition.cadence === 'every-advance'
                  ? 0
                  : (Math.round(time * 1e9) % Math.round(definition.intervalSeconds * 1e9)) / 1e9,
            })),
          }
        : (field(raw, 'moduleSchedule') as ModuleScheduleSnapshot);
      lifecycle.validate(schedule);
      if (!legacy && schedule.time !== time) throw new TypeError('Gameplay and module schedule frontiers differ.');
      const candidate: ModuleScheduleSnapshot = {
        version: 1,
        time: schedule.time,
        systems: schedule.systems.map(({ id, remainder }) => ({ id, remainder })),
      };
      return () => {
        if (active) lifecycle.restore(candidate);
        else {
          lifecycle.resume(candidate);
          active = true;
        }
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      lifecycle.dispose();
    },
  });
}
