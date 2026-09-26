import {
  cloneMediaDeviceInstanceV1,
  type MediaPlaybackActionV1,
  type MediaPlaybackFactV1,
  type MediaPlaybackProjectionV1,
  type MediaPlaybackSlotV1,
  type MediaResourceReferenceV1,
} from './media-playback-model';

const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const RESOURCE_PATH_SEGMENT = /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/;
const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} is invalid.`);
  return value as Record<string, unknown>;
};
const exactKeys = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw new TypeError(`${label} has an invalid shape.`);
};
const namespaceId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length > 128 || !NAMESPACE_ID.test(value))
    throw new TypeError(`${label} is invalid.`);
  return value;
};
const resource = (raw: unknown): MediaResourceReferenceV1 => {
  const value = record(raw, 'Media track resource');
  exactKeys(value, ['packId', 'path'], 'Media track resource');
  const path = typeof value.path === 'string' && value.path.startsWith('./') ? value.path.slice(2) : value.path;
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.length > 256 ||
    path.split('/').some((part) => !RESOURCE_PATH_SEGMENT.test(part))
  )
    throw new TypeError('Media track resource is invalid.');
  return Object.freeze({ packId: namespaceId(value.packId, 'Media track resource pack id'), path });
};
const slot = (raw: unknown): MediaPlaybackSlotV1 => {
  const value = record(raw, 'Media playback projection slot');
  exactKeys(value, ['itemId', 'trackId'], 'Media playback projection slot');
  return Object.freeze({
    itemId: namespaceId(value.itemId, 'Media playback projection item id'),
    trackId: namespaceId(value.trackId, 'Media playback projection track id'),
  });
};

export function cloneMediaPlaybackProjectionV1(raw: unknown): MediaPlaybackProjectionV1 {
  const source = record(raw, 'Media playback projection');
  exactKeys(
    source,
    ['version', 'device', 'revision', 'slot', 'resource', 'playing', 'resumePending'],
    'Media playback projection',
  );
  if (
    source.version !== 1 ||
    !Number.isSafeInteger(source.revision) ||
    (source.revision as number) < 0 ||
    typeof source.playing !== 'boolean' ||
    typeof source.resumePending !== 'boolean' ||
    (source.playing && source.resumePending)
  )
    throw new TypeError('Media playback projection state is invalid.');
  const device = cloneMediaDeviceInstanceV1(source.device);
  const currentSlot = source.slot === null ? null : slot(source.slot);
  if (!currentSlot && (source.playing || source.resumePending))
    throw new TypeError('Empty media playback projection cannot be active.');
  const currentResource = source.resource === null ? null : resource(source.resource);
  if (Boolean(currentSlot) !== Boolean(currentResource))
    throw new TypeError('Media playback projection slot and resource must be present together.');
  return Object.freeze({
    version: 1,
    device,
    revision: source.revision as number,
    slot: currentSlot,
    resource: currentResource,
    playing: source.playing,
    resumePending: source.resumePending,
  });
}

export function cloneMediaPlaybackFactV1(raw: unknown): MediaPlaybackFactV1 {
  const source = record(raw, 'Media playback fact');
  const optional = ['insertedItemId', 'ejectedItemId'].filter((key) => Object.hasOwn(source, key));
  exactKeys(
    source,
    [
      'version',
      'kind',
      'device',
      'revision',
      'previousTrackId',
      'trackId',
      'resource',
      'playing',
      'resumePending',
      ...optional,
    ],
    'Media playback fact',
  );
  if (
    source.version !== 1 ||
    !['insert', 'insert-and-activate', 'eject', 'activate', 'stop', 'switch'].includes(String(source.kind)) ||
    !Number.isSafeInteger(source.revision) ||
    (source.revision as number) < 1 ||
    typeof source.playing !== 'boolean' ||
    typeof source.resumePending !== 'boolean' ||
    (source.playing && source.resumePending)
  )
    throw new TypeError('Media playback fact state is invalid.');
  const nullableId = (value: unknown, label: string) => (value === null ? null : namespaceId(value, label));
  const currentResource = source.resource === null ? null : resource(source.resource);
  const previousTrackId = nullableId(source.previousTrackId, 'Media playback previous track id');
  const trackId = nullableId(source.trackId, 'Media playback track id');
  if (Boolean(trackId) !== Boolean(currentResource) || (!trackId && (source.playing || source.resumePending)))
    throw new TypeError('Media playback fact track and resource are inconsistent.');
  return Object.freeze({
    version: 1,
    kind: source.kind as MediaPlaybackActionV1['kind'],
    device: cloneMediaDeviceInstanceV1(source.device),
    revision: source.revision as number,
    previousTrackId,
    trackId,
    resource: currentResource,
    playing: source.playing,
    resumePending: source.resumePending,
    ...(source.insertedItemId === undefined
      ? {}
      : { insertedItemId: namespaceId(source.insertedItemId, 'Media playback inserted item id') }),
    ...(source.ejectedItemId === undefined
      ? {}
      : { ejectedItemId: namespaceId(source.ejectedItemId, 'Media playback ejected item id') }),
  });
}
