import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startResidentServer } from '../../apps/agent-server/src/node/resident-host';
import { createPostgresFrameworkPersistence, type PersistentNpcWorkspace } from '../../apps/agent-server/src/workspace';
import { startHostDatabase, WireClient } from './resident-host-fixture';
import { waitCapabilities } from './fixtures';

const dockerAvailable =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;
const describePostgres = dockerAvailable ? describe : describe.skip;
const schedule = {
  version: 1,
  fallbackSeconds: 60,
  remainingMs: 500,
  paused: true,
  blocked: false,
  inFlight: true,
  pendingReasons: ['unfinished conversation'],
  episodes: [['dialogue', 4]],
} as const;

describePostgres('resident checkpoint runtime codec before PostgreSQL import', () => {
  const container = `seedlands-resident-codec-${process.pid}`;
  const origin = 'http://127.0.0.1:5173';
  const token = 'fake-local-codec-token';
  let workspace: PersistentNpcWorkspace;
  let framework: Awaited<ReturnType<typeof createPostgresFrameworkPersistence>>;
  let host: Awaited<ReturnType<typeof startResidentServer>>;
  const source = { worldId: 'codec-world', timelineId: 'codec-source', epoch: 'source-epoch' };
  const identity = {
    worldId: source.worldId,
    timelineId: source.timelineId,
    actorId: 'resident-1',
    incarnation: 'life-1',
  };

  beforeAll(async () => {
    const database = await startHostDatabase(container, 'fake-local-codec-password');
    workspace = database.workspace;
    framework = await createPostgresFrameworkPersistence(database.connectionString);
    host = await startResidentServer({
      workspace,
      framework,
      flash: null,
      pro: null,
      allowedOrigins: [origin],
      pairingToken: token,
      port: 0,
    });
    await workspace.initializeNpc(identity, {
      agent: 'codec agent',
      soul: 'codec soul',
      memory: 'codec memory',
      memoryEstimatedTokens: 3,
      behavior: { revision: 1 },
      templateVersion: 'resident-v2',
    });
    await workspace.setRuntimeMetadata(identity, {
      expectedRevision: 1,
      snapshot: { version: 1, scheduler: schedule },
      logicalRounds: 7,
      compactions: 0,
    });
  }, 150000);

  afterAll(async () => {
    await host?.close();
    await framework?.close();
    await workspace?.close();
    spawnSync('docker', ['rm', '-f', container], { encoding: 'utf8' });
  });

  it('rejects checksum-valid unsupported or malformed schedules without occupying the target namespace', async () => {
    const portable = await workspace.exportPortable(identity);
    const badSnapshots = [
      { version: 2, scheduler: schedule },
      { version: 1, scheduler: { ...schedule, paused: 'true' } },
      { version: 1, scheduler: { ...schedule, remainingMs: 60001 } },
      { version: 1, scheduler: { ...schedule, pendingReasons: 'lost pending queue' } },
      {
        version: 1,
        scheduler: {
          ...schedule,
          episodes: [
            ['dialogue', 4],
            ['dialogue', 5],
          ],
        },
      },
      {},
    ];
    for (const [index, snapshot] of badSnapshots.entries()) {
      const target = { ...source, timelineId: `codec-invalid-${index}`, epoch: `target-${index}` };
      const damaged = { ...portable, runtimeMetadata: { ...portable.runtimeMetadata, snapshot } };
      const bytes = Buffer.from(
        JSON.stringify({ format: 'seedlands-resident-cognition', version: 1, source, workspaces: [damaged] }),
      );
      const client = await WireClient.connect(host.url, origin);
      try {
        client.send({ kind: 'hello', pairingToken: token, world: target, authoringCapabilities: waitCapabilities() });
        await client.wait('ready');
        client.send({ kind: 'clock', paused: true });
        client.send({
          kind: 'checkpoint-import',
          requestId: `invalid-${index}`,
          transferId: `invalid-${index}`,
          part: 0,
          parts: 1,
          content: bytes.toString('base64'),
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
        await expect(client.wait('error')).resolves.toMatchObject({
          kind: 'error',
          code: 'CHECKPOINT_IMPORT_REJECTED',
        });
        expect(await workspace.listBindings(target.worldId, target.timelineId)).toEqual([]);
        await expect(workspace.getRuntimeMetadata({ ...identity, timelineId: target.timelineId })).rejects.toThrow(
          'does not exist',
        );
      } finally {
        await client.close();
      }
    }
  }, 30000);

  it('preserves a valid in-flight recovery queue and its deadline through actual wire import', async () => {
    const portable = await workspace.exportPortable(identity);
    const target = { ...source, timelineId: 'codec-valid-target', epoch: 'target-valid' };
    const bytes = Buffer.from(
      JSON.stringify({ format: 'seedlands-resident-cognition', version: 1, source, workspaces: [portable] }),
    );
    const client = await WireClient.connect(host.url, origin);
    try {
      client.send({ kind: 'hello', pairingToken: token, world: target, authoringCapabilities: waitCapabilities() });
      await client.wait('ready');
      client.send({ kind: 'clock', paused: true });
      client.send({
        kind: 'checkpoint-import',
        requestId: 'valid',
        transferId: 'valid',
        part: 0,
        parts: 1,
        content: bytes.toString('base64'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      await expect(client.wait('checkpoint-imported')).resolves.toMatchObject({ complete: true });
      expect(await workspace.getRuntimeMetadata({ ...identity, timelineId: target.timelineId })).toMatchObject({
        logicalRounds: 7,
        snapshot: { version: 1, scheduler: schedule },
      });
    } finally {
      await client.close();
    }
  });
});
