import { describe, expect, it } from 'vitest';
import type { PortableWorkspace } from '../../apps/agent-server/src/workspace';
import {
  assertModelDispatchBudget,
  assertNoModelDispatchAfterClose,
  type RealThreeProCall,
  validateRealThreeCompaction,
} from '../../changes/2026-09-10-npc-composable-baseline/e2e/real-three-evidence';

const binding = (actorId: string) => ({
  worldId: 'real-three-world',
  timelineId: 'real-three-timeline',
  actorId,
  incarnation: `character-${actorId.at(-1)}`,
});

const task = {
  task: 'compact_memory',
  frozenWindowId: 'window-1',
  expectedMemoryRevision: 1,
  throughJournalSeq: 3,
  throughEventCursor: 4,
  oldMemory: 'No prior experience.',
  journalIndex: [
    { messageIndex: 0, journalSeq: 1 },
    { messageIndex: 1, journalSeq: 2 },
    { messageIndex: 2, journalSeq: 3 },
  ],
} as const;

const prefix = 'You are the authorized Pro memory editor. Use only the current MEMORY and supplied frozen window.';
const toolNames = ['read_file', 'propose_memory_update'] as const;

const storedMessages = () =>
  [
    {
      type: 'human',
      data: { content: JSON.stringify({ observation: { actorId: 'npc-2' } }), additional_kwargs: {} },
    },
    {
      type: 'ai',
      data: {
        content: '',
        additional_kwargs: {},
        tool_calls: [{ id: 'read-memory', name: 'read_file', args: { path: '/MEMORY.md' }, type: 'tool_call' }],
      },
    },
    {
      type: 'tool',
      data: { content: 'current memory', tool_call_id: 'read-memory', additional_kwargs: {} },
    },
    { type: 'human', data: { content: JSON.stringify(task), additional_kwargs: {} } },
  ] as const;

const wireMessages = () => [
  { role: 'system', content: [{ type: 'text', text: prefix }] },
  { role: 'user', content: JSON.stringify({ observation: { actorId: 'npc-2' } }) },
  {
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: 'read-memory',
        type: 'function',
        function: { name: 'read_file', arguments: JSON.stringify({ path: '/MEMORY.md' }) },
      },
    ],
  },
  { role: 'tool', content: 'current memory', tool_call_id: 'read-memory' },
  { role: 'user', content: JSON.stringify(task) },
];

function proCall(overrides: Partial<RealThreeProCall> = {}): RealThreeProCall {
  return {
    request: {
      model: 'pro',
      messages: wireMessages(),
      tools: toolNames.map((name) => ({ type: 'function', function: { name, description: name, parameters: {} } })),
    },
    startedAt: 100,
    finishedAt: 120,
    response: { status: 200, finishReason: 'tool_calls', toolCount: 1 },
    ...overrides,
  };
}

function portable(actorId: string, compacted = false): PortableWorkspace {
  const actorBinding = binding(actorId);
  const namespace = `namespace-${actorId}`;
  const requestId = 'auto-compaction';
  const journal = [1, 2, 3].map((seq) => ({
    namespace,
    seq,
    idempotency_key: `journal-${seq}`,
    message_id: `message-${seq}`,
    window_id: 'window-1',
    message: { type: seq === 1 ? 'human' : 'ai', data: { content: `message ${seq}` } },
    content_hash: `hash-${seq}`,
    world_event_range: null,
  }));
  const base: PortableWorkspace = {
    format: 'seedlands-npc-workspace',
    schemaVersion: 1,
    exportedAt: '2026-09-11T00:00:00.000Z',
    binding: actorBinding,
    state: {
      namespace,
      binding: actorBinding,
      current_window_id: compacted ? 'window-2' : 'window-1',
      memory_revision: compacted ? 2 : 1,
      next_journal_seq: 4,
      received_through: 4,
      included_through: 4,
      compacted_through: compacted ? 4 : 0,
    },
    documents: [
      {
        namespace,
        path: '/MEMORY.md',
        revision: 1,
        content: task.oldMemory,
        writer_role: 'birth-package',
      },
      ...(compacted
        ? [
            {
              namespace,
              path: '/MEMORY.md',
              revision: 2,
              content: 'Remembered the camp task.',
              content_hash: 'sha256:remembered-camp-task',
              writer_role: 'pro-memory-editor',
            },
          ]
        : []),
    ],
    journal,
    events: [],
    eventPages: [],
    runtimeMetadata: { namespace, revision: 1, snapshot: {}, logical_rounds: 1, compactions: compacted ? 1 : 0 },
    windows: compacted
      ? [
          {
            namespace,
            window_id: 'window-1',
            status: 'sealed',
            memory_revision: 1,
            starts_after_journal_seq: 0,
            frozen_through_journal_seq: 3,
            frozen_through_event_cursor: 4,
          },
          {
            namespace,
            window_id: 'window-2',
            status: 'active',
            memory_revision: 2,
            starts_after_journal_seq: 3,
            frozen_through_journal_seq: null,
            frozen_through_event_cursor: null,
          },
        ]
      : [
          {
            namespace,
            window_id: 'window-1',
            status: 'active',
            memory_revision: 1,
            starts_after_journal_seq: 0,
            frozen_through_journal_seq: null,
            frozen_through_event_cursor: null,
          },
        ],
    manifests: compacted
      ? [
          {
            namespace,
            request_id: `${requestId}:model:1`,
            logical_model: 'pro',
            through_journal_seq: 3,
            request_payload_ref: 'request-blob',
            prefix_ref: 'prefix-blob',
            tool_schema_ref: 'tools-blob',
          },
        ]
      : [],
    receipts: compacted
      ? [{ namespace, request_id: requestId, outcome: { status: 'published', frozenWindowId: 'window-1' } }]
      : [],
    compactionCommits: compacted
      ? [
          {
            namespace,
            commit_id: 'commit-1',
            frozen_window_id: 'window-1',
            through_journal_seq: 3,
            through_event_cursor: 4,
            old_memory_revision: 1,
            new_memory_revision: 2,
            next_window_id: 'window-2',
            sources: [{ journalSeq: 3, kind: 'resident-decision' }],
          },
        ]
      : [],
    blobs: compacted
      ? [
          {
            content_hash: 'request-blob',
            payload: {
              messages: storedMessages(),
              systemMessage: {
                type: 'system',
                data: { content: [{ type: 'text', text: prefix }], additional_kwargs: {} },
              },
            },
          },
          { content_hash: 'prefix-blob', payload: prefix },
          { content_hash: 'tools-blob', payload: toolNames.map((name) => ({ name })) },
        ]
      : [],
  };
  return base;
}

const workspaces = () => [portable('npc-1'), portable('npc-2', true), portable('npc-3')];
const mutate = (change: (workspace: PortableWorkspace) => void): readonly PortableWorkspace[] => {
  const copy = structuredClone(workspaces()) as PortableWorkspace[];
  change(copy[1]!);
  return copy;
};

describe('real-three compaction evidence', () => {
  it('enforces the model dispatch cap before fetch', () => {
    expect(() => assertModelDispatchBudget(0, 1)).not.toThrow();
    expect(() => assertModelDispatchBudget(1, 1)).toThrow('model dispatch budget exhausted');
  });

  it('requires Flash and Pro dispatch counts to stay fixed after close', () => {
    expect(() =>
      assertNoModelDispatchAfterClose([
        { flashCalls: 12, proCalls: 1 },
        { flashCalls: 12, proCalls: 1 },
        { flashCalls: 12, proCalls: 1 },
      ]),
    ).not.toThrow();
    expect(() =>
      assertNoModelDispatchAfterClose([
        { flashCalls: 12, proCalls: 1 },
        { flashCalls: 13, proCalls: 1 },
      ]),
    ).toThrow('model dispatch occurred after close');
    expect(() =>
      assertNoModelDispatchAfterClose([
        { flashCalls: 12, proCalls: 1 },
        { flashCalls: 12, proCalls: 2 },
      ]),
    ).toThrow('model dispatch occurred after close');
  });

  it('accepts zero calls only when no workspace published a compaction', () => {
    expect(validateRealThreeCompaction([], [portable('npc-1'), portable('npc-2'), portable('npc-3')])).toEqual({
      proCalls: 0,
      manifestCount: 0,
      receiptCount: 0,
      commitCount: 0,
    });
    expect(() => validateRealThreeCompaction([], workspaces())).toThrow('without a Pro call');
    const manifested = structuredClone([
      portable('npc-1'),
      portable('npc-2'),
      portable('npc-3'),
    ]) as PortableWorkspace[];
    Object.assign(manifested[1]!, { manifests: [{ logical_model: 'pro' }] });
    expect(() => validateRealThreeCompaction([], manifested)).toThrow('without a dispatched Pro call');
  });

  it('links one wire request through its durable manifest to the matching actor and published memory', () => {
    expect(validateRealThreeCompaction([proCall()], workspaces())).toEqual({
      proCalls: 1,
      manifestCount: 1,
      receiptCount: 1,
      commitCount: 1,
      actorId: 'npc-2',
      frozenWindowId: 'window-1',
      currentWindowId: 'window-2',
      oldMemoryRevision: 1,
      memoryRevision: 2,
      throughJournalSeq: 3,
      throughEventCursor: 4,
      sourceCount: 1,
      runtimeCompactions: 1,
      memoryContentHash: 'sha256:remembered-camp-task',
    });
  });

  it('rejects a pre-existing memory lineage on an otherwise untouched resident', () => {
    const evidence = structuredClone(workspaces()) as PortableWorkspace[];
    Object.assign(evidence[0]!.state, { memory_revision: 2 });
    expect(() => validateRealThreeCompaction([proCall()], evidence)).toThrow('fresh revision-1 lineage');
  });

  it.each([
    ['two calls', [proCall(), proCall()], workspaces()],
    [
      'unauthorized tools',
      [
        proCall({
          request: {
            ...(proCall().request as Record<string, unknown>),
            tools: [{ type: 'function', function: { name: 'propose_behavior_update' } }],
          },
        }),
      ],
      workspaces(),
    ],
    [
      'wrong actor binding',
      [proCall()],
      mutate((entry) => Object.assign(entry, { binding: { ...entry.binding, actorId: 'npc-other' } })),
    ],
    [
      'wrong frozen window',
      [proCall()],
      mutate((entry) => Object.assign(entry.compactionCommits[0]!, { frozen_window_id: 'window-other' })),
    ],
    [
      'wrong memory revision',
      [proCall()],
      mutate((entry) => Object.assign(entry.compactionCommits[0]!, { old_memory_revision: 2 })),
    ],
    [
      'source outside frozen journal',
      [proCall()],
      mutate((entry) =>
        Object.assign(entry.compactionCommits[0]!, { sources: [{ journalSeq: 99, kind: 'observed' }] }),
      ),
    ],
    [
      'different actor in the durable message sequence',
      [proCall()],
      mutate((entry) => {
        const requestBlob = entry.blobs.find((blob) => blob.content_hash === 'request-blob')!;
        const payload = requestBlob.payload as { messages: { data: { content: string } }[] };
        payload.messages[0]!.data.content = JSON.stringify({ observation: { actorId: 'npc-other' } });
      }),
    ],
    [
      'unsettled runtime compaction count',
      [proCall()],
      mutate((entry) => Object.assign(entry.runtimeMetadata, { compactions: 0 })),
    ],
    ['missing published receipt', [proCall()], mutate((entry) => Object.assign(entry, { receipts: [] }))],
    ['missing response marker', [proCall({ finishedAt: undefined, response: undefined })], workspaces()],
  ])('rejects %s', (_label, calls, evidence) => {
    expect(() =>
      validateRealThreeCompaction(calls as readonly RealThreeProCall[], evidence as PortableWorkspace[]),
    ).toThrowError();
  });
});
