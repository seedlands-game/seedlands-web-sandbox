// S0 characterization only. Run against the frozen base before migrating production code.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createServer } from 'vite';
import { loadVerifiedPackArtifacts } from '../../../scripts/pack-integrity.mjs';

const root = resolve(import.meta.dirname, '../../..');
const baseSha = 'c18a890c7f97f76421e13565ec628d8c50a942da';
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), baseSha);
assert.equal(
  execFileSync('git', ['diff', baseSha, '--', 'apps', 'packages', 'scripts', 'pnpm-lock.yaml'], {
    cwd: root,
    encoding: 'utf8',
  }),
  '',
  'Capture must use unchanged baseline production code.',
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const artifacts = await loadVerifiedPackArtifacts(resolve(root, 'apps/web/dist/packs/packs.lock.json'));
const runner = await createServer({
  root,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false },
});
let session;
const data = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
};
try {
  const { HeadlessSession } = await runner.ssrLoadModule('/packages/game-core/src/server/headless/headless-session.ts');
  const { assembleProductPacks } = await runner.ssrLoadModule('/packages/game-core/src/server/composition/host-api.ts');
  const { nodeCorePlatform } = await runner.ssrLoadModule('/scripts/headless/node-core-platform.ts');
  const { stringifyWorldJson, decodeCheckpointRequest } = await runner.ssrLoadModule(
    '/scripts/headless/jsonl-transport.ts',
  );
  session = await HeadlessSession.create({
    seedText: 'kernel-migration-c18a890-v1',
    platform: nodeCorePlatform,
    createComposition: () => assembleProductPacks(artifacts),
  });
  data(await session.world.clock({ kind: 'pause' }));
  const identity = data(await session.world.identity());
  data(await session.world.command({ type: 'set-block', position: [2, 30, 2], voxel: 4 }, { sequence: 1 }));
  // Fixture setup uses existing trusted host APIs; this is not player-input evidence.
  session.runtime.server.giveItem(identity.playerId, { itemId: 'berry', count: 3 });
  session.runtime.server.giveItem(identity.playerId, { itemId: 'wood-axe', count: 1, instance: { durability: 41 } });
  const created = data(
    await session.world.character({
      kind: 'create',
      profile: { name: '迁移样本', personality: '等待并保留行为回执。' },
      position: [1.5, 34, 0.5],
      behaviorTree: {
        goal: { description: 'Speak once and keep a running hold.' },
        definition: {
          version: 1,
          root: {
            id: 'sequence',
            type: 'sequence',
            children: [
              { id: 'say-once', type: 'action', skill: 'speak', args: { text: 'baseline-once' } },
              { id: 'wait-after', type: 'action', skill: 'hold' },
            ],
          },
        },
      },
    }),
  );
  assert.equal(created.kind, 'created');
  const entityId = created.character.entityId;
  data(await session.world.clock({ kind: 'advance', elapsedMs: 100 }));
  const snapshot = data(await session.world.checkpoint({ kind: 'export' })).snapshot;
  assert.ok(snapshot);
  const wire = stringifyWorldJson({ method: 'checkpoint', args: [{ kind: 'restore', snapshot }] });
  const compressed = gzipSync(wire, { level: 9 });
  const decoded = decodeCheckpointRequest(JSON.parse(gunzipSync(compressed).toString('utf8')));
  data(await session.world.checkpoint(decoded.args[0]));
  data(await session.world.clock({ kind: 'advance', elapsedMs: 100 }));
  assert.equal(data(await session.world.inspect({ kind: 'voxel', position: [2, 30, 2] })).voxel, 4);
  const observed = data(await session.world.character({ kind: 'observe', entityId, sinceCursor: 0 }));
  assert.equal(observed.kind, 'observation');
  assert.equal(
    observed.observation.events.filter((event) => event.type === 'speech' && event.text === 'baseline-once').length,
    1,
  );
  assert.ok(
    observed.observation.character.behaviorTree.runtime.skills.some(
      (skill) => skill.nodeId === 'wait-after' && skill.status === 'running',
    ),
  );
  const inventory = session.runtime.server.getInventory(identity.playerId);
  assert.equal(inventory.slots.find((slot) => slot?.itemId === 'berry')?.count, 3);
  assert.equal(inventory.slots.find((slot) => slot?.itemId === 'wood-axe')?.instance?.durability, 41);
  const receipt = {
    baseSha,
    capturedAt: new Date().toISOString(),
    fixture: 'base-checkpoint.json.gz',
    fixtureSha256: digest(compressed),
    uncompressedSha256: digest(wire),
    bytes: compressed.length,
    identity,
    entityId,
    packLock: JSON.parse(await readFile(resolve(root, 'apps/web/dist/packs/packs.lock.json'), 'utf8')),
    lockfileSha256: digest(await readFile(resolve(root, 'pnpm-lock.yaml'))),
    verified: [
      'base export/decode/restore',
      'edited voxel',
      'inventory and durability',
      'running hold',
      'speech exactly once',
    ],
    notVerified: [
      'station in-flight output',
      'paired cognition/PG checkpoint',
      'migrated architecture restore',
      'browser C0-C5',
    ],
  };
  await writeFile(resolve(import.meta.dirname, 'base-checkpoint.json.gz'), compressed, { flag: 'wx' });
  await writeFile(
    resolve(import.meta.dirname, 'base-checkpoint-receipt.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
    { flag: 'wx' },
  );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally {
  await session?.dispose();
  await runner.close();
}
