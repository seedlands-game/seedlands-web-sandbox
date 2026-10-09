export const NAVIGATION_ITEMS_CAPABILITY = 'seedlands:navigation-items';

export type NavigationItemsPolicyV1 = Readonly<{
  version: 1;
  mapItemId: string;
  compassItemId: string;
  clockItemId: string;
  windowRadius: number;
  sampleYOffset: number;
  fallbackColor: number;
  palette: readonly Readonly<{ voxel: number; color: number }>[];
}>;

/** Creates a detached canonical policy. Palette ordering is by voxel ID. */
export function freezeNavigationPolicy(value: NavigationItemsPolicyV1): NavigationItemsPolicyV1 {
  if (!value || typeof value !== 'object' || value.version !== 1)
    throw new TypeError('Navigation policy version is invalid.');

  const itemIds = [value.mapItemId, value.compassItemId, value.clockItemId];
  if (
    itemIds.some((id) => typeof id !== 'string' || id.trim().length === 0) ||
    new Set(itemIds).size !== itemIds.length
  )
    throw new TypeError('Navigation item identities are invalid.');
  if (!Number.isSafeInteger(value.windowRadius) || value.windowRadius < 0 || value.windowRadius > 4)
    throw new TypeError('Navigation window radius is invalid.');
  if (!Number.isSafeInteger(value.sampleYOffset) || value.sampleYOffset < -64 || value.sampleYOffset > 64)
    throw new TypeError('Navigation sample offset is invalid.');
  const color = (candidate: number) => Number.isSafeInteger(candidate) && candidate >= 0 && candidate <= 15;
  if (!color(value.fallbackColor)) throw new TypeError('Navigation fallback color is invalid.');
  if (!Array.isArray(value.palette) || value.palette.length > 65_536)
    throw new TypeError('Navigation palette is invalid.');
  for (let index = 0; index < value.palette.length; index++)
    if (!Object.prototype.hasOwnProperty.call(value.palette, index))
      throw new TypeError('Navigation palette must be dense.');

  const voxels = new Set<number>();
  const palette = value.palette.map(({ voxel, color: paletteColor }) => {
    if (!Number.isSafeInteger(voxel) || voxel < 0 || voxel > 65535 || !color(paletteColor) || voxels.has(voxel))
      throw new TypeError('Navigation palette entry is invalid.');
    voxels.add(voxel);
    return Object.freeze({ voxel, color: paletteColor });
  });
  palette.sort((left, right) => left.voxel - right.voxel);

  return Object.freeze({
    version: 1,
    mapItemId: value.mapItemId,
    compassItemId: value.compassItemId,
    clockItemId: value.clockItemId,
    windowRadius: value.windowRadius,
    sampleYOffset: value.sampleYOffset,
    fallbackColor: value.fallbackColor,
    palette: Object.freeze(palette),
  });
}
