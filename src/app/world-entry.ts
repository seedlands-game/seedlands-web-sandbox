import type { GameServer } from '../server/game-server';
import { findSafePlayerSpawn } from '../server/gameplay/safe-spawn';
import { CHUNK_SIZE, floorDiv } from '../world/voxel';

type Position = [number, number, number];

/** 存档优先；只有没有玩家状态的新世界才选择新的安全落点。 */
export async function preparePlayerEntry(
  server: GameServer,
  storedPosition: Position | null,
  legacyPosition: Position | null,
) {
  const restoredPlayer = server.queryEntities({ type: 'player' })[0];
  const position =
    restoredPlayer?.position ??
    storedPosition ??
    legacyPosition ??
    findSafePlayerSpawn((x, y, z) => server.getVoxel(x, y, z));
  if (!position) throw new Error('附近没有安全的干燥出生点，请尝试另一个 Seed。');
  await server.ensureChunkNeighborhood(
    floorDiv(position[0], CHUNK_SIZE),
    floorDiv(position[1], CHUNK_SIZE),
    floorDiv(position[2], CHUNK_SIZE),
  );
  return { restoredPlayer, position };
}
