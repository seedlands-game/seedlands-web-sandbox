import type { GameServer } from '../game-server';
import type { MediaTargetPortV1 } from '../gameplay/gameplay-media-target-runtime';
import { MEDIA_PLAYBACK_CAPABILITY } from '../gameplay/modules/media-playback-module';

export function createAuthorityMediaTargetPort(server: GameServer): MediaTargetPortV1 | undefined {
  const enabled = server.options.composition?.definitionMap.capabilities.some(
    ({ id }) => id === MEDIA_PLAYBACK_CAPABILITY,
  );
  if (!enabled) return undefined;
  const current = () => {
    const runtime = server.mediaTargets;
    if (!runtime) throw new Error('Registered Media runtime is unavailable.');
    return runtime;
  };
  return Object.freeze({
    resolve: (actorId, intent, position) => current().resolve(actorId, intent, position),
    invoke: (actorId, intent, position, expected) => current().invoke(actorId, intent, position, expected),
  });
}
