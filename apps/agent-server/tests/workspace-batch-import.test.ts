import { createServer } from 'node:net';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PersistentNpcWorkspace,
  type PortableWorkspace,
  type PortableWorkspaceImport,
  type WorkspaceBinding,
  type WorkspaceTimelineScope,
} from '../src/workspace';

const dockerAvailable =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8',
  }).status === 0;
const describePostgres = dockerAvailable ? describe : describe.skip;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describePostgres('atomic portable workspace batch import with actual PostgreSQL', () => {
  const containerName = `seedlands-workspace-batch-${process.pid}`;
  const password = 'fake-local-batch-password';
  let workspace: PersistentNpcWorkspace;

  beforeAll(async () => {
    const port = await freePort();
    const connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/workspace_batch`;
    const started = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '-d',
        '--name',
        containerName,
        '-e',
        `POSTGRES_PASSWORD=${password}`,
        '-e',
        'POSTGRES_DB=workspace_batch',
        '-p',
        `127.0.0.1:${port}:5432`,
        'postgres:16-alpine',
      ],
      { encoding: 'utf8', timeout: 120_000 },
    );
    if (started.status !== 0) throw new Error(`owned PostgreSQL failed to start: ${started.stderr}`);
    workspace = PersistentNpcWorkspace.open({ connectionString, schema: 'workspace_batch' });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await workspace.pool.query('SELECT 1');
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!ready) throw new Error('owned PostgreSQL did not become ready');
    await workspace.setup();
  }, 150_000);

  afterAll(async () => {
    await workspace?.close();
    spawnSync('docker', ['rm', '-f', containerName], { encoding: 'utf8' });
  });

  async function source(timelineId: string, actorId: string, marker: string): Promise<PortableWorkspace> {
    const binding: WorkspaceBinding = { worldId: 'source-world', timelineId, actorId, incarnation: '1' };
    await workspace.initializeNpc(binding, {
      agent: `agent-${marker}`,
      soul: `soul-${marker}`,
      memory: `memory-${marker}`,
      memoryEstimatedTokens: 2,
      behavior: { revision: 1, marker },
      templateVersion: 'batch-v1',
    });
    return workspace.exportPortable(binding);
  }

  const target = (scope: WorkspaceTimelineScope, portable: PortableWorkspace): WorkspaceBinding => ({
    ...portable.binding,
    worldId: scope.worldId,
    timelineId: scope.timelineId,
  });

  const entries = (scope: WorkspaceTimelineScope, portables: readonly PortableWorkspace[]): PortableWorkspaceImport[] =>
    portables.map((portable) => ({ target: target(scope, portable), portable }));

  it('rolls back the first member when PostgreSQL fails while inserting the second, then imports all members', async () => {
    const portables = await Promise.all([
      source('failure-source', 'actor-1', 'failure-1'),
      source('failure-source', 'actor-2', 'failure-2'),
    ]);
    const scope = { worldId: 'target-world', timelineId: 'target-failure' } as const;
    await workspace.pool.query(`
      CREATE OR REPLACE FUNCTION workspace_batch.reject_second_batch_member() RETURNS trigger AS $$
      BEGIN
        IF NEW.binding->>'timelineId' = 'target-failure' AND NEW.binding->>'actorId' = 'actor-2' THEN
          RAISE EXCEPTION 'injected second member failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_second_batch_member
      BEFORE INSERT ON workspace_batch.workspace_state
      FOR EACH ROW EXECUTE FUNCTION workspace_batch.reject_second_batch_member();
    `);
    await expect(workspace.importPortableBatch(scope, entries(scope, portables))).rejects.toThrow(
      'injected second member failure',
    );
    expect(await workspace.listBindings(scope.worldId, scope.timelineId)).toEqual([]);
    await workspace.pool.query(`DROP TRIGGER reject_second_batch_member ON workspace_batch.workspace_state`);
    await workspace.importPortableBatch(scope, entries(scope, portables));
    expect(await workspace.listBindings(scope.worldId, scope.timelineId)).toEqual(
      expect.arrayContaining(portables.map((portable) => target(scope, portable))),
    );
  });

  it('serializes concurrent colliding batches so exactly one complete checkpoint wins', async () => {
    const [a1, a2, b1, b2] = await Promise.all([
      source('concurrent-a', 'shared-1', 'A-1'),
      source('concurrent-a', 'shared-2', 'A-2'),
      source('concurrent-b', 'shared-1', 'B-1'),
      source('concurrent-b', 'shared-2', 'B-2'),
    ]);
    const scope = { worldId: 'target-world', timelineId: 'target-concurrent' } as const;
    const settled = await Promise.allSettled([
      workspace.importPortableBatch(scope, entries(scope, [a1, a2])),
      workspace.importPortableBatch(scope, entries(scope, [b2, b1])),
    ]);
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await workspace.listBindings(scope.worldId, scope.timelineId)).toHaveLength(2);
    const souls = await Promise.all(
      [a1, a2].map((portable) => workspace.readFile(target(scope, portable), '/SOUL.md', 'system')),
    );
    const contents = souls.map((document) => document.content).sort();
    expect([
      ['soul-A-1', 'soul-A-2'],
      ['soul-B-1', 'soul-B-2'],
    ]).toContainEqual(contents);
  });
});
