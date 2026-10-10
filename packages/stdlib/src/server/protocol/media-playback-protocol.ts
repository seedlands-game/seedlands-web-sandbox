import { PROTOCOL_VERSION, type SessionEpoch } from '../../runtime/session-protocol';
import type { MediaPlaybackFactV1, MediaPlaybackProjectionV1 } from '../gameplay/modules/media-playback-model';
import { cloneMediaPlaybackFactV1, cloneMediaPlaybackProjectionV1 } from '../gameplay/modules/media-playback-wire';

export type MediaPlaybackCommittedBatchV1 = Readonly<{
  version: 1;
  worldEpoch: SessionEpoch;
  worldRevision: number;
  gameplayRevision: number;
  facts: readonly MediaPlaybackFactV1[];
}>;
export type AuthorityMediaFactsResponseV1 = Readonly<{
  kind: 'authority-media-facts';
  protocolVersion: typeof PROTOCOL_VERSION;
  epoch: SessionEpoch;
  batch: MediaPlaybackCommittedBatchV1;
}>;

const MAX_MEDIA_PROJECTIONS = 4_096;
const MAX_MEDIA_FACTS = 64;
const dense = <Value>(raw: readonly Value[], max: number, label: string): readonly Value[] => {
  if (!Array.isArray(raw) || raw.length > max || Reflect.ownKeys(raw).length !== raw.length + 1)
    throw new TypeError(`${label} must be a bounded dense array.`);
  return raw;
};
const frontier = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${label} is invalid.`);
  return value;
};
const epoch = (value: unknown): SessionEpoch => {
  if (typeof value !== 'string' || !value || value.length > 256 || value.trim() !== value)
    throw new TypeError('Media playback world epoch is invalid.');
  return value;
};

const instanceKey = (entry: MediaPlaybackProjectionV1 | MediaPlaybackFactV1): string =>
  `${entry.device.definitionId}@${entry.device.position.join(',')}`;

export function cloneMediaPlaybackProjectionsV1(raw: unknown): readonly MediaPlaybackProjectionV1[] {
  const projections = dense((raw ?? []) as readonly unknown[], MAX_MEDIA_PROJECTIONS, 'Media playback projections').map(
    cloneMediaPlaybackProjectionV1,
  );
  const keys = projections.map(instanceKey);
  if (new Set(keys).size !== keys.length) throw new TypeError('Media playback projection instance is duplicated.');
  projections.sort((left, right) => instanceKey(left).localeCompare(instanceKey(right)));
  return Object.freeze(projections);
}

export function cloneMediaPlaybackCommittedBatchV1(
  raw: unknown,
  expectedEpoch?: SessionEpoch,
): MediaPlaybackCommittedBatchV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Media playback batch is invalid.');
  const source = raw as unknown as Record<string, unknown>;
  const keys = ['version', 'worldEpoch', 'worldRevision', 'gameplayRevision', 'facts'];
  if (
    Object.keys(source).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(source, key)) ||
    source.version !== 1
  )
    throw new TypeError('Media playback batch shape is invalid.');
  const worldEpoch = epoch(source.worldEpoch);
  if (expectedEpoch !== undefined && worldEpoch !== expectedEpoch)
    throw new TypeError('Media playback batch epoch is stale.');
  const facts = dense(source.facts as readonly MediaPlaybackFactV1[], MAX_MEDIA_FACTS, 'Media playback facts').map(
    cloneMediaPlaybackFactV1,
  );
  const revisions = new Set<string>();
  for (const fact of facts) {
    const key = `${instanceKey(fact)}#${fact.revision}`;
    if (revisions.has(key)) throw new TypeError('Media playback fact instance revision is duplicated.');
    revisions.add(key);
  }
  return Object.freeze({
    version: 1,
    worldEpoch,
    worldRevision: frontier(source.worldRevision, 'Media playback world revision'),
    gameplayRevision: frontier(source.gameplayRevision, 'Media playback gameplay revision'),
    facts: Object.freeze(facts),
  });
}
