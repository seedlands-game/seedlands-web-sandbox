// S0 characterization only. This owns a temporary Docker PostgreSQL container and never reads .env or a user volume.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createServer } from 'vite';

const outputDir = resolve(import.meta.dirname);
const root = process.env.S0_CAPTURE_ROOT ? resolve(process.env.S0_CAPTURE_ROOT) : resolve(outputDir, '../../..');
const baseSha = 'c18a890c7f97f76421e13565ec628d8c50a942da';
const fixtureName = 'paired-cognition-checkpoint.json.gz';
const receiptName = 'paired-cognition-checkpoint-receipt.json';
const stationReceiptName = 'station-checkpoint-receipt.json';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const waitFor = async (client, kind) => await client.wait(kind);

assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), baseSha);
assert.equal(
  execFileSync('git', ['diff', baseSha, '--', 'apps/agent-server', 'packages/cognition-protocol'], {
    cwd: root,
    encoding: 'utf8',
  }),
  '',
  'Capture must use unchanged baseline cognition owners and protocol.',
);
const docker = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
assert.equal(docker.status, 0, `Isolated PostgreSQL requires Docker: ${docker.stderr.trim()}`);
const stationReceipt = JSON.parse(await readFile(resolve(outputDir, stationReceiptName), 'utf8'));
assert.equal(stationReceipt.baseSha, baseSha);

const runner = await createServer({
  root,
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false },
});
let database;
let framework;
let host;
let sourceClient;
let targetClient;
const containerName = `seedlands-s0-paired-${process.pid}`;
try {
  const { createPostgresFrameworkPersistence } = await runner.ssrLoadModule(
    '/apps/agent-server/src/workspace/index.ts',
  );
  const { startResidentServer } = await runner.ssrLoadModule('/apps/agent-server/src/node/resident-host.ts');
  const { startHostDatabase, WireClient } = await runner.ssrLoadModule('/tests/agent-server/resident-host-fixture.ts');
  const { waitCapabilities } = await runner.ssrLoadModule('/tests/agent-server/fixtures.ts');

  database = await startHostDatabase(containerName, 's0-temporary-paired-password');
  framework = await createPostgresFrameworkPersistence(database.connectionString, {
    checkpointSchema: 's0_pair_checkpoint',
  });
  const origin = 'http://127.0.0.1:5173';
  const source = {
    worldId: stationReceipt.identity.worldId,
    timelineId: 's0-c18a890-paired-source',
    epoch: stationReceipt.identity.epoch,
  };
  const identity = { ...source, actorId: 's0-cognition-resident', incarnation: 's0-life-1' };
  const schedule = {
    version: 1,
    fallbackSeconds: 60,
    remainingMs: 500,
    paused: true,
    blocked: false,
    inFlight: true,
    pendingReasons: ['checkpoint recovery pending'],
    episodes: [['station-reload', 1]],
  };
  await database.workspace.initializeNpc(identity, {
    agent: 'deterministic s0 cognition fixture',
    soul: 'preserve one paired recovery queue',
    memory: 'station checkpoint is in flight',
    memoryEstimatedTokens: 6,
    behavior: { revision: 1, goal: { kind: 'idle' }, definition: { type: 'wait' } },
    templateVersion: 'resident-v2',
  });
  await database.workspace.setRuntimeMetadata(identity, {
    expectedRevision: 1,
    snapshot: { version: 1, scheduler: schedule },
    logicalRounds: 7,
    compactions: 0,
  });
  host = await startResidentServer({
    workspace: database.workspace,
    framework,
    flash: null,
    pro: null,
    allowedOrigins: [origin],
    pairingToken: 's0-paired-cognition-token',
    port: 0,
  });

  sourceClient = await WireClient.connect(host.url, origin);
  sourceClient.send({
    kind: 'hello',
    pairingToken: host.pairingToken,
    world: source,
    authoringCapabilities: waitCapabilities(),
  });
  await waitFor(sourceClient, 'ready');
  sourceClient.send({ kind: 'clock', paused: true });
  sourceClient.send({ kind: 'checkpoint-export', requestId: 's0-export' });
  const ready = await waitFor(sourceClient, 'checkpoint-ready');
  assert.equal(ready.kind, 'checkpoint-ready');
  const chunks = [];
  for (let part = 0; part < ready.parts; part += 1) {
    sourceClient.send({ kind: 'checkpoint-read', requestId: `s0-read-${part}`, transferId: ready.transferId, part });
    const response = await waitFor(sourceClient, 'checkpoint-part');
    assert.equal(response.kind, 'checkpoint-part');
    assert.equal(response.part, part);
    chunks.push(Buffer.from(response.content, 'base64'));
  }
  const portableBytes = Buffer.concat(chunks);
  assert.equal(digest(portableBytes), ready.sha256);
  const portable = JSON.parse(portableBytes.toString('utf8'));
  assert.equal(portable.source.worldId, source.worldId);
  assert.equal(portable.workspaces.length, 1);
  await sourceClient.close();
  sourceClient = undefined;

  const target = { ...source, timelineId: 's0-c18a890-paired-recovered', epoch: 's0-paired-recovery-epoch' };
  targetClient = await WireClient.connect(host.url, origin);
  targetClient.send({
    kind: 'hello',
    pairingToken: host.pairingToken,
    world: target,
    authoringCapabilities: waitCapabilities(),
  });
  await waitFor(targetClient, 'ready');
  targetClient.send({ kind: 'clock', paused: true });
  const transfer = {
    kind: 'checkpoint-import',
    requestId: 's0-import',
    transferId: 's0-import-transfer',
    part: 0,
    parts: 1,
    content: portableBytes.toString('base64'),
    sha256: digest(portableBytes),
  };
  targetClient.send(transfer);
  const imported = await waitFor(targetClient, 'checkpoint-imported');
  assert.equal(imported.kind, 'checkpoint-imported');
  assert.equal(imported.complete, true);
  const restoredIdentity = {
    worldId: identity.worldId,
    timelineId: target.timelineId,
    actorId: identity.actorId,
    incarnation: identity.incarnation,
  };
  const recovered = await database.workspace.getRuntimeMetadata(restoredIdentity);
  assert.equal(recovered.revision, portable.workspaces[0].runtimeMetadata.revision);
  assert.deepEqual(recovered.snapshot, { version: 1, scheduler: schedule });
  assert.equal(recovered.logicalRounds, 7);
  assert.equal(recovered.compactions, 0);
  assert.deepEqual(await database.workspace.listBindings(target.worldId, target.timelineId), [restoredIdentity]);
  targetClient.send({ ...transfer, requestId: 's0-import-replay' });
  const replay = await waitFor(targetClient, 'error');
  assert.equal(replay.kind, 'error');
  assert.equal(replay.code, 'CHECKPOINT_IMPORT_REJECTED');

  const compressed = gzipSync(portableBytes, { level: 9 });
  const receipt = {
    baseSha,
    capturedAt: new Date().toISOString(),
    fixture: fixtureName,
    fixtureSha256: digest(compressed),
    uncompressedSha256: digest(portableBytes),
    bytes: compressed.length,
    source,
    recoveredTarget: target,
    binding: restoredIdentity,
    stationFixture: stationReceipt.fixture,
    stationFixtureSha256: stationReceipt.fixtureSha256,
    packLock: stationReceipt.packLock,
    environment: { postgres: 'temporary Docker container', dockerServerVersion: docker.stdout.trim(), modelCalls: 0 },
    verified: [
      'actual PostgreSQL workspace initialized in an owned temporary container',
      'actual resident WebSocket pairing exports a paused deterministic cognition checkpoint',
      'actual resident WebSocket import restores the in-flight scheduler into a distinct timeline',
      'target namespace contains exactly the paired resident binding',
      'replaying the import is rejected before duplicate workspace state is written',
    ],
    notVerified: ['migrated architecture restore', 'browser C0-C5', 'external model behavior'],
  };
  await writeFile(resolve(outputDir, fixtureName), compressed, { flag: 'wx' });
  await writeFile(resolve(outputDir, receiptName), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
} finally {
  await targetClient?.close();
  await sourceClient?.close();
  await host?.close();
  await framework?.close();
  await database?.workspace.close();
  spawnSync('docker', ['rm', '-f', containerName], { encoding: 'utf8' });
  await runner.close();
}
