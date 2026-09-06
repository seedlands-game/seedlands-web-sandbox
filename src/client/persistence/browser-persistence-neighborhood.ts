import { chunkKey } from '../../world/voxel';

export type BrowserPersistenceLoadCoordinate = Readonly<{ cx: number; cy: number; cz: number }>;

export function prepareBrowserPersistenceNeighborhood(
  cx: number,
  cy: number,
  cz: number,
  residentKeys: readonly string[],
): Readonly<{
  coordinates: readonly BrowserPersistenceLoadCoordinate[];
  residentKeys: ReadonlySet<string>;
}> {
  const coordinates: BrowserPersistenceLoadCoordinate[] = [];
  for (let y = cy - 1; y <= cy + 1; y += 1)
    for (let z = cz - 1; z <= cz + 1; z += 1)
      for (let x = cx - 1; x <= cx + 1; x += 1) coordinates.push({ cx: x, cy: y, cz: z });
  if (residentKeys.length > coordinates.length)
    throw new RangeError(`Authority resident keys must contain at most ${coordinates.length} entries.`);
  const neighborhood = new Set(coordinates.map(({ cx: x, cy: y, cz: z }) => chunkKey(x, y, z)));
  const resident = new Set<string>();
  residentKeys.forEach((key) => {
    if (!neighborhood.has(key))
      throw new RangeError(`Authority resident key is outside the requested neighborhood: ${key}.`);
    if (resident.has(key)) throw new RangeError(`Authority resident key is duplicated: ${key}.`);
    resident.add(key);
  });
  return { coordinates, residentKeys: resident };
}
