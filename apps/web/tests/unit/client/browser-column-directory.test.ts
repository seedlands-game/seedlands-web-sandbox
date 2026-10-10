import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserChunkPersistence } from '../../../src/client/persistence/browser-chunk-persistence';
import { classicWorldgenIdentity } from '@seedlands/playbook-classic/worldgen';
import { CHUNK_SIZE } from '@seedlands/stdlib/world/voxel';

class WorkerFixture {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: Record<string, unknown>[] = [];
  reply(id: number, result: unknown) {
    this.onmessage?.({ data: { requestId: id, ok: true, result } } as MessageEvent);
  }
  postMessage(message: Record<string, unknown>) {
    this.messages.push(message);
    if (message.kind === 'init')
      this.reply(message.requestId as number, {
        worldId: message.worldId,
        generatorVersion: 11,
        provider: classicWorldgenIdentity,
        player: null,
        gameplaySnapshot: null,
        corpusSummary: null,
        legacyMigrated: true,
      });
    if (message.kind === 'save')
      this.reply(message.requestId as number, {
        saved: [{ key: '0,0,0', revision: 1 }],
        recordBytes: 0,
        encodeMs: 0,
        codecs: {},
      });
  }
  terminate() {}
  complete(result: unknown) {
    this.reply(
      this.messages
        .slice()
        .reverse()
        .find((message) => message.kind === 'column-directory')!.requestId as number,
      result,
    );
  }
}
const directory = {
  status: 'complete',
  revision: 2,
  entries: [{ cx: -2, cy: 10000, cz: 3, key: '-2,10000,3', revision: 7 }],
};
const opened: BrowserChunkPersistence[] = [];
async function open() {
  const worker = new WorkerFixture();
  vi.stubGlobal(
    'Worker',
    class {
      constructor() {
        return worker;
      }
    },
  );
  const persistence = await BrowserChunkPersistence.open('query', { provider: classicWorldgenIdentity });
  opened.push(persistence);
  return { persistence, worker };
}
afterEach(() => {
  for (const persistence of opened.splice(0)) persistence.dispose();
  vi.unstubAllGlobals();
});

describe('Browser column directory observation freshness', () => {
  it('uses original worker queue and does not consume prepared snapshot cache', async () => {
    const { persistence, worker } = await open();
    const consume = vi.spyOn(persistence, 'loadSnapshot');
    const result = persistence.inspectColumnDirectory(-2, 3);
    worker.complete(directory);
    expect(await result).toEqual(directory);
    expect(consume).not.toHaveBeenCalled();
    expect(worker.messages.map((message) => message.kind)).toEqual(['init', 'column-directory']);
  });
  it.each([
    null,
    { ...directory, revision: -1 },
    { ...directory, entries: [{ ...directory.entries[0], cz: 4 }] },
    { ...directory, entries: [directory.entries[0], directory.entries[0]] },
    { status: 'unknown', reason: 'budget-exhausted', entries: directory.entries },
  ])('invalid worker reply %j is never complete', async (reply) => {
    const { persistence, worker } = await open();
    const result = persistence.inspectColumnDirectory(-2, 3);
    worker.complete(reply);
    expect(await result).toEqual({ status: 'unknown', reason: 'invalid-data' });
  });
  it('preserves a valid budget-exhausted reply without publishing partial keys', async () => {
    const { persistence, worker } = await open();
    const result = persistence.inspectColumnDirectory(-2, 3);
    worker.complete({ status: 'unknown', reason: 'budget-exhausted' });
    expect(await result).toEqual({ status: 'unknown', reason: 'budget-exhausted' });
  });
  it('a concurrent chunk save supersedes an older reply', async () => {
    const { persistence, worker } = await open();
    const result = persistence.inspectColumnDirectory(-2, 3);
    await persistence.saveSnapshots([
      {
        key: '0,0,0',
        cx: 0,
        cy: 0,
        cz: 0,
        seedText: 'query',
        generatorVersion: 11,
        revision: 1,
        voxels: new Uint16Array(CHUNK_SIZE ** 3),
      },
    ]);
    worker.complete(directory);
    expect(await result).toEqual({ status: 'unknown', reason: 'superseded' });
  });
  it('world identity replacement supersedes an older reply', async () => {
    const { persistence, worker } = await open();
    const result = persistence.inspectColumnDirectory(-2, 3);
    persistence.worldId = 'another-world';
    worker.complete(directory);
    expect(await result).toEqual({ status: 'unknown', reason: 'superseded' });
  });
  it('disposal rejects an in-flight observation without publishing its late reply', async () => {
    const { persistence, worker } = await open();
    const result = persistence.inspectColumnDirectory(-2, 3);
    const rejected = expect(result).rejects.toThrow(/disposed/);
    persistence.dispose();
    worker.complete(directory);
    await rejected;
  });
});
