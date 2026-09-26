export const LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN = 'LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN';
export const LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN_MESSAGE =
  '无法确认此旧存档的玩法版本，原存档未修改。可返回世界列表，保留旧档并使用其他种子创建新世界。';

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const ownData = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const isLegacyGameplaySnapshot = (snapshot: object, version: 1 | 2 | 3): boolean => {
  if (
    !Number.isSafeInteger(ownData(snapshot, 'revision')) ||
    !Number.isFinite(ownData(snapshot, 'gameplayTime')) ||
    !Number.isSafeInteger(ownData(snapshot, 'entitySequence')) ||
    !Array.isArray(ownData(snapshot, 'entities')) ||
    !Array.isArray(ownData(snapshot, 'players'))
  )
    return false;
  if (version === 1) return true;
  const simulation = ownData(snapshot, 'simulation');
  if (!Number.isFinite(ownData(snapshot, 'worldTime')) || !isRecord(simulation)) return false;
  if (version === 2) return true;
  const coordinateSchema = ownData(snapshot, 'coordinateSchema');
  const physicsSchema = ownData(snapshot, 'physicsSchema');
  return Boolean(
    isRecord(coordinateSchema) &&
    ownData(coordinateSchema, 'version') === 1 &&
    ownData(coordinateSchema, 'units') === 'voxel' &&
    ownData(coordinateSchema, 'entityOrigin') === 'body-feet-center' &&
    isRecord(physicsSchema) &&
    ownData(physicsSchema, 'version') === 1 &&
    ownData(physicsSchema, 'bodyRegistryVersion') === 1,
  );
};

export class LegacyGameplayProvenanceUnknownError extends Error {
  readonly code = LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN;

  constructor() {
    super(`${LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN}: Browser Gameplay V1-V3 has no trusted source identity.`);
    this.name = 'LegacyGameplayProvenanceUnknownError';
  }
}

export function assertBrowserGameplayProvenance(snapshot: unknown): void {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
  const version = ownData(snapshot, 'version');
  if ((version === 1 || version === 2 || version === 3) && isLegacyGameplaySnapshot(snapshot, version))
    throw new LegacyGameplayProvenanceUnknownError();
}

export const isLegacyGameplayProvenanceUnknown = (error: unknown): boolean => {
  const message = errorText(error);
  return message === LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN || message.startsWith(`${LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN}:`);
};

export const browserGameplayFailureMessage = (error: unknown): string =>
  isLegacyGameplayProvenanceUnknown(error) ? LEGACY_GAMEPLAY_PROVENANCE_UNKNOWN_MESSAGE : errorText(error);
