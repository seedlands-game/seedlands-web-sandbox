import { expect, it } from 'vitest';
import { GameServer } from '../../packages/game-core/src/server/game-server';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../support/core-platform';

it.each([2, 3, 4])('preserves generator %i on dirty chunks and portable save/reopen', async (generatorVersion) => {
  const persistence = new MemoryGamePersistence({ clone: structuredClone });
  const options = { seedText: 'legacy-generator-save', generatorVersion, persistence, platform: testCorePlatform };
  const source = new GameServer(options);
  source.spawnPlayer({ id: 'player', position: [0.5, 60, 0.5] });
  source.edit(2, 60, 0, 10, 'fixture');
  const frozen = source.freezePortableSaveSnapshot(1);
  expect(frozen.generatorVersion).toBe(generatorVersion);
  expect(frozen.chunks.every((chunk) => chunk.generatorVersion === generatorVersion)).toBe(true);
  await source.save(1);
  expect(persistence.loadSnapshot('0,1,0')?.generatorVersion).toBe(generatorVersion);
  const restored = new GameServer(options);
  await restored.restore();
  expect(restored.getVoxel(2, 60, 0)).toBe(10);
  expect(restored.generatorVersion).toBe(generatorVersion);
});
