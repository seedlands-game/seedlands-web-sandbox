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
const fixtureName = 'station-checkpoint.json.gz';
const receiptName = 'station-checkpoint-receipt.json';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const data = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
};
const findSlot = (inventory, itemId) => {
  const index = inventory.slots.findIndex((slot) => slot?.itemId === itemId);
  assert.notEqual(index, -1, `Missing ${itemId} in player inventory.`);
  return index;
};
const stationAt = (session, playerId) => {
  const station = session.runtime.server
    .getNearbyStations(playerId)
    .find((entry) => entry.component.kind === 'furnace');
  assert.ok(station, 'Furnace station must be projected by the production gameplay owner.');
  return station;
};

assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), baseSha);
assert.equal(
  execFileSync('git', ['diff', baseSha, '--', 'apps/web', 'packages/game-core', 'scripts'], {
    cwd: root,
    encoding: 'utf8',
  }),
  '',
  'Capture must use unchanged baseline production owners and Pack build inputs.',
);
const baseLockfile = execFileSync('git', ['show', `${baseSha}:pnpm-lock.yaml`], { cwd: root });

const artifacts = await loadVerifiedPackArtifacts(resolve(root, 'apps/web/dist/packs/packs.lock.json'));
const runner = await createServer({
  root,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false },
});
let source;
let restored;
try {
  const { HeadlessSession } = await runner.ssrLoadModule('/packages/game-core/src/server/headless/headless-session.ts');
  const { assembleProductPacks } = await runner.ssrLoadModule('/packages/game-core/src/server/composition/host-api.ts');
  const { nodeCorePlatform } = await runner.ssrLoadModule('/scripts/headless/node-core-platform.ts');
  const { stringifyWorldJson, decodeCheckpointRequest } = await runner.ssrLoadModule(
    '/scripts/headless/jsonl-transport.ts',
  );
  const createComposition = () => assembleProductPacks(artifacts);
  source = await HeadlessSession.create({
    seedText: 'kernel-migration-c18a890-station-v1',
    platform: nodeCorePlatform,
    createComposition,
  });
  data(await source.world.clock({ kind: 'pause' }));
  const identity = data(await source.world.identity());

  // A real place-voxel action owns the station spawn. set-block only clears the deterministic fixture cell.
  data(await source.world.command({ type: 'set-block', position: [2, 30, 2], voxel: 0 }, { sequence: 1 }));
  data(await source.world.command({ type: 'teleport', position: [2.5, 31, 2.5] }, { sequence: 2 }));
  data(await source.world.command({ type: 'give-item', itemId: 'furnace', count: 1 }, { sequence: 3 }));
  data(await source.world.command({ type: 'give-item', itemId: 'raw-iron', count: 1 }, { sequence: 4 }));
  data(await source.world.command({ type: 'give-item', itemId: 'coal', count: 1 }, { sequence: 5 }));
  let inventory = source.runtime.server.getInventory(identity.playerId);
  data(await source.world.command({ type: 'select-slot', slot: findSlot(inventory, 'furnace') }, { sequence: 7 }));
  data(await source.world.command({ type: 'place-voxel', position: [2, 30, 2] }, { sequence: 8 }));
  let station = stationAt(source, identity.playerId);
  inventory = source.runtime.server.getInventory(identity.playerId);
  const transfer = async (actorSlot, stationSlot, expectedStationRevision) => {
    const result = await source.runtime.performAction({
      type: 'station',
      reference: station.reference,
      expectedStationRevision,
      kind: 'transfer',
      from: 'actor',
      actorSlot,
      stationSlot,
      count: 1,
    });
    assert.equal(result.result.success, true, JSON.stringify(result));
    station = stationAt(source, identity.playerId);
  };
  await transfer(findSlot(inventory, 'raw-iron'), 0, station.component.revision);
  inventory = source.runtime.server.getInventory(identity.playerId);
  await transfer(findSlot(inventory, 'coal'), 1, station.component.revision);
  data(await source.world.clock({ kind: 'advance', elapsedMs: 2_000 }));
  const inFlight = stationAt(source, identity.playerId);
  assert.deepEqual(inFlight.component.furnace, {
    version: 1,
    input: { itemId: 'raw-iron', count: 1 },
    fuel: null,
    output: null,
    activeRecipeId: 'smelt-iron',
    remainingFuelSeconds: 18,
    progressSeconds: 2,
  });

  const snapshot = data(await source.world.checkpoint({ kind: 'export' })).snapshot;
  assert.ok(snapshot);
  const wire = stringifyWorldJson({ method: 'checkpoint', args: [{ kind: 'restore', snapshot }] });
  const compressed = gzipSync(wire, { level: 9 });
  const decoded = decodeCheckpointRequest(JSON.parse(gunzipSync(compressed).toString('utf8')));
  restored = await HeadlessSession.create({
    seedText: 'kernel-migration-c18a890-station-v1',
    platform: nodeCorePlatform,
    createComposition,
  });
  data(await restored.world.clock({ kind: 'pause' }));
  data(await restored.world.checkpoint(decoded.args[0]));
  const restoredIdentity = data(await restored.world.identity());
  const restoredInFlight = stationAt(restored, restoredIdentity.playerId);
  assert.deepEqual(restoredInFlight.component.furnace, inFlight.component.furnace);
  data(await restored.world.clock({ kind: 'advance', elapsedMs: 3_000 }));
  const completed = stationAt(restored, restoredIdentity.playerId).component.furnace;
  assert.deepEqual(completed, {
    version: 1,
    input: null,
    fuel: null,
    output: { itemId: 'iron-ingot', count: 1 },
    activeRecipeId: null,
    remainingFuelSeconds: 15,
    progressSeconds: 0,
  });
  data(await restored.world.clock({ kind: 'advance', elapsedMs: 1_000 }));
  assert.deepEqual(stationAt(restored, restoredIdentity.playerId).component.furnace, completed);

  const receipt = {
    baseSha,
    capturedAt: new Date().toISOString(),
    fixture: fixtureName,
    fixtureSha256: digest(compressed),
    uncompressedSha256: digest(wire),
    bytes: compressed.length,
    identity,
    station: {
      reference: inFlight.reference,
      position: inFlight.position,
      initial: inFlight.component.furnace,
      afterReload: completed,
    },
    packLock: JSON.parse(await readFile(resolve(root, 'apps/web/dist/packs/packs.lock.json'), 'utf8')),
    baseLockfileSha256: digest(baseLockfile),
    verified: [
      'production Overworld Pack furnace created through authorized developer-host block command',
      'raw-iron and coal consumed once into a real furnace owner',
      'in-flight furnace checkpoint export and public restore',
      'reload completes exactly one iron-ingot without replaying fuel or input consumption',
      'post-completion advance retains one output',
    ],
    notVerified: ['migrated architecture restore', 'paired cognition/PG checkpoint', 'browser C0-C5'],
  };
  await writeFile(resolve(import.meta.dirname, fixtureName), compressed, { flag: 'wx' });
  await writeFile(resolve(import.meta.dirname, receiptName), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally {
  await restored?.dispose();
  await source?.dispose();
  await runner.close();
}
