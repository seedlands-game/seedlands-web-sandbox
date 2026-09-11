import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { startResidentServer, type ResidentConnectionLifecycle } from '../../apps/agent-server/src/node/resident-host';
import { createPostgresFrameworkPersistence } from '../../apps/agent-server/src/workspace';
import { baselineObservation } from './fixtures';
import { startHostDatabase, WireClient } from './resident-host-fixture';

const dockerAvailable =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' }).status === 0;

it.skipIf(!dockerAvailable)(
  'does not commit an import whose validation finishes after its authenticated socket closes',
  async () => {
    const containerName = `seedlands-resident-import-cancel-${process.pid}`;
    const { workspace, connectionString } = await startHostDatabase(containerName, 'fake-import-cancel-password');
    const framework = await createPostgresFrameworkPersistence(connectionString, {
      checkpointSchema: 'resident_import_cancel_checkpoint',
    });
    const source = { worldId: 'import-cancel-world', timelineId: 'source-timeline', epoch: 'source-epoch' };
    const target = { ...source, timelineId: 'target-timeline', epoch: 'target-epoch' };
    const identity = { ...source, actorId: 'resident-1', incarnation: 'life-1' };
    await workspace.initializeNpc(identity, {
      agent: 'fixture agent',
      soul: 'fixture soul',
      memory: 'fixture memory',
      behavior: baselineObservation().character.behaviorTree,
      memoryEstimatedTokens: 4,
      templateVersion: 'import-cancel-v1',
    });
    const portable = await workspace.exportPortable(identity);
    const lifecycle: ResidentConnectionLifecycle[] = [];
    const host = await startResidentServer({
      workspace,
      framework,
      flash: null,
      pro: null,
      allowedOrigins: ['http://127.0.0.1:5173'],
      pairingToken: 'import-cancel-token',
      onConnectionLifecycle: (entry) => lifecycle.push(entry),
    });
    const client = await WireClient.connect(host.url, 'http://127.0.0.1:5173');
    const importBatch = vi.spyOn(workspace, 'importPortableBatch');
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    let releaseValidation!: () => void;
    let validationEntered!: () => void;
    const validationGate = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    const validationStarted = new Promise<void>((resolve) => {
      validationEntered = resolve;
    });
    let blockFirstDigest = true;
    const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
      if (blockFirstDigest) {
        blockFirstDigest = false;
        validationEntered();
        await validationGate;
      }
      return originalDigest(algorithm, data);
    });
    try {
      client.send({ kind: 'hello', pairingToken: host.pairingToken, world: target, authoringCapabilities: [] });
      await client.wait('ready');
      client.send({ kind: 'clock', paused: true });
      const bytes = Buffer.from(
        JSON.stringify({ format: 'seedlands-resident-cognition', version: 1, source, workspaces: [portable] }),
      );
      client.send({
        kind: 'checkpoint-import',
        requestId: 'late-import',
        transferId: 'late-import-transfer',
        part: 0,
        parts: 1,
        content: bytes.toString('base64'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      await validationStarted;

      await client.close();
      await vi.waitFor(() => expect(lifecycle.some((entry) => entry.phase === 'closed')).toBe(true));
      releaseValidation();
      await vi.waitFor(() => expect(lifecycle.some((entry) => entry.phase === 'retired')).toBe(true));

      expect(importBatch).not.toHaveBeenCalled();
      expect(await workspace.listBindings(target.worldId, target.timelineId)).toEqual([]);
    } finally {
      releaseValidation();
      digest.mockRestore();
      importBatch.mockRestore();
      await client.close();
      await host.close();
      await framework.close();
      await workspace.close();
      spawnSync('docker', ['rm', '-f', containerName], { encoding: 'utf8' });
    }
  },
  150_000,
);
