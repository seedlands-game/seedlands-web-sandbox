import { describe, expect, it } from 'vitest';
import { SwitchableAuthorityPersistence } from '../../../src/worker/authority-worker-persistence';
import { MemoryGamePersistence } from '@seedlands/stdlib/server/persistence/memory-game-persistence';
import type { ChunkColumnDirectory } from '@seedlands/stdlib/server/persistence/chunk-persistence';
import { testCorePlatform } from '../../../../../packages/stdlib/tests/support/core-platform';
import { GameServer } from '../../fixtures/classic/content';

const makeOwner = () => new MemoryGamePersistence({ clone: testCorePlatform.clone });
describe('Switchable persistence column observation', () => {
  it('unsupported delegate reports unavailable and invalid coordinates reject', async () => {
    const owner = new SwitchableAuthorityPersistence({ loadSnapshot: () => null, saveSnapshots: () => undefined });
    expect(await owner.inspectColumnDirectory(0, 0)).toEqual({ status: 'unknown', reason: 'source-unavailable' });
    await expect(owner.inspectColumnDirectory(Infinity, 0)).rejects.toThrow(RangeError);
  });
  it('real frozen writes share the Memory directory owner', async () => {
    const memory = makeOwner();
    const owner = new SwitchableAuthorityPersistence(memory);
    const server = new GameServer({ platform: testCorePlatform, seedText: 'directory', persistence: owner });
    server.edit(0, 20, 0, 1);
    const frozen = server.freezeSaveSnapshot();
    owner.saveFrozenSnapshot(frozen);
    expect(await owner.inspectColumnDirectory(0, 0)).toMatchObject({
      status: 'complete',
      revision: 1,
      entries: [{ key: '0,0,0', revision: frozen.chunks[0].revision }],
    });
    owner.saveFrozenSnapshot({ ...frozen, chunks: [] });
    expect(await owner.inspectColumnDirectory(0, 0)).toMatchObject({ revision: 1 });
    const failure = new Error('frozen failed');
    memory.failNextFrozenSave(failure);
    expect(() => owner.saveFrozenSnapshot(frozen)).toThrow(failure);
    expect(await owner.inspectColumnDirectory(0, 0)).toMatchObject({ revision: 1 });
    const pending = owner.inspectColumnDirectory(0, 0);
    owner.saveFrozenSnapshot(frozen);
    expect(await pending).toEqual({ status: 'unknown', reason: 'superseded' });
  });
  it.each(['replacement', 'same delegate', 'chunk write', 'frozen write'] as const)(
    'fences delayed reply after %s',
    async (action) => {
      const memory = makeOwner();
      let resolve!: (value: ChunkColumnDirectory) => void;
      memory.inspectColumnDirectory = () =>
        new Promise((done) => {
          resolve = done;
        });
      const owner = new SwitchableAuthorityPersistence(memory);
      const pending = owner.inspectColumnDirectory(0, 0);
      if (action === 'replacement') owner.replace(makeOwner());
      else if (action === 'same delegate') owner.replace(memory);
      else if (action === 'chunk write') owner.saveSnapshots([]);
      else {
        const server = new GameServer({ platform: testCorePlatform, seedText: 'directory', persistence: memory });
        owner.saveFrozenSnapshot(server.freezeSaveSnapshot());
      }
      resolve({ status: 'complete', revision: 0, entries: [] });
      expect(await pending).toEqual({ status: 'unknown', reason: 'superseded' });
    },
  );
});
