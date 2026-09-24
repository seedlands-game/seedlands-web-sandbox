const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const RESOURCE_PATH_SEGMENT = /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/;
const MAX_ID_LENGTH = 128;
const MAX_RESOURCE_PATH_LENGTH = 256;
const MAX_TRACKS = 64;
const MAX_DEVICES = 64;
const MAX_BINDINGS_PER_DEVICE = 64;
const MAX_WORLD_COORDINATE = 30_000_000;

export type MediaResourceReferenceV1 = Readonly<{ packId: string; path: string }>;
export type MediaDeviceInstanceV1 = Readonly<{
  kind: 'voxel';
  position: readonly [number, number, number];
  definitionId: string;
}>;
export type MediaTrackDefinitionV1 = Readonly<{ id: string; resource: MediaResourceReferenceV1 }>;
export type MediaDeviceTrackBindingV1 = Readonly<{ itemId: string; trackId: string }>;
export type MediaDeviceTargetSelectorV1 = Readonly<{ kind: 'voxel'; voxelId: string }>;
export type MediaDeviceDefinitionV1 = Readonly<{
  id: string;
  target: MediaDeviceTargetSelectorV1;
  tracks: readonly MediaDeviceTrackBindingV1[];
  playOnInsert?: true;
}>;
export type MediaPlaybackModelV1 = Readonly<{
  version: 1;
  tracks: readonly MediaTrackDefinitionV1[];
  devices: readonly MediaDeviceDefinitionV1[];
}>;

export type MediaPlaybackSlotV1 = Readonly<{ itemId: string; trackId: string }>;
export type MediaPlaybackStateV1 = Readonly<{
  version: 1;
  deviceId: string;
  revision: number;
  slot: MediaPlaybackSlotV1 | null;
  playing: boolean;
  resumePending: boolean;
}>;
export type MediaPlaybackSnapshotV1 = Readonly<{
  version: 1;
  deviceId: string;
  revision: number;
  slot: MediaPlaybackSlotV1 | null;
  playingIntent: boolean;
}>;

export type MediaPlaybackActionV1 =
  | Readonly<{ kind: 'insert'; itemId: string }>
  | Readonly<{ kind: 'insert-and-activate'; itemId: string }>
  | Readonly<{ kind: 'eject' }>
  | Readonly<{ kind: 'activate' }>
  | Readonly<{ kind: 'stop' }>
  | Readonly<{ kind: 'switch'; itemId: string }>;

export type MediaPlaybackFactV1 = Readonly<{
  version: 1;
  kind: MediaPlaybackActionV1['kind'];
  device: MediaDeviceInstanceV1;
  revision: number;
  previousTrackId: string | null;
  trackId: string | null;
  resource: MediaResourceReferenceV1 | null;
  playing: boolean;
  resumePending: boolean;
  insertedItemId?: string;
  ejectedItemId?: string;
}>;
export type MediaPlaybackProjectionV1 = Readonly<{
  version: 1;
  device: MediaDeviceInstanceV1;
  revision: number;
  slot: MediaPlaybackSlotV1 | null;
  resource: MediaResourceReferenceV1 | null;
  playing: boolean;
  resumePending: boolean;
}>;

export type MediaPlaybackCandidateV1 = Readonly<{
  state: MediaPlaybackStateV1;
  fact: MediaPlaybackFactV1;
}>;

export type MediaPlaybackFailureCode =
  | 'invalid-action'
  | 'stale-revision'
  | 'revision-exhausted'
  | 'slot-occupied'
  | 'empty-slot'
  | 'unsupported-media'
  | 'already-playing'
  | 'already-stopped'
  | 'same-media';

export class MediaPlaybackModelError extends Error {
  constructor(readonly code: MediaPlaybackFailureCode) {
    super(code);
    this.name = 'MediaPlaybackModelError';
  }
}

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} is invalid.`);
  return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key)) || keys.some((key) => !Object.hasOwn(value, key)))
    throw new TypeError(`${label} has an invalid shape.`);
};

const namespaceId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length > MAX_ID_LENGTH || !NAMESPACE_ID.test(value))
    throw new TypeError(`${label} is invalid.`);
  return value;
};

const resourcePath = (value: unknown): string => {
  const normalized = typeof value === 'string' && value.startsWith('./') ? value.slice(2) : value;
  if (
    typeof normalized !== 'string' ||
    normalized.length === 0 ||
    normalized.length > MAX_RESOURCE_PATH_LENGTH ||
    normalized.split('/').some((part) => !RESOURCE_PATH_SEGMENT.test(part))
  )
    throw new TypeError('Media track resource is invalid.');
  return normalized;
};

const freezeResource = (raw: unknown): MediaResourceReferenceV1 => {
  const value = record(raw, 'Media track resource');
  exactKeys(value, ['packId', 'path'], 'Media track resource');
  return Object.freeze({
    packId: namespaceId(value.packId, 'Media track resource pack id'),
    path: resourcePath(value.path),
  });
};

const freezeTarget = (raw: unknown): MediaDeviceTargetSelectorV1 => {
  const value = record(raw, 'Media device target');
  exactKeys(value, ['kind', 'voxelId'], 'Media device target');
  if (value.kind !== 'voxel') throw new TypeError('Media device target kind is invalid.');
  return Object.freeze({ kind: 'voxel', voxelId: namespaceId(value.voxelId, 'Media device target voxel id') });
};

const freezeSlot = (itemId: string, trackId: string): MediaPlaybackSlotV1 => Object.freeze({ itemId, trackId });
export const cloneMediaDeviceInstanceV1 = (raw: unknown): MediaDeviceInstanceV1 => {
  const source = record(raw, 'Media device instance');
  exactKeys(source, ['kind', 'position', 'definitionId'], 'Media device instance');
  if (
    source.kind !== 'voxel' ||
    !Array.isArray(source.position) ||
    source.position.length !== 3 ||
    Reflect.ownKeys(source.position).length !== 4 ||
    !source.position.every(
      (coordinate) => Number.isSafeInteger(coordinate) && Math.abs(coordinate) <= MAX_WORLD_COORDINATE,
    )
  )
    throw new TypeError('Media device instance position is invalid.');
  return Object.freeze({
    kind: 'voxel',
    position: Object.freeze([...source.position]) as readonly [number, number, number],
    definitionId: namespaceId(source.definitionId, 'Media device instance definition id'),
  });
};

const compareId = <Value extends Readonly<{ id: string }>>(left: Value, right: Value) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

export function defineMediaPlaybackModelV1(
  input: Readonly<{
    version: 1;
    tracks: readonly MediaTrackDefinitionV1[];
    devices: readonly MediaDeviceDefinitionV1[];
  }>,
): MediaPlaybackModelV1 {
  const source = record(input, 'Media playback model');
  exactKeys(source, ['version', 'tracks', 'devices'], 'Media playback model');
  if (source.version !== 1) throw new TypeError('Media playback model version is invalid.');
  if (!Array.isArray(source.tracks) || source.tracks.length === 0 || source.tracks.length > MAX_TRACKS)
    throw new TypeError('Media playback tracks are invalid.');
  if (!Array.isArray(source.devices) || source.devices.length === 0 || source.devices.length > MAX_DEVICES)
    throw new TypeError('Media playback devices are invalid.');

  const trackIds = new Set<string>();
  const tracks = source.tracks.map((raw, index) => {
    const track = record(raw, `Media track ${index}`);
    exactKeys(track, ['id', 'resource'], `Media track ${index}`);
    const id = namespaceId(track.id, `Media track ${index} id`);
    if (trackIds.has(id)) throw new TypeError(`Duplicate media track: ${id}`);
    trackIds.add(id);
    return Object.freeze({ id, resource: freezeResource(track.resource) });
  });

  const deviceIds = new Set<string>();
  const targetSelectors = new Set<string>();
  const devices = source.devices.map((raw, index) => {
    const device = record(raw, `Media device ${index}`);
    const deviceKeys = ['id', 'target', 'tracks', ...(device.playOnInsert === undefined ? [] : ['playOnInsert'])];
    exactKeys(device, deviceKeys, `Media device ${index}`);
    const id = namespaceId(device.id, `Media device ${index} id`);
    if (device.playOnInsert !== undefined && device.playOnInsert !== true)
      throw new TypeError(`Media device play-on-insert policy is invalid: ${id}`);
    if (deviceIds.has(id)) throw new TypeError(`Duplicate media device: ${id}`);
    deviceIds.add(id);
    const target = freezeTarget(device.target);
    const targetKey = `${target.kind}:${target.voxelId}`;
    if (targetSelectors.has(targetKey)) throw new TypeError(`Duplicate media device target: ${targetKey}`);
    targetSelectors.add(targetKey);
    if (!Array.isArray(device.tracks) || device.tracks.length === 0 || device.tracks.length > MAX_BINDINGS_PER_DEVICE)
      throw new TypeError(`Media device tracks are invalid: ${id}`);
    const itemIds = new Set<string>();
    const bindings = device.tracks.map((rawBinding, bindingIndex) => {
      const binding = record(rawBinding, `Media device ${id} track ${bindingIndex}`);
      exactKeys(binding, ['itemId', 'trackId'], `Media device ${id} track ${bindingIndex}`);
      const itemId = namespaceId(binding.itemId, `Media device ${id} item id`);
      const trackId = namespaceId(binding.trackId, `Media device ${id} track id`);
      if (itemIds.has(itemId)) throw new TypeError(`Duplicate media item binding: ${id} ${itemId}`);
      if (!trackIds.has(trackId)) throw new TypeError(`Media device ${id} references unknown track: ${trackId}`);
      itemIds.add(itemId);
      return Object.freeze({ itemId, trackId });
    });
    bindings.sort((left, right) =>
      left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : left.trackId.localeCompare(right.trackId),
    );
    return Object.freeze({
      id,
      target,
      tracks: Object.freeze(bindings),
      ...(device.playOnInsert === true ? { playOnInsert: true as const } : {}),
    });
  });

  tracks.sort(compareId);
  devices.sort(compareId);
  return Object.freeze({ version: 1, tracks: Object.freeze(tracks), devices: Object.freeze(devices) });
}

const requireDevice = (model: MediaPlaybackModelV1, deviceId: string): MediaDeviceDefinitionV1 => {
  const device = model.devices.find((candidate) => candidate.id === deviceId);
  if (!device) throw new RangeError(`Unknown media device: ${deviceId}`);
  return device;
};

const requireTrack = (model: MediaPlaybackModelV1, trackId: string): MediaTrackDefinitionV1 => {
  const track = model.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new RangeError(`Unknown media track: ${trackId}`);
  return track;
};

const bindingFor = (model: MediaPlaybackModelV1, deviceId: string, itemId: string): MediaDeviceTrackBindingV1 => {
  const binding = requireDevice(model, deviceId).tracks.find((candidate) => candidate.itemId === itemId);
  if (!binding) throw new MediaPlaybackModelError('unsupported-media');
  return binding;
};

const freezeState = (state: MediaPlaybackStateV1): MediaPlaybackStateV1 =>
  Object.freeze({ ...state, slot: state.slot ? freezeSlot(state.slot.itemId, state.slot.trackId) : null });

export function createMediaPlaybackStateV1(model: MediaPlaybackModelV1, deviceIdValue: string): MediaPlaybackStateV1 {
  const deviceId = namespaceId(deviceIdValue, 'Media playback device id');
  requireDevice(model, deviceId);
  return freezeState({ version: 1, deviceId, revision: 0, slot: null, playing: false, resumePending: false });
}

const decodeSlot = (model: MediaPlaybackModelV1, deviceId: string, raw: unknown): MediaPlaybackSlotV1 | null => {
  if (raw === null) return null;
  const slot = record(raw, 'Media playback slot');
  exactKeys(slot, ['itemId', 'trackId'], 'Media playback slot');
  const itemId = namespaceId(slot.itemId, 'Media playback item id');
  const trackId = namespaceId(slot.trackId, 'Media playback track id');
  const binding = bindingFor(model, deviceId, itemId);
  if (binding.trackId !== trackId) throw new TypeError('Media playback slot track does not match its item binding.');
  requireTrack(model, trackId);
  return freezeSlot(itemId, trackId);
};

export function snapshotMediaPlaybackStateV1(state: MediaPlaybackStateV1): MediaPlaybackSnapshotV1 {
  return Object.freeze({
    version: 1,
    deviceId: state.deviceId,
    revision: state.revision,
    slot: state.slot ? freezeSlot(state.slot.itemId, state.slot.trackId) : null,
    playingIntent: state.playing || state.resumePending,
  });
}

export function projectMediaPlaybackStateV1(
  model: MediaPlaybackModelV1,
  device: MediaDeviceInstanceV1,
  state: MediaPlaybackStateV1,
): MediaPlaybackProjectionV1 {
  const instance = cloneMediaDeviceInstanceV1(device);
  if (instance.definitionId !== state.deviceId) throw new TypeError('Media projection device identity is invalid.');
  const resource = state.slot ? freezeResource(requireTrack(model, state.slot.trackId).resource) : null;
  return Object.freeze({
    version: 1,
    device: instance,
    revision: state.revision,
    slot: state.slot ? freezeSlot(state.slot.itemId, state.slot.trackId) : null,
    resource,
    playing: state.playing,
    resumePending: state.resumePending,
  });
}

export function restoreMediaPlaybackStateV1(
  model: MediaPlaybackModelV1,
  deviceIdValue: string,
  raw: unknown | undefined,
): MediaPlaybackStateV1 {
  const deviceId = namespaceId(deviceIdValue, 'Media playback device id');
  requireDevice(model, deviceId);
  if (raw === undefined) return createMediaPlaybackStateV1(model, deviceId);
  const snapshot = record(raw, 'Media playback snapshot');
  exactKeys(snapshot, ['version', 'deviceId', 'revision', 'slot', 'playingIntent'], 'Media playback snapshot');
  if (snapshot.version !== 1 || snapshot.deviceId !== deviceId)
    throw new TypeError('Media playback snapshot identity is invalid.');
  if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < 0)
    throw new TypeError('Media playback snapshot revision is invalid.');
  if (typeof snapshot.playingIntent !== 'boolean')
    throw new TypeError('Media playback snapshot playing intent is invalid.');
  const slot = decodeSlot(model, deviceId, snapshot.slot);
  if (!slot && snapshot.playingIntent) throw new TypeError('Empty media playback slot cannot retain playing intent.');
  return freezeState({
    version: 1,
    deviceId,
    revision: snapshot.revision as number,
    slot,
    playing: false,
    resumePending: Boolean(slot && snapshot.playingIntent),
  });
}

const validateLiveState = (model: MediaPlaybackModelV1, raw: MediaPlaybackStateV1): MediaPlaybackStateV1 => {
  const state = record(raw, 'Media playback state');
  exactKeys(state, ['version', 'deviceId', 'revision', 'slot', 'playing', 'resumePending'], 'Media playback state');
  if (state.version !== 1) throw new TypeError('Media playback state version is invalid.');
  const deviceId = namespaceId(state.deviceId, 'Media playback state device id');
  requireDevice(model, deviceId);
  if (!Number.isSafeInteger(state.revision) || (state.revision as number) < 0)
    throw new TypeError('Media playback state revision is invalid.');
  if (
    typeof state.playing !== 'boolean' ||
    typeof state.resumePending !== 'boolean' ||
    (state.playing && state.resumePending)
  )
    throw new TypeError('Media playback state flags are invalid.');
  const slot = decodeSlot(model, deviceId, state.slot);
  if (!slot && (state.playing || state.resumePending))
    throw new TypeError('Empty media playback slot cannot be active.');
  return freezeState({
    version: 1,
    deviceId,
    revision: state.revision as number,
    slot,
    playing: state.playing,
    resumePending: state.resumePending,
  });
};

const decodeAction = (raw: unknown): MediaPlaybackActionV1 => {
  const action = record(raw, 'Media playback action');
  if (action.kind === 'insert' || action.kind === 'insert-and-activate' || action.kind === 'switch') {
    exactKeys(action, ['kind', 'itemId'], 'Media playback action');
    return Object.freeze({ kind: action.kind, itemId: namespaceId(action.itemId, 'Media playback action item id') });
  }
  if (action.kind === 'eject' || action.kind === 'activate' || action.kind === 'stop') {
    exactKeys(action, ['kind'], 'Media playback action');
    return Object.freeze({ kind: action.kind });
  }
  throw new MediaPlaybackModelError('invalid-action');
};

export function buildMediaPlaybackCandidateV1(
  input: Readonly<{
    model: MediaPlaybackModelV1;
    device: MediaDeviceInstanceV1;
    state: MediaPlaybackStateV1;
    expectedRevision: number;
    action: unknown;
  }>,
): MediaPlaybackCandidateV1 {
  const current = validateLiveState(input.model, input.state);
  const device = cloneMediaDeviceInstanceV1(input.device);
  if (device.definitionId !== current.deviceId) throw new TypeError('Media candidate device identity is invalid.');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== current.revision)
    throw new MediaPlaybackModelError('stale-revision');
  if (current.revision === Number.MAX_SAFE_INTEGER) throw new MediaPlaybackModelError('revision-exhausted');
  const action = decodeAction(input.action);
  const previousSlot = current.slot;
  let slot = previousSlot;
  let playing = current.playing;
  let resumePending = current.resumePending;
  let insertedItemId: string | undefined;
  let ejectedItemId: string | undefined;

  if (action.kind === 'insert' || action.kind === 'insert-and-activate') {
    if (slot) throw new MediaPlaybackModelError('slot-occupied');
    const binding = bindingFor(input.model, current.deviceId, action.itemId);
    slot = freezeSlot(binding.itemId, binding.trackId);
    insertedItemId = binding.itemId;
    playing = action.kind === 'insert-and-activate';
    resumePending = false;
  } else if (action.kind === 'eject') {
    if (!slot) throw new MediaPlaybackModelError('empty-slot');
    ejectedItemId = slot.itemId;
    slot = null;
    playing = false;
    resumePending = false;
  } else if (action.kind === 'activate') {
    if (!slot) throw new MediaPlaybackModelError('empty-slot');
    if (playing) throw new MediaPlaybackModelError('already-playing');
    playing = true;
    resumePending = false;
  } else if (action.kind === 'stop') {
    if (!slot) throw new MediaPlaybackModelError('empty-slot');
    if (!playing && !resumePending) throw new MediaPlaybackModelError('already-stopped');
    playing = false;
    resumePending = false;
  } else {
    if (!slot) throw new MediaPlaybackModelError('empty-slot');
    const binding = bindingFor(input.model, current.deviceId, action.itemId);
    if (binding.itemId === slot.itemId) throw new MediaPlaybackModelError('same-media');
    ejectedItemId = slot.itemId;
    insertedItemId = binding.itemId;
    slot = freezeSlot(binding.itemId, binding.trackId);
  }

  const state = freezeState({
    version: 1,
    deviceId: current.deviceId,
    revision: current.revision + 1,
    slot,
    playing,
    resumePending,
  });
  const track = state.slot ? requireTrack(input.model, state.slot.trackId) : null;
  const fact: MediaPlaybackFactV1 = Object.freeze({
    version: 1,
    kind: action.kind,
    device,
    revision: state.revision,
    previousTrackId: previousSlot?.trackId ?? null,
    trackId: state.slot?.trackId ?? null,
    resource: track ? freezeResource(track.resource) : null,
    playing: state.playing,
    resumePending: state.resumePending,
    ...(insertedItemId ? { insertedItemId } : {}),
    ...(ejectedItemId ? { ejectedItemId } : {}),
  });
  return Object.freeze({ state, fact });
}
