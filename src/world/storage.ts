import { GENERATOR_VERSION } from './voxel';

export type WorldChange = [number, number, number, number];
export type SavedWorld = {
  seed: string;
  generatorVersion: number;
  player: [number, number, number];
  changes: WorldChange[];
};

export function decodeWorldSave(raw: string | null): SavedWorld | null {
  try {
    const saved: unknown = JSON.parse(raw ?? 'null');
    if (!saved || typeof saved !== 'object') return null;
    const record = saved as Record<string, unknown>;
    if (typeof record.seed !== 'string' || record.generatorVersion !== GENERATOR_VERSION) return null;
    if (!Array.isArray(record.player) || record.player.length !== 3 || !record.player.every(Number.isFinite))
      return null;
    if (!Array.isArray(record.changes)) return null;
    const changes: WorldChange[] = [];
    for (const change of record.changes) {
      if (!Array.isArray(change) || change.length !== 4 || !change.every(Number.isInteger)) return null;
      changes.push([change[0], change[1], change[2], change[3]]);
    }
    return {
      seed: record.seed,
      generatorVersion: record.generatorVersion,
      player: [record.player[0], record.player[1], record.player[2]],
      changes,
    };
  } catch {
    return null;
  }
}

export function encodeWorldSave(
  seed: string,
  player: readonly [number, number, number],
  changes: Iterable<WorldChange>,
): string {
  return JSON.stringify({ seed, generatorVersion: GENERATOR_VERSION, player, changes: [...changes] });
}
