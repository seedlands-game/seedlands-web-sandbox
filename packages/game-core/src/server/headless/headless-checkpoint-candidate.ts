import type { AuthorityRuntime } from '../authority/authority-runtime';
import { MemoryGamePersistence } from '../persistence/memory-game-persistence';
import type { FrozenGameSaveSnapshot } from '../persistence/game-save-snapshot';
import type { HeadlessSessionOptions } from './headless-session';

/** Prepare and validate the replacement entirely before the live Headless owner is exchanged. */
export async function prepareHeadlessCheckpointCandidate(
  snapshot: FrozenGameSaveSnapshot,
  options: Omit<HeadlessSessionOptions, 'seedText' | 'generatorVersion' | 'initialWorldTime'> & { epoch: string },
  create: (
    options: HeadlessSessionOptions,
    persistence: MemoryGamePersistence,
    epoch: string,
  ) => Promise<AuthorityRuntime>,
) {
  const persistence = new MemoryGamePersistence({ clone: options.platform.clone });
  persistence.saveFrozenSnapshot(snapshot);
  const nextEpoch = `${options.epoch}:restore:${snapshot.commitSequence}:${snapshot.worldRevision}`;
  const candidate = await create(
    {
      ...options,
      seedText: snapshot.seedText,
      generatorVersion: snapshot.generatorVersion,
      initialWorldTime: snapshot.gameplay.worldTime ?? 9,
      epoch: nextEpoch,
    },
    persistence,
    nextEpoch,
  );
  try {
    candidate.server.validateStationCheckpoint(snapshot);
  } catch (error) {
    candidate.server.disposeGameplay();
    throw error;
  }
  return { candidate, persistence, nextEpoch };
}
