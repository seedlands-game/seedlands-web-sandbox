import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { AIMessage, HumanMessage, mapChatMessagesToStoredMessages, ToolMessage } from '@langchain/core/messages';
import { createGatewayChatModel } from '../../apps/agent-server/src/gateway-model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PersistentNpcWorkspace,
  type PortableWorkspace,
  type RequestManifestInput,
  type WorkspaceBinding,
} from '../../apps/agent-server/src/workspace';

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

const input = {
  agent: 'bounded agent',
  soul: 'bounded soul',
  memory: 'bounded memory',
  memoryEstimatedTokens: 3,
  behavior: { revision: 1 },
  templateVersion: 'workspace-review-v1',
} as const;

type MutablePortableWorkspace = {
  -readonly [Key in keyof PortableWorkspace]: PortableWorkspace[Key];
};

describePostgres('persistent workspace independent-review corrections with actual PostgreSQL', () => {
  const containerName = `seedlands-workspace-review-${process.pid}`;
  const password = 'fake-local-review-password';
  let connectionString = '';
  let workspace: PersistentNpcWorkspace;
  let sequence = 0;

  const binding = (label: string): WorkspaceBinding => ({
    worldId: 'review-world',
    timelineId: `timeline-${label}`,
    actorId: `actor-${label}`,
    incarnation: '1',
  });

  beforeAll(async () => {
    const port = await freePort();
    connectionString = `postgresql://postgres:${password}@127.0.0.1:${port}/workspace_review`;
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
        'POSTGRES_DB=workspace_review',
        '-p',
        `127.0.0.1:${port}:5432`,
        'postgres:16-alpine',
      ],
      { encoding: 'utf8', timeout: 120_000 },
    );
    if (started.status !== 0) throw new Error(`owned PostgreSQL failed to start: ${started.stderr}`);
    workspace = PersistentNpcWorkspace.open({ connectionString, schema: 'workspace_review' });
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

  async function initialized(label: string): Promise<WorkspaceBinding> {
    const target = binding(`${label}-${++sequence}`);
    await workspace.initializeNpc(target, input);
    return target;
  }

  async function restart(): Promise<void> {
    await workspace.close();
    workspace = PersistentNpcWorkspace.open({ connectionString, schema: 'workspace_review' });
  }

  it('blocks ordinary journal appends while frozen and has explicit soft/hard restart recovery', async () => {
    const target = await initialized('freeze');
    await workspace.appendMessages(target, [{ idempotencyKey: 'before', message: new HumanMessage('before') }]);
    const first = await workspace.freezeForCompaction(target);
    await expect(
      workspace.appendMessages(target, [{ idempotencyKey: 'during', message: new HumanMessage('during') }]),
    ).rejects.toThrow(/frozen|active/u);
    await restart();
    await workspace.markCompactionFailure(target, false);
    await workspace.appendMessages(target, [{ idempotencyKey: 'after-soft', message: new HumanMessage('after') }]);

    const second = await workspace.freezeForCompaction(target);
    await restart();
    await workspace.markCompactionFailure(target, true);
    await expect(
      workspace.appendMessages(target, [{ idempotencyKey: 'after-hard', message: new HumanMessage('blocked') }]),
    ).rejects.toThrow(/frozen|active/u);
    expect(await workspace.isCognitionSuspended(target)).toBe(true);
    const recovered = await workspace.freezeForCompaction(target);
    expect(recovered).toMatchObject({ windowId: second.windowId, throughJournalSeq: second.throughJournalSeq });
    await workspace.publishCompaction(target, {
      expectedMemoryRevision: recovered.memoryRevision,
      frozenWindowId: recovered.windowId,
      throughJournalSeq: recovered.throughJournalSeq,
      content: 'recovered only by a successful publication',
      estimatedTokens: 7,
      sources: [{ journalSeq: first.throughJournalSeq, kind: 'observed' }],
    });
    await workspace.appendMessages(target, [
      { idempotencyKey: 'after-publish', message: new HumanMessage('available') },
    ]);
    expect(await workspace.isCognitionSuspended(target)).toBe(false);
  });

  it('rejects oversized journal writes atomically and refuses unbounded row or byte reads', async () => {
    const target = await initialized('bounds');
    await expect(
      workspace.appendMessages(target, [
        { idempotencyKey: 'oversized', message: new HumanMessage('x'.repeat(1024 * 1024)) },
      ]),
    ).rejects.toThrow(/size|limit/u);
    expect(await workspace.getJournal(target)).toEqual([]);
    await workspace.appendMessages(target, [
      { idempotencyKey: 'one', message: new HumanMessage('one') },
      { idempotencyKey: 'two', message: new HumanMessage('two') },
    ]);
    await expect(workspace.getJournal(target, { limit: 1 } as never)).rejects.toThrow(/row|limit/u);
    await expect(workspace.getJournal(target, { maxUtf8Bytes: 1 } as never)).rejects.toThrow(/byte|limit/u);
  });

  it('validates the complete portable relational topology before reserving a target namespace', async () => {
    const source = await initialized('portable-source');
    await workspace.appendMessages(source, [{ idempotencyKey: 'source-message', message: new HumanMessage('source') }]);
    const frozen = await workspace.freezeForCompaction(source);
    await workspace.publishCompaction(source, {
      expectedMemoryRevision: frozen.memoryRevision,
      frozenWindowId: frozen.windowId,
      throughJournalSeq: frozen.throughJournalSeq,
      content: 'compacted source',
      estimatedTokens: 3,
      sources: [{ journalSeq: 1, kind: 'observed' }],
    });
    const portable = await workspace.exportPortable(source);
    const corruptions: readonly ((copy: MutablePortableWorkspace) => void)[] = [
      (copy) => Object.assign(copy.state, { current_window_id: 'missing-window' }),
      (copy) => {
        copy.documents = copy.documents.filter(
          (row) => row.path !== '/MEMORY.md' || row.revision !== copy.state.memory_revision,
        );
      },
      (copy) => Object.assign(copy.journal[0]!, { window_id: 'missing-window' }),
      (copy) => Object.assign(copy.state, { compacted_through: 3, included_through: 2, received_through: 1 }),
      (copy) => Object.assign(copy.compactionCommits[0]!, { next_window_id: 'missing-window' }),
    ];
    for (const corrupt of corruptions) {
      const damaged = structuredClone(portable) as MutablePortableWorkspace;
      corrupt(damaged);
      const target = binding(`portable-target-${++sequence}`);
      await expect(workspace.importPortable(target, damaged)).rejects.toThrow(/portable workspace/u);
      await expect(workspace.getRuntimeMetadata(target)).rejects.toThrow('does not exist');
    }
  });

  it('replays write-time content limits before importing checksum-valid documents or runtime snapshots', async () => {
    const source = await initialized('portable-content');
    const portable = await workspace.exportPortable(source);
    const corruptions: readonly ((copy: MutablePortableWorkspace) => void)[] = [
      ...[
        ['/AGENT.md', 'x'.repeat(32769)],
        ['/SOUL.md', 'x'.repeat(4097)],
        ['/MEMORY.md', 'x'.repeat(16385)],
        ['/MEMORY.md', '   '],
      ].map(([path, content]) => (copy: MutablePortableWorkspace) => {
        const row = copy.documents.find((entry) => entry.path === path)!;
        Object.assign(row, {
          content,
          utf8_bytes: new TextEncoder().encode(content).byteLength,
          content_hash: `sha256:${createHash('sha256').update(JSON.stringify(content)).digest('hex')}`,
        });
      }),
      (copy) => Object.assign(copy.runtimeMetadata, { snapshot: { padding: 'x'.repeat(65536) } }),
    ];
    for (const corrupt of corruptions) {
      const damaged = structuredClone(portable) as MutablePortableWorkspace;
      corrupt(damaged);
      const target = binding(`portable-content-target-${++sequence}`);
      await expect(workspace.importPortable(target, damaged)).rejects.toThrow(/limit|empty|64 KiB/u);
      await expect(workspace.getRuntimeMetadata(target)).rejects.toThrow('does not exist');
    }
    expect((await workspace.exportPortable(source)).documents).toEqual(portable.documents);
  });

  it('admits gateway messages only when their full lossless representation can enter the actual journal', async () => {
    const target = await initialized('gateway-journal');
    const makeModel = (length: number) =>
      createGatewayChatModel({
        tier: 'flash',
        baseUrl: 'http://127.0.0.1:9/v1',
        apiKey: 'fake-local',
        fetch: async () =>
          new Response(
            JSON.stringify({
              id: 'bounded-large-reasoning',
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'done',
                    reasoning_content: 'x'.repeat(length),
                  },
                },
              ],
            }),
          ),
      });
    await expect(makeModel(180000).invoke([new HumanMessage('reason')])).rejects.toThrow('journal');
    await expect(makeModel(150000).invoke([new HumanMessage('reason')])).rejects.toThrow('journal');
    expect(await workspace.getJournal(target)).toEqual([]);
    const accepted = await makeModel(120000).invoke([new HumanMessage('reason')]);
    accepted.id = 'r'.repeat(160) + ':model:8';
    const storedBytes = Buffer.byteLength(JSON.stringify(mapChatMessagesToStoredMessages([accepted])[0]), 'utf8');
    expect(storedBytes).toBeGreaterThan(480000);
    expect(storedBytes).toBeLessThan(512 * 1024);
    await workspace.appendMessages(target, [{ idempotencyKey: 'large-message', message: accepted }]);
    const restored = workspace.restoreMessages(await workspace.getJournal(target));
    expect(restored).toHaveLength(1);
    expect(restored[0]!.additional_kwargs).toEqual(accepted.additional_kwargs);
  });

  it('rejects missing journal messages and disconnected window history before reserving an import target', async () => {
    const source = await initialized('portable-continuity');
    await workspace.appendMessages(source, [
      { idempotencyKey: 'question', message: new HumanMessage('What happened at camp?') },
      {
        idempotencyKey: 'decision',
        message: new AIMessage({
          content: '',
          tool_calls: [{ id: 'camp-look', name: 'observe_self', args: {} }],
        }),
      },
      { idempotencyKey: 'receipt', message: new ToolMessage({ tool_call_id: 'camp-look', content: 'Camp is quiet.' }) },
      { idempotencyKey: 'answer', message: new AIMessage('I saw a quiet camp.') },
    ]);
    const frozen = await workspace.freezeForCompaction(source);
    await workspace.publishCompaction(source, {
      expectedMemoryRevision: frozen.memoryRevision,
      frozenWindowId: frozen.windowId,
      throughJournalSeq: frozen.throughJournalSeq,
      content: 'The camp was quiet.',
      estimatedTokens: 5,
      sources: [{ journalSeq: 4, kind: 'resident-decision' }],
    });
    await workspace.appendMessages(source, [
      { idempotencyKey: 'next-question', message: new HumanMessage('And now?') },
    ]);
    const portable = await workspace.exportPortable(source);
    const corruptions: readonly ((copy: MutablePortableWorkspace) => void)[] = [
      ...[1, 2, 3].map((missing) => (copy: MutablePortableWorkspace) => {
        copy.journal = copy.journal.filter((row) => Number(row.seq) !== missing);
      }),
      (copy) => {
        const first = copy.windows.find((row) => row.status === 'sealed')!;
        copy.windows = [...copy.windows, { ...first, window_id: 'forked-window' }];
        copy.compactionCommits = [
          ...copy.compactionCommits,
          {
            ...copy.compactionCommits[0],
            commit_id: 'forked-commit',
            frozen_window_id: 'forked-window',
            sources: [{ journalSeq: 0, kind: 'prior-memory' }],
          },
        ];
      },
      (copy) => {
        const current = copy.windows.find((row) => row.window_id === copy.state.current_window_id)!;
        copy.windows = [{ ...current, starts_after_journal_seq: 0 }];
        copy.compactionCommits = [];
        copy.journal = copy.journal.map((row) => ({ ...row, window_id: current.window_id }));
      },
    ];
    for (const corrupt of corruptions) {
      const damaged = structuredClone(portable) as MutablePortableWorkspace;
      corrupt(damaged);
      const target = binding(`portable-continuity-target-${++sequence}`);
      await expect(workspace.importPortable(target, damaged)).rejects.toThrow(/portable workspace/u);
      await expect(workspace.getRuntimeMetadata(target)).rejects.toThrow('does not exist');
    }
    const target = binding(`portable-continuity-valid-${++sequence}`);
    await workspace.importPortable(target, portable);
    const restored = await workspace.exportPortable(target);
    expect(restored.journal.map((row) => Number(row.seq)).sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5]);
    await workspace.appendMessages(target, [
      { idempotencyKey: 'after-restore', message: new HumanMessage('Continue.') },
    ]);
    const continued = await workspace.exportPortable(target);
    expect(Number(continued.state.next_journal_seq)).toBe(7);
    expect(continued.journal.map((row) => Number(row.seq)).sort((left, right) => left - right)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it('allows exact manifest and receipt retries but rejects changed immutable evidence across restart', async () => {
    const target = await initialized('immutable');
    await workspace.appendMessages(target, [{ idempotencyKey: 'request-input', message: new HumanMessage('hello') }]);
    const manifest: RequestManifestInput = {
      requestId: 'request:model:1',
      logicalModel: 'flash',
      throughJournalSeq: 1,
      requestPayload: { messages: ['hello'] },
      systemPrefix: { content: 'prefix' },
      toolSchema: [{ name: 'observe_self' }],
      toolSchemaRevision: 'tools-v1',
      modelConfigurationRevision: 'models-v1',
      gatewayAuditRef: 'audit-1',
    };
    await workspace.recordRequestManifest(target, manifest);
    await workspace.recordRequestManifest(target, manifest);
    await workspace.recordRequestReceipt(target, 'request', { status: 'failed', reason: 'timeout' });
    await workspace.recordRequestReceipt(target, 'request', { status: 'failed', reason: 'timeout' });
    await restart();
    expect(await workspace.getRequestReceipt(target, 'request')).toEqual({ status: 'failed', reason: 'timeout' });
    await workspace.recordRequestManifest(target, manifest);
    await expect(
      workspace.recordRequestManifest(target, {
        ...manifest,
        requestPayload: { messages: ['different'] },
      }),
    ).rejects.toThrow(/manifest.*conflict/u);
    await workspace.recordRequestReceipt(target, 'request', { status: 'failed', reason: 'timeout' });
    await expect(workspace.recordRequestReceipt(target, 'request', { status: 'completed' })).rejects.toThrow(
      /receipt.*conflict/u,
    );
    const exported = await workspace.exportPortable(target);
    expect(exported.manifests).toHaveLength(1);
    expect(exported.receipts).toEqual([expect.objectContaining({ outcome: { status: 'failed', reason: 'timeout' } })]);
  });
});
