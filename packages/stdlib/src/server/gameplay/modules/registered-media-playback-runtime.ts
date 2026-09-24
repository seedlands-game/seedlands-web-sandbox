import type { ModStateAddress, ObservedModState, RegisteredStatePort } from '../../composition/operation-contracts';
import {
  buildMediaPlaybackCandidateV1,
  createMediaPlaybackStateV1,
  restoreMediaPlaybackStateV1,
  snapshotMediaPlaybackStateV1,
  projectMediaPlaybackStateV1,
  type MediaDeviceDefinitionV1,
  type MediaPlaybackFactV1,
  type MediaPlaybackSlotV1,
  type MediaPlaybackSnapshotV1,
  type MediaPlaybackStateV1,
} from './media-playback-model';
import {
  prepareMediaPlaybackHostCommit,
  type MediaPlaybackHostCommitOptions,
  type MediaPlaybackStateOwnerPort,
  type PreparedMediaPlaybackParticipant,
} from './media-playback-host-commit';
import { MEDIA_PLAYBACK_COMPONENT } from './media-playback-module';

const MAX_MEDIA_DEVICE_INSTANCES = 4_096;
const MAX_WORLD_COORDINATE = 30_000_000;
const MAX_PENDING_MEDIA_BATCHES = 256;

export type RegisteredMediaPlaybackCheckpointEntryV1 = Readonly<{
  position: readonly [number, number, number];
  snapshot: MediaPlaybackSnapshotV1;
}>;
export type RegisteredMediaPlaybackCheckpointV1 = Readonly<{
  version: 1;
  devices: readonly RegisteredMediaPlaybackCheckpointEntryV1[];
}>;
export type RegisteredMediaPlaybackCheckpointCandidateV1 = Readonly<{
  checkpoint: RegisteredMediaPlaybackCheckpointV1;
  positions: readonly (readonly [number, number, number])[];
  validate(): void;
  apply(): void;
}>;
export type PreparedMediaPlaybackDependentRemovalV1 = PreparedMediaPlaybackParticipant &
  Readonly<{
    removed: boolean;
    ejectedItem: MediaPlaybackSlotV1 | null;
    fact: MediaPlaybackFactV1 | null;
  }>;
export type PreparedMediaPlaybackDeviceRemovalV1 = PreparedMediaPlaybackDependentRemovalV1;

export type RegisteredMediaPlaybackRuntimeOptions = Omit<
  MediaPlaybackHostCommitOptions,
  'media' | 'validateObserved' | 'prepareFactDelivery'
> &
  Readonly<{
    getVoxelId(position: readonly [number, number, number]): string | undefined;
    maxDeviceInstances?: number;
  }>;

type DeviceEntry = Readonly<{ position: readonly [number, number, number]; state: MediaPlaybackStateV1 }>;
export type CommittedMediaPlaybackFactsV1 = Readonly<{
  worldRevision: number;
  gameplayRevision: number;
  facts: readonly MediaPlaybackFactV1[];
}>;

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const keyFor = (position: readonly [number, number, number]): string => position.join(',');
const comparePositions = (left: readonly number[], right: readonly number[]) => {
  for (let axis = 0; axis < 3; axis += 1) {
    const difference = left[axis]! - right[axis]!;
    if (difference) return difference;
  }
  return 0;
};
const denseArray = (raw: unknown, maxLength: number, label: string): readonly unknown[] => {
  if (!Array.isArray(raw) || raw.length > maxLength || Object.keys(raw).length !== raw.length)
    throw new TypeError(`${label} must be a bounded dense array.`);
  for (let index = 0; index < raw.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, index);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      throw new TypeError(`${label} must be a bounded dense array.`);
  }
  return raw;
};

function position(raw: unknown): readonly [number, number, number] {
  const coordinates = denseArray(raw, 3, 'Media playback device position');
  if (
    coordinates.length !== 3 ||
    !coordinates.every(
      (coordinate) =>
        typeof coordinate === 'number' &&
        Number.isSafeInteger(coordinate) &&
        coordinate >= -MAX_WORLD_COORDINATE &&
        coordinate <= MAX_WORLD_COORDINATE,
    )
  )
    throw new TypeError('Media playback device position is invalid.');
  return Object.freeze([coordinates[0] as number, coordinates[1] as number, coordinates[2] as number]);
}

function record(raw: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} is invalid.`);
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw new TypeError(`${label} has an invalid shape.`);
  return value;
}

/** Owns per-voxel media state. Public Gameplay/checkpoint wiring is intentionally outside this preparation slice. */
export class RegisteredMediaPlaybackRuntime {
  readonly state: RegisteredStatePort;
  readonly model: RegisteredMediaPlaybackRuntimeOptions['model'];
  private entries = new Map<string, DeviceEntry>();
  private generation = 0;
  private pendingFacts: readonly CommittedMediaPlaybackFactsV1[] = [];
  private readonly maxDeviceInstances: number;

  constructor(private readonly options: RegisteredMediaPlaybackRuntimeOptions) {
    this.model = options.model;
    const capacity = options.maxDeviceInstances ?? MAX_MEDIA_DEVICE_INSTANCES;
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_MEDIA_DEVICE_INSTANCES)
      throw new RangeError(`Media playback device capacity must be between 1 and ${MAX_MEDIA_DEVICE_INSTANCES}.`);
    this.maxDeviceInstances = capacity;
    this.state = Object.freeze({
      read: (address) => {
        const at = this.addressPosition(address);
        const value = this.read(at);
        return Object.freeze({ revision: value.revision, value });
      },
      commit: () => Object.freeze({ ok: false as const, reason: 'Media playback requires a prepared commit.' }),
      prepareCommit: (observed, writes, execution) => {
        this.validateObserved(observed);
        return prepareMediaPlaybackHostCommit(
          {
            ...this.options,
            media: this.mediaPort(),
            validateObserved: (entries) => this.validateObserved(entries),
            prepareFactDelivery: (facts, worldRevision, gameplayRevision) =>
              this.prepareFactDelivery(facts, worldRevision, gameplayRevision),
          },
          observed,
          writes,
          execution,
        );
      },
    });
  }

  read(at: readonly [number, number, number]): MediaPlaybackStateV1 {
    const normalized = position(at);
    const device = this.deviceAt(normalized);
    const saved = this.entries.get(keyFor(normalized));
    if (saved && saved.state.deviceId !== device.id) throw new Error('media-device-stale');
    return (
      saved?.state ??
      Object.freeze({ ...createMediaPlaybackStateV1(this.options.model, device.id), revision: this.generation })
    );
  }

  checkpoint(): RegisteredMediaPlaybackCheckpointV1 {
    const entries = [...this.entries.values()];
    for (const entry of entries) {
      let currentDeviceId: string | undefined;
      try {
        currentDeviceId = this.deviceAt(entry.position).id;
      } catch {
        throw new Error('media-device-orphaned');
      }
      if (currentDeviceId !== entry.state.deviceId) throw new Error('media-device-orphaned');
    }
    const devices = entries
      .filter((entry) => entry.state.slot !== null)
      .sort((left, right) => comparePositions(left.position, right.position))
      .map((entry) => {
        return Object.freeze({
          position: Object.freeze([...entry.position]) as readonly [number, number, number],
          snapshot: snapshotMediaPlaybackStateV1(entry.state),
        });
      });
    return Object.freeze({ version: 1, devices: Object.freeze(devices) });
  }

  projections() {
    return Object.freeze(
      [...this.entries.values()]
        .sort((left, right) => comparePositions(left.position, right.position))
        .map(({ position, state }) =>
          projectMediaPlaybackStateV1(
            this.options.model,
            {
              kind: 'voxel',
              position,
              definitionId: state.deviceId,
            },
            state,
          ),
        ),
    );
  }

  positions(): readonly (readonly [number, number, number])[] {
    return Object.freeze(
      [...this.entries.values()]
        .sort((left, right) => comparePositions(left.position, right.position))
        .map(({ position }) => Object.freeze([...position]) as readonly [number, number, number]),
    );
  }

  takeCommittedFacts(): readonly CommittedMediaPlaybackFactsV1[] {
    const batches = this.pendingFacts;
    this.pendingFacts = Object.freeze([]);
    return batches;
  }

  prepareFactDelivery(
    facts: readonly MediaPlaybackFactV1[],
    worldRevision: number,
    gameplayRevision: number,
  ): PreparedMediaPlaybackParticipant {
    if (!Number.isSafeInteger(worldRevision) || worldRevision < 0)
      throw new TypeError('Media fact world revision is invalid.');
    if (!Number.isSafeInteger(gameplayRevision) || gameplayRevision < 1)
      throw new TypeError('Media fact gameplay revision is invalid.');
    if (!Array.isArray(facts) || facts.length > 64) throw new RangeError('Media fact batch capacity exceeded.');
    if (!facts.length) return Object.freeze({ validate() {}, apply() {} });
    if (this.pendingFacts.length >= MAX_PENDING_MEDIA_BATCHES)
      throw new RangeError('Media committed fact queue capacity exceeded.');
    const previous = this.pendingFacts;
    const batch = Object.freeze({ worldRevision, gameplayRevision, facts: Object.freeze([...facts]) });
    const next = Object.freeze([...previous, batch]);
    let validated = false;
    let used = false;
    return Object.freeze({
      validate: () => {
        validated = false;
        if (used || this.pendingFacts !== previous) throw new Error('Prepared media fact delivery is stale.');
        validated = true;
      },
      apply: () => {
        if (used || !validated) throw new Error('Prepared media fact delivery requires validation.');
        used = true;
        this.pendingFacts = next;
      },
    });
  }

  /** Prepared for an outer block transaction: validate while the old voxel exists, then remove without callbacks. */
  prepareDeviceRemoval(rawPosition: readonly [number, number, number]): PreparedMediaPlaybackDeviceRemovalV1 {
    const at = position(rawPosition);
    return this.prepareDeviceRemovalAt(at, this.deviceAt(at));
  }

  /** Distinguishes a known non-device from unavailable or orphaned state for a mandatory outer participant. */
  prepareDependentRemoval(rawPosition: readonly [number, number, number]): PreparedMediaPlaybackDependentRemovalV1 {
    const at = position(rawPosition);
    const key = keyFor(at);
    const voxelId = this.options.getVoxelId(at);
    if (voxelId === undefined) throw new Error('media-device-unavailable');
    const device = this.deviceForVoxelId(voxelId);
    if (device) return this.prepareDeviceRemovalAt(at, device);
    if (this.entries.has(key)) throw new Error('media-device-orphaned');

    const generation = this.generation;
    let validated = false;
    let used = false;
    return Object.freeze({
      removed: false,
      ejectedItem: null,
      fact: null,
      validate: () => {
        validated = false;
        if (used || this.generation !== generation) throw new Error('Prepared media dependent removal is stale.');
        const currentVoxelId = this.options.getVoxelId(at);
        if (currentVoxelId !== voxelId || this.deviceForVoxelId(currentVoxelId) || this.entries.has(key))
          throw new Error('Prepared media dependent removal is stale.');
        validated = true;
      },
      apply: () => {
        if (used || !validated) throw new Error('Prepared media dependent removal requires validation.');
        used = true;
      },
    });
  }

  private prepareDeviceRemovalAt(
    at: readonly [number, number, number],
    device: MediaDeviceDefinitionV1,
  ): PreparedMediaPlaybackDeviceRemovalV1 {
    if (this.generation >= Number.MAX_SAFE_INTEGER) throw new RangeError('Media playback revision is exhausted.');
    const key = keyFor(at);
    const current = this.read(at);
    const removed = this.entries.has(key);
    const candidate = current.slot
      ? buildMediaPlaybackCandidateV1({
          model: this.options.model,
          device: { kind: 'voxel', position: at, definitionId: device.id },
          state: current,
          expectedRevision: current.revision,
          action: { kind: 'eject' },
        })
      : null;
    const ejectedItem = current.slot
      ? Object.freeze({ itemId: current.slot.itemId, trackId: current.slot.trackId })
      : null;
    const generation = this.generation;
    const nextGeneration = generation + 1;
    let validated = false;
    let used = false;
    const validate = () => {
      validated = false;
      if (used || this.generation !== generation) throw new Error('Prepared media device removal is stale.');
      if (this.deviceAt(at).id !== device.id || !same(this.read(at), current)) throw new Error('media-device-stale');
      validated = true;
    };
    return Object.freeze({
      removed,
      ejectedItem,
      fact: candidate?.fact ?? null,
      validate,
      apply: () => {
        if (used || !validated) throw new Error('Prepared media device removal requires validation.');
        used = true;
        if (removed) {
          this.entries.delete(key);
          this.generation = Math.max(this.generation, nextGeneration, candidate?.state.revision ?? current.revision);
        }
      },
    });
  }

  prepareCheckpointCandidate(
    raw: unknown | undefined,
    options: Readonly<{ deferDeviceValidation?: boolean }> = {},
  ): RegisteredMediaPlaybackCheckpointCandidateV1 {
    const checkpoint = this.decodeCheckpoint(raw, options.deferDeviceValidation === true);
    const next = new Map<string, DeviceEntry>();
    for (const entry of checkpoint.devices) {
      const deviceId = options.deferDeviceValidation ? entry.snapshot.deviceId : this.deviceAt(entry.position).id;
      const state = restoreMediaPlaybackStateV1(this.options.model, deviceId, entry.snapshot);
      if (state.slot) next.set(keyFor(entry.position), Object.freeze({ position: entry.position, state }));
    }
    const generation = this.generation;
    let validated = false;
    let used = false;
    const validate = () => {
      validated = false;
      if (used || generation !== this.generation) throw new Error('Prepared media checkpoint is stale.');
      if (!options.deferDeviceValidation)
        for (const entry of next.values())
          if (this.deviceAt(entry.position).id !== entry.state.deviceId) throw new Error('media-device-stale');
      validated = true;
    };
    return Object.freeze({
      checkpoint,
      positions: Object.freeze(
        [...next.values()].map(({ position }) => Object.freeze([...position]) as readonly [number, number, number]),
      ),
      validate,
      apply: () => {
        if (used || !validated) throw new Error('Prepared media checkpoint requires validation.');
        used = true;
        this.entries = new Map(next);
        this.pendingFacts = Object.freeze([]);
        this.generation = Math.max(0, ...[...next.values()].map(({ state }) => state.revision));
      },
    });
  }

  validateInstalledDevices(resolveVoxelId: (position: readonly [number, number, number]) => string | undefined): void {
    for (const entry of this.entries.values()) {
      const device = this.deviceForVoxelId(resolveVoxelId(entry.position));
      if (device?.id !== entry.state.deviceId) throw new Error('media-device-stale');
    }
  }

  private deviceAt(at: readonly [number, number, number]): MediaDeviceDefinitionV1 {
    const voxelId = this.options.getVoxelId(at);
    const device = voxelId === undefined ? undefined : this.deviceForVoxelId(voxelId);
    if (!device) throw new Error(voxelId === undefined ? 'media-device-unavailable' : 'unsupported-media-device');
    return device;
  }

  private deviceForVoxelId(voxelId: string | undefined): MediaDeviceDefinitionV1 | undefined {
    return this.options.model.devices.find(
      (candidate) => candidate.target.kind === 'voxel' && candidate.target.voxelId === voxelId,
    );
  }

  private addressPosition(address: ModStateAddress): readonly [number, number, number] {
    if (
      address.componentId !== MEDIA_PLAYBACK_COMPONENT ||
      address.target.kind !== 'voxel' ||
      address.partition !== undefined
    )
      throw new TypeError('Invalid media playback state address.');
    return position(address.target.position);
  }

  private validateObserved(observed: readonly ObservedModState[]): void {
    const seen = new Set<string>();
    for (const entry of observed) {
      const at = this.addressPosition(entry.address);
      const key = keyFor(at);
      if (seen.has(key) || this.read(at).revision !== entry.revision)
        throw new Error('Media playback observation is stale.');
      seen.add(key);
    }
  }

  private mediaPort(): MediaPlaybackStateOwnerPort {
    return Object.freeze({
      deviceAt: (at) => this.deviceAt(position(at)),
      read: (at) => this.read(position(at)),
      prepareReplacement: (at, expected, replacement) => this.prepareReplacement(at, expected, replacement),
    });
  }

  private prepareReplacement(
    rawPosition: readonly [number, number, number],
    expected: MediaPlaybackStateV1,
    replacement: MediaPlaybackStateV1,
  ): PreparedMediaPlaybackParticipant {
    const at = position(rawPosition);
    const key = keyFor(at);
    if (replacement.deviceId !== expected.deviceId || replacement.revision !== expected.revision + 1)
      throw new TypeError('Media playback replacement does not advance the current device.');
    if (this.generation >= Number.MAX_SAFE_INTEGER) throw new RangeError('Media playback revision is exhausted.');
    const generation = this.generation;
    let validated = false;
    let used = false;
    const validate = () => {
      validated = false;
      if (used || this.generation !== generation || !same(this.read(at), expected))
        throw new Error('Prepared media playback state is stale.');
      if (!this.entries.has(key) && this.entries.size >= this.maxDeviceInstances)
        throw new RangeError('Media playback device instance capacity exceeded.');
      validated = true;
    };
    return Object.freeze({
      validate,
      apply: () => {
        if (used || !validated) throw new Error('Prepared media playback state requires validation.');
        used = true;
        this.entries.set(key, Object.freeze({ position: at, state: replacement }));
        this.generation = Math.max(this.generation + 1, replacement.revision);
      },
    });
  }

  private decodeCheckpoint(
    raw: unknown | undefined,
    deferDeviceValidation = false,
  ): RegisteredMediaPlaybackCheckpointV1 {
    if (raw === undefined) return Object.freeze({ version: 1, devices: Object.freeze([]) });
    const source = record(raw, ['version', 'devices'], 'Media playback checkpoint');
    if (source.version !== 1) throw new TypeError('Media playback checkpoint is invalid.');
    const rawDevices = denseArray(source.devices, this.maxDeviceInstances, 'Media playback checkpoint devices');
    const seen = new Set<string>();
    const devices = rawDevices.map((rawEntry) => {
      const entry = record(rawEntry, ['position', 'snapshot'], 'Media playback checkpoint entry');
      const at = position(entry.position);
      const key = keyFor(at);
      if (seen.has(key)) throw new TypeError(`Duplicate media playback device position: ${key}`);
      seen.add(key);
      const snapshot = record(
        entry.snapshot,
        ['version', 'deviceId', 'revision', 'slot', 'playingIntent'],
        'Media playback snapshot',
      );
      const deviceId = deferDeviceValidation ? snapshot.deviceId : this.deviceAt(at).id;
      if (typeof deviceId !== 'string') throw new TypeError('Media playback snapshot identity is invalid.');
      const restored = restoreMediaPlaybackStateV1(this.options.model, deviceId, entry.snapshot);
      return Object.freeze({ position: at, snapshot: snapshotMediaPlaybackStateV1(restored) });
    });
    devices.sort((left, right) => comparePositions(left.position, right.position));
    return Object.freeze({ version: 1, devices: Object.freeze(devices) });
  }
}
