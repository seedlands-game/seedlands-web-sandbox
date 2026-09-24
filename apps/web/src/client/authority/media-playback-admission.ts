import type { MediaPlaybackFactV1, MediaPlaybackProjectionV1 } from '@seedlands/stdlib/mod-api';

export const mediaInstanceKey = (entry: MediaPlaybackFactV1 | MediaPlaybackProjectionV1): string =>
  `${entry.device.definitionId}@${entry.device.position.join(',')}`;

export const mediaFactEndsPlayback = (fact: MediaPlaybackFactV1): boolean =>
  (fact.kind === 'stop' || fact.kind === 'eject') && !fact.playing && !fact.resumePending;

const sameResource = (fact: MediaPlaybackFactV1, projection: MediaPlaybackProjectionV1): boolean =>
  fact.resource?.packId === projection.resource?.packId && fact.resource?.path === projection.resource?.path;

export const mediaFactMatchesProjection = (
  fact: MediaPlaybackFactV1,
  projection: MediaPlaybackProjectionV1 | undefined,
): boolean => {
  if (
    !projection ||
    fact.revision !== projection.revision ||
    fact.trackId !== (projection.slot?.trackId ?? null) ||
    !sameResource(fact, projection) ||
    fact.playing !== projection.playing ||
    fact.resumePending !== projection.resumePending
  )
    return false;
  if (fact.kind === 'insert' || fact.kind === 'insert-and-activate' || fact.kind === 'switch')
    return fact.insertedItemId === projection.slot?.itemId;
  return true;
};
