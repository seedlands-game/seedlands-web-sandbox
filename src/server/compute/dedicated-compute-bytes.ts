const encoder = new TextEncoder();

/** Conservative byte accounting for immutable compute task snapshots and candidates. */
export function measureDedicatedComputeBytes(value: unknown, seen = new Set<object>()): number {
  if (value === null || value === undefined) return 4;
  if (typeof value === 'boolean') return 4;
  if (typeof value === 'number') return 8;
  if (typeof value === 'string') return encoder.encode(value).byteLength + 4;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value !== 'object') return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (Array.isArray(value))
    return 8 + value.reduce((total, entry) => total + measureDedicatedComputeBytes(entry, seen), 0);
  return (
    8 +
    Object.entries(value).reduce(
      (total, [key, entry]) => total + encoder.encode(key).byteLength + measureDedicatedComputeBytes(entry, seen),
      0,
    )
  );
}
