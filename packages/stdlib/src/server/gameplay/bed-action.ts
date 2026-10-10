import type { PlayerState } from './player-state';

export const setSpawnFromBed = (
  player: PlayerState,
  bedPosition: readonly [number, number, number],
  safeSpawn: (position: readonly [number, number, number]) => [number, number, number] | null,
) => {
  if (bedPosition.length !== 3 || !bedPosition.every(Number.isFinite))
    return { success: false as const, reason: 'invalid-bed' };
  const position = safeSpawn(bedPosition);
  if (!position || !player.setSpawnPosition(position)) return { success: false as const, reason: 'unsafe-spawn' };
  return { success: true as const, spawnPosition: [...position] as [number, number, number] };
};
