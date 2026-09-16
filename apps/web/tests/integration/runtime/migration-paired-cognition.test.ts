import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { startResidentServer } from '../../../../agent-server/src/node/resident-host';
import { createPostgresFrameworkPersistence } from '../../../../agent-server/src/workspace';
import { startHostDatabase, WireClient } from '../../../../agent-server/tests/resident-host-fixture';
import { waitCapabilities } from '../../../../agent-server/tests/fixtures';

// Frozen c18a890 bytes; provenance is recorded with the migration, never loaded from it.
const fixture = new URL('../../fixtures/checkpoints/paired-cognition-checkpoint.json.gz', import.meta.url);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

it('restores the frozen paired cognition scheduler once through PostgreSQL and the resident wire protocol', async () => {
  const compressed = readFileSync(fixture);
  expect(hash(compressed)).toBe('c9d937c5b961f1aaea6e306f98f60a4cca6cc6a9cf6442135732b8df3f8e7d04');
  const bytes = gunzipSync(compressed);
  expect(hash(bytes)).toBe('78583ed9ffcf59dd039e7bab6b8938fae2b1401d845c77b391816f0badb99503');
  const container = `seedlands-migration-paired-${process.pid}`;
  let database: Awaited<ReturnType<typeof startHostDatabase>> | undefined;
  let framework: Awaited<ReturnType<typeof createPostgresFrameworkPersistence>> | undefined;
  let host: Awaited<ReturnType<typeof startResidentServer>> | undefined;
  let client: WireClient | undefined;
  try {
    database = await startHostDatabase(container, 'local-migration-fixture-password');
    framework = await createPostgresFrameworkPersistence(database.connectionString);
    const origin = 'http://127.0.0.1:5173';
    host = await startResidentServer({
      workspace: database.workspace,
      framework,
      flash: null,
      pro: null,
      allowedOrigins: [origin],
      pairingToken: 'local-migration-fixture-token',
      port: 0,
    });
    const target = {
      worldId: 'seedlands:g4:kernel-migration-c18a890-station-v1',
      timelineId: 'migration-paired-recovered',
      epoch: 'migration-paired-recovery-epoch',
    };
    const identity = {
      worldId: target.worldId,
      timelineId: target.timelineId,
      actorId: 's0-cognition-resident',
      incarnation: 's0-life-1',
    };
    client = await WireClient.connect(host.url, origin);
    client.send({
      kind: 'hello',
      pairingToken: host.pairingToken,
      world: target,
      authoringCapabilities: waitCapabilities(),
    });
    await client.wait('ready');
    client.send({ kind: 'clock', paused: true });
    const transfer = {
      kind: 'checkpoint-import',
      requestId: 'migration-import',
      transferId: 'migration-transfer',
      part: 0,
      parts: 1,
      content: bytes.toString('base64'),
      sha256: hash(bytes),
    };
    client.send(transfer);
    expect(await client.wait('checkpoint-imported')).toMatchObject({ complete: true });
    const recovered = await database.workspace.getRuntimeMetadata(identity);
    expect(recovered).toMatchObject({
      revision: 2,
      logicalRounds: 7,
      compactions: 0,
      snapshot: {
        version: 1,
        scheduler: {
          version: 1,
          fallbackSeconds: 60,
          remainingMs: 500,
          paused: true,
          blocked: false,
          inFlight: true,
          pendingReasons: ['checkpoint recovery pending'],
          episodes: [['station-reload', 1]],
        },
      },
    });
    expect(await database.workspace.listBindings(target.worldId, target.timelineId)).toEqual([identity]);
    client.send({ ...transfer, requestId: 'migration-replay' });
    expect(await client.wait('error')).toMatchObject({ code: 'CHECKPOINT_IMPORT_REJECTED' });
    expect(await database.workspace.getRuntimeMetadata(identity)).toEqual(recovered);
    expect(await database.workspace.listBindings(target.worldId, target.timelineId)).toEqual([identity]);
  } finally {
    await client?.close();
    await host?.close();
    await framework?.close();
    await database?.workspace.close();
    spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8' });
  }
}, 150_000);
