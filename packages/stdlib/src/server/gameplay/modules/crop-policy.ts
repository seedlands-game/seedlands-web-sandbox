export type CropPolicy = Readonly<{
  presentationId?: string;
  soilVoxels: readonly number[];
  emptyAboveVoxels: readonly number[];
  waterVoxels: readonly number[];
  seedItemId: string;
  matureDrops: readonly Readonly<{ itemId: string; count: number }>[];
  immatureDrops: readonly Readonly<{ itemId: string; count: number }>[];
  fertilizer?: Readonly<{ itemId: string; growthStages: number }>;
}>;

export function freezeCropPolicy(policy: CropPolicy): CropPolicy {
  const voxels = (values: readonly number[]) => {
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.length > 512 ||
      values.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 65535) ||
      new Set(values).size !== values.length
    )
      throw new TypeError('Crop voxel policy is invalid.');
    return Object.freeze([...values]);
  };
  const itemId = (value: string) => {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._/-]*)?$/.test(value))
      throw new TypeError('Crop item identity is invalid.');
    return value;
  };
  const drops = (values: CropPolicy['matureDrops']) => {
    if (!Array.isArray(values) || !values.length || values.length > 64)
      throw new TypeError('Crop drop policy is invalid.');
    return Object.freeze(
      values.map((drop) => {
        if (!Number.isSafeInteger(drop.count) || drop.count < 1 || drop.count > 65535)
          throw new TypeError('Crop drop count is invalid.');
        return Object.freeze({ itemId: itemId(drop.itemId), count: drop.count });
      }),
    );
  };
  const fertilizer = policy.fertilizer;
  const presentationId = policy.presentationId;
  if (
    presentationId !== undefined &&
    (typeof presentationId !== 'string' ||
      presentationId.length > 128 ||
      !/^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._/-]*)?$/.test(presentationId))
  )
    throw new TypeError('Crop presentation identity is invalid.');
  if (
    fertilizer &&
    (!Number.isSafeInteger(fertilizer.growthStages) || fertilizer.growthStages < 1 || fertilizer.growthStages > 7)
  )
    throw new TypeError('Crop fertilizer growth policy is invalid.');
  return Object.freeze({
    ...(presentationId !== undefined ? { presentationId } : {}),
    soilVoxels: voxels(policy.soilVoxels),
    emptyAboveVoxels: voxels(policy.emptyAboveVoxels),
    waterVoxels: voxels(policy.waterVoxels),
    seedItemId: itemId(policy.seedItemId),
    matureDrops: drops(policy.matureDrops),
    immatureDrops: drops(policy.immatureDrops),
    ...(fertilizer
      ? { fertilizer: Object.freeze({ itemId: itemId(fertilizer.itemId), growthStages: fertilizer.growthStages }) }
      : {}),
  });
}
