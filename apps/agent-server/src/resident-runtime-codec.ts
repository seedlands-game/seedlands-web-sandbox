export type ResidentScheduleSnapshot = Readonly<{
  version: 1;
  fallbackSeconds: number;
  remainingMs: number;
  paused: boolean;
  blocked: boolean;
  inFlight: boolean;
  pendingReasons: readonly string[];
  episodes: readonly (readonly [string, number])[];
}>;
export type ResidentRuntimeSnapshot = Readonly<{ version: 1; scheduler: ResidentScheduleSnapshot }>;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

/** Validate before any timer, recovery callback or persistent import can consume this state. */
export function parseResidentSchedule(value: unknown): ResidentScheduleSnapshot {
  if (
    !object(value) ||
    value.version !== 1 ||
    typeof value.fallbackSeconds !== 'number' ||
    !Number.isFinite(value.fallbackSeconds) ||
    value.fallbackSeconds < 60 ||
    value.fallbackSeconds > 600 ||
    typeof value.remainingMs !== 'number' ||
    !Number.isFinite(value.remainingMs) ||
    value.remainingMs < 0 ||
    value.remainingMs > value.fallbackSeconds * 1000 ||
    typeof value.paused !== 'boolean' ||
    typeof value.blocked !== 'boolean' ||
    typeof value.inFlight !== 'boolean' ||
    !Array.isArray(value.pendingReasons) ||
    value.pendingReasons.length > 32 ||
    !value.pendingReasons.every((reason) => text(reason, 160)) ||
    new Set(value.pendingReasons).size !== value.pendingReasons.length ||
    !Array.isArray(value.episodes) ||
    value.episodes.length > 128
  )
    throw new TypeError('Invalid resident wake schedule snapshot');
  const sources = new Set<string>();
  const episodes: [string, number][] = [];
  for (const entry of value.episodes) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !text(entry[0], 128) ||
      typeof entry[1] !== 'number' ||
      !Number.isSafeInteger(entry[1]) ||
      entry[1] < 0 ||
      sources.has(entry[0])
    )
      throw new TypeError('Invalid resident wake episode snapshot');
    sources.add(entry[0]);
    episodes.push([entry[0], entry[1]]);
  }
  return {
    version: 1,
    fallbackSeconds: value.fallbackSeconds,
    remainingMs: value.remainingMs,
    paused: value.paused,
    blocked: value.blocked,
    inFlight: value.inFlight,
    pendingReasons: [...value.pendingReasons] as string[],
    episodes,
  };
}

/** Empty metadata is only the explicit, never-run workspace initialization state. */
export function parseResidentRuntime(
  snapshot: unknown,
  metadata: Readonly<{ revision: unknown; logicalRounds: unknown; compactions: unknown }>,
  journalIsEmpty = true,
): ResidentScheduleSnapshot | undefined {
  // PostgreSQL bigint columns are strings in portable rows, numbers in the runtime API.
  const equals = (value: unknown, expected: number) => value === expected || value === String(expected);
  if (
    object(snapshot) &&
    Object.keys(snapshot).length === 0 &&
    equals(metadata.revision, 1) &&
    equals(metadata.logicalRounds, 0) &&
    equals(metadata.compactions, 0) &&
    journalIsEmpty
  )
    return undefined;
  if (!object(snapshot) || snapshot.version !== 1) throw new TypeError('Unsupported resident runtime snapshot');
  return parseResidentSchedule(snapshot.scheduler);
}
