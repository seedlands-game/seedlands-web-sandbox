import type { CoreUtf8Port } from '../../runtime/platform-ports';

/** Conservative byte accounting for immutable compute task snapshots and candidates. */
export function measureDedicatedComputeBytes(value: unknown, utf8: CoreUtf8Port, seen = new Set<object>()): number {
  if (value === null || value === undefined) return 4;
  if (typeof value === 'boolean') return 4;
  if (typeof value === 'number') return 8;
  if (typeof value === 'string') return utf8.encode(value).byteLength + 4;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value))
    return 8 + value.reduce((total, entry) => total + measureDedicatedComputeBytes(entry, utf8, seen), 0);
  return (
    8 +
    Object.entries(value).reduce(
      (total, [key, entry]) => total + utf8.encode(key).byteLength + measureDedicatedComputeBytes(entry, utf8, seen),
      0,
    )
  );
}
