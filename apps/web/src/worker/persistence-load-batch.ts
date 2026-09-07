export const MAX_PERSISTENCE_LOAD_BATCH = 27;

export type PersistenceLoadCoordinate = Readonly<{ cx: number; cy: number; cz: number }>;

export function validatePersistenceLoadBatch(
  coordinates: readonly PersistenceLoadCoordinate[],
): readonly PersistenceLoadCoordinate[] {
  if (!Array.isArray(coordinates) || !coordinates.length || coordinates.length > MAX_PERSISTENCE_LOAD_BATCH)
    throw new RangeError(`Persistence load batch must contain 1..${MAX_PERSISTENCE_LOAD_BATCH} coordinates.`);
  const keys = new Set<string>();
  for (const coordinate of coordinates) {
    if (!coordinate || typeof coordinate !== 'object')
      throw new TypeError('Persistence load batch coordinates must be objects.');
    if (![coordinate.cx, coordinate.cy, coordinate.cz].every(Number.isSafeInteger))
      throw new TypeError('Persistence load batch coordinates must be safe integers.');
    const key = `${coordinate.cx},${coordinate.cy},${coordinate.cz}`;
    if (keys.has(key)) throw new TypeError(`Duplicate persistence load coordinate: ${key}.`);
    keys.add(key);
  }
  return coordinates;
}
