import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import type { AuthorityAction } from '../../../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import type { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { chunkKey } from '@seedlands/stdlib/world/voxel';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { classicOptions } from '../../../../fixtures/classic/content';

export type ClassicDoorAuthorityRuntime = Awaited<ReturnType<typeof createClassicDoorAuthority>>;

export const createClassicDoorAuthority = (
  persistence?: MemoryGamePersistence,
  position: [number, number, number] = [0.5, 31, 0.5],
) =>
  AuthorityRuntime.create({
    ...classicOptions(),
    worldgenProvider: classicWorldgenProvider,
    platform: testCorePlatform,
    epoch: 'classic-door-authority-red',
    seedText: 'classic-door-authority-red',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: position,
    ...(persistence ? { persistence } : {}),
  });

export const createClassicDoorAuthorityWithUnavailableChunks = (requests: string[]) =>
  AuthorityRuntime.create({
    ...classicOptions(),
    worldgenProvider: classicWorldgenProvider,
    platform: {
      ...testCorePlatform,
      timers: Object.freeze({
        set: (callback: () => void) => setTimeout(callback, 0),
        clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      }),
    },
    epoch: 'classic-door-authority-unavailable-red',
    seedText: 'classic-door-authority-unavailable-red',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 31, 0.5],
    onUnknownChunk: (key) => requests.push(key),
  });

export const acceptClassicDoorChunk = (runtime: ClassicDoorAuthorityRuntime, cx: number, cy: number, cz: number) => {
  const generated = classicWorldgenProvider.generate({
    seed: runtime.server.seed,
    generatorVersion: runtime.server.generatorVersion,
    coordinate: { x: cx, y: cy, z: cz },
    epoch: 0,
    revision: 0,
  });
  const accepted = runtime.acceptGeneratedChunk({
    key: chunkKey(cx, cy, cz),
    cx,
    cy,
    cz,
    chunkRevision: 0,
    generatorVersion: runtime.server.generatorVersion,
    provider: generated.provider,
    canonical: generated.voxels,
  });
  if (!accepted) throw new Error(`Classic door fixture Chunk was rejected: ${cx},${cy},${cz}`);
};

export const loadClassicDoorCells = async (
  runtime: ClassicDoorAuthorityRuntime,
  edits: readonly { x: number; y: number; z: number; value: number }[],
) => {
  const result = await runtime.editWorld('door-fixture', edits);
  if (!result.committed) throw new Error(`Classic door fixture edit failed: ${result.reason}`);
  runtime.takeCommits();
};

export const classicDoorSelection = (runtime: ClassicDoorAuthorityRuntime) => {
  const player = runtime.server.getPlayerState(runtime.playerId);
  return {
    inventoryRevision: runtime.server.getInventoryPointerView(runtime.playerId).revision,
    modeRevision: player.mode!.revision,
    creativeCatalogRevision: player.creativeCatalog!.revision,
    selectedSlot: player.mode!.value === 'creative' ? player.creativeCatalog!.selectedSlot : player.selectedSlot,
  };
};

export const interactWithClassicDoor = (
  runtime: ClassicDoorAuthorityRuntime,
  hit: [number, number, number],
  adjacent: [number, number, number],
  intent: 'use' | 'alternate' = 'use',
): AuthorityAction => ({
  type: 'interact',
  intent,
  target: { kind: 'voxel', hit, adjacent },
  expectedSelection: classicDoorSelection(runtime),
});

export const classicDoorKernelOwner = (runtime: ClassicDoorAuthorityRuntime) =>
  (
    runtime.server as unknown as {
      gameplayHost: { kernelState: { restoreCommitFrontier(sequence: number, worldRevision: number): void } };
    }
  ).gameplayHost.kernelState;
