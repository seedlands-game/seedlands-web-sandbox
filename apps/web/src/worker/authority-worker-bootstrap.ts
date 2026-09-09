import type { AuthorityInitialWorldBootstrap } from '@seedlands/game-core/server/authority/authority-runtime';
import type { AuthorityRequest } from '@seedlands/game-core/compute/authority-worker-protocol';

export const decodeAuthorityBootstrapResult = (
  message: Extract<AuthorityRequest, { kind: 'authority-bootstrap-result' }>,
): AuthorityInitialWorldBootstrap => {
  if (
    message.playerBodyPosition.length !== 3 ||
    !message.playerBodyPosition.every((value) => Number.isFinite(value)) ||
    !Array.isArray(message.starterChunks)
  )
    throw new Error('Safe spawn compute result is invalid.');
  return {
    playerBodyPosition: message.playerBodyPosition,
    starterChunks: message.starterChunks.map((chunk) => ({
      ...chunk,
      canonical: new Uint16Array(chunk.canonical),
    })),
  };
};
