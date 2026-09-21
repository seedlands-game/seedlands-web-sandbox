import { bodyConfigFor } from '../../physics/body-registry';
import type { GameplayEntity } from './entity-store';
import type { PlayerSnapshot } from './player-state';
import type { CoreClone } from '../../runtime/platform-ports';

type Position = [number, number, number];
const PLAYER_EYE_TO_FEET = 1.6;
const item = bodyConfigFor('world-item');
const WORLD_ITEM_CENTER_TO_FEET = (item.localAabb.max.y - item.localAabb.min.y) / 2;
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export function legacyPlayerPositionToFeet(position: Position): Position {
  if (position.length !== 3 || !position.every(Number.isFinite))
    throw new TypeError('Legacy player position must contain three finite coordinates.');
  return [position[0], round(position[1] - PLAYER_EYE_TO_FEET), position[2]];
}

export const migrateLegacyEntity = (entity: GameplayEntity, clone: CoreClone): GameplayEntity => {
  const offset =
    entity.type === 'player' ? PLAYER_EYE_TO_FEET : entity.type === 'world-item' ? WORLD_ITEM_CENTER_TO_FEET : 0;
  const result = clone(entity);
  result.position = [entity.position[0], round(entity.position[1] - offset), entity.position[2]];
  return result;
};

export const migrateLegacyPlayer = (player: PlayerSnapshot, clone: CoreClone): PlayerSnapshot => ({
  ...clone(player),
  spawnPosition: legacyPlayerPositionToFeet(player.spawnPosition),
});
