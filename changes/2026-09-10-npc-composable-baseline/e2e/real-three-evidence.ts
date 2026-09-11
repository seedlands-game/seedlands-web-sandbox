import type { PortableWorkspace } from '../../../apps/agent-server/src/workspace/types';

export type RealThreeProCall = Readonly<{
  request: unknown;
  startedAt: number;
  finishedAt?: number;
  response?: unknown;
}>;

export type RealThreeCompactionEvidence = Readonly<{
  proCalls: 0 | 1;
  manifestCount: number;
  receiptCount: number;
  commitCount: number;
  actorId?: string;
  frozenWindowId?: string;
  currentWindowId?: string;
  oldMemoryRevision?: number;
  memoryRevision?: number;
  throughJournalSeq?: number;
  throughEventCursor?: number;
  sourceCount?: number;
  runtimeCompactions?: number;
  memoryContentHash?: string;
  preparedNotDispatched?: readonly Readonly<{
    actorId: string;
    modelStep: number;
    status: 'failed-budget-exhausted';
  }>[];
}>;

type JsonRecord = Record<string, unknown>;

function fail(reason: string): never {
  throw new Error(`Invalid real-three compaction evidence: ${reason}`);
}

function object(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as JsonRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be non-empty text`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) fail(`${label} must be a safe integer`);
  return parsed;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function parsedJson(value: unknown, label: string): JsonRecord {
  const source = text(value, label);
  try {
    return object(JSON.parse(source), label);
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${label} must contain JSON`);
    throw error;
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function messageText(value: unknown, label: string): string {
  if (typeof value === 'string') return value;
  return array(value, label)
    .map((entry, index) => text(object(entry, `${label}[${index}]`).text, `${label}[${index}].text`))
    .join('');
}

function storedWireMessage(value: unknown, label: string): JsonRecord {
  const stored = object(value, label);
  const type = text(stored.type, `${label}.type`);
  const data = object(stored.data, `${label}.data`);
  const additional =
    data.additional_kwargs === undefined ? {} : object(data.additional_kwargs, `${label}.additional_kwargs`);
  const nativeFields = Object.fromEntries(
    Object.entries(additional).filter(([key]) => key !== 'gateway_raw_message' && key !== 'gateway_raw_response'),
  );
  if (type === 'tool')
    return {
      role: 'tool',
      content: data.content,
      tool_call_id: data.tool_call_id,
    };
  if (type === 'ai') {
    const toolCalls =
      data.tool_calls === undefined
        ? []
        : array(data.tool_calls, `${label}.tool_calls`).map((entry, index) => {
            const call = object(entry, `${label}.tool_calls[${index}]`);
            return {
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
            };
          });
    return {
      role: 'assistant',
      content: data.content,
      ...nativeFields,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
  }
  return {
    role: type === 'system' ? 'system' : type === 'human' ? 'user' : type,
    content: data.content,
    ...nativeFields,
  };
}

function toolNames(value: unknown, wire: boolean): readonly string[] {
  return array(value, 'tools')
    .map((entry, index) => {
      const row = object(entry, `tools[${index}]`);
      return text(wire ? object(row.function, `tools[${index}].function`).name : row.name, `tools[${index}].name`);
    })
    .sort();
}

function assertOnlyMemoryTools(value: unknown, wire: boolean): void {
  if (canonical(toolNames(value, wire)) !== canonical(['propose_memory_update', 'read_file']))
    fail('Pro request must expose only read_file and propose_memory_update');
}

function assertTask(value: JsonRecord): void {
  const keys = Object.keys(value).sort();
  const expected = [
    'expectedMemoryRevision',
    'frozenWindowId',
    'journalIndex',
    'oldMemory',
    'task',
    'throughEventCursor',
    'throughJournalSeq',
  ].sort();
  if (canonical(keys) !== canonical(expected) || value.task !== 'compact_memory')
    fail('last user message is not compact_memory');
  text(value.frozenWindowId, 'frozenWindowId');
  integer(value.expectedMemoryRevision, 'expectedMemoryRevision', 1);
  integer(value.throughJournalSeq, 'throughJournalSeq');
  integer(value.throughEventCursor, 'throughEventCursor');
  if (typeof value.oldMemory !== 'string') fail('oldMemory must be text');
  array(value.journalIndex, 'journalIndex').forEach((entry, index) => {
    const row = object(entry, `journalIndex[${index}]`);
    if (Object.keys(row).length !== 2 || row.messageIndex !== index)
      fail('journalIndex message indexes must be contiguous');
    integer(row.journalSeq, `journalIndex[${index}].journalSeq`, 1);
  });
}

function assertBindings(workspaces: readonly PortableWorkspace[]): void {
  if (workspaces.length !== 3) fail('exactly three workspace exports are required');
  const first = workspaces[0]?.binding;
  const actorIds = new Set<string>();
  for (const workspace of workspaces) {
    if (!workspace.binding.actorId || actorIds.has(workspace.binding.actorId))
      fail('workspace actor bindings must be unique');
    actorIds.add(workspace.binding.actorId);
    if (workspace.binding.worldId !== first?.worldId || workspace.binding.timelineId !== first.timelineId)
      fail('workspace bindings must share one world timeline');
    const stored = object(workspace.state.binding, 'workspace state binding');
    if (canonical(stored) !== canonical(workspace.binding))
      fail('workspace state binding does not match its export binding');
  }
}

function blob(workspace: PortableWorkspace, reference: unknown, label: string): unknown {
  const id = text(reference, `${label} reference`);
  const matches = workspace.blobs.filter((entry) => entry.content_hash === id);
  if (matches.length !== 1) fail(`${label} blob is missing or duplicated`);
  return matches[0]!.payload;
}

function memoryRevisions(workspace: PortableWorkspace): readonly number[] {
  return workspace.documents
    .filter((entry) => entry.path === '/MEMORY.md')
    .map((entry) => integer(entry.revision, 'MEMORY revision', 1))
    .sort((left, right) => left - right);
}

function assertFreshDefaultWorkspace(workspace: PortableWorkspace): void {
  if (
    integer(workspace.state.memory_revision, 'default workspace memory revision', 1) !== 1 ||
    canonical(memoryRevisions(workspace)) !== canonical([1]) ||
    workspace.compactionCommits.length !== 0 ||
    integer(workspace.runtimeMetadata.compactions, 'default runtime compactions') !== 0
  )
    fail('non-compacted workspace is not on the fresh revision-1 lineage');
  const currentWindowId = text(workspace.state.current_window_id, 'default current window');
  if (
    workspace.windows.length !== 1 ||
    workspace.windows[0]!.window_id !== currentWindowId ||
    workspace.windows[0]!.status !== 'active' ||
    integer(workspace.windows[0]!.memory_revision, 'default window memory revision', 1) !== 1
  )
    fail('non-compacted workspace does not have one fresh active window');
}

function manifestRequestIdentity(manifest: Readonly<Record<string, unknown>>) {
  const value = text(manifest.request_id, 'manifest request id');
  const match = /^(.*):model:(\d+)$/u.exec(value);
  if (!match?.[1]) fail('manifest request id has no model step identity');
  return { requestId: match[1], modelStep: integer(match[2], 'manifest model step', 1) };
}

function assertManifestMatchesWire(
  workspace: PortableWorkspace,
  manifest: Readonly<Record<string, unknown>>,
  messages: readonly unknown[],
  wireTask: JsonRecord,
  wirePrefix: string,
): void {
  if (integer(manifest.through_journal_seq, 'manifest journal frontier') !== wireTask.throughJournalSeq)
    fail('Pro manifest journal frontier does not match the request');
  const payload = object(blob(workspace, manifest.request_payload_ref, 'request payload'), 'request payload');
  const storedMessages = array(payload.messages, 'manifest messages');
  const last = object(storedMessages.at(-1), 'manifest last message');
  if (last.type !== 'human') fail('manifest request does not end with a Human message');
  const task = parsedJson(object(last.data, 'manifest Human data').content, 'manifest compact_memory message');
  if (canonical(task) !== canonical(wireTask)) fail('wire and manifest compact_memory payloads differ');
  const system = object(payload.systemMessage, 'manifest system message');
  const storedPrefix = messageText(object(system.data, 'manifest system data').content, 'manifest system content');
  const savedPrefix = text(blob(workspace, manifest.prefix_ref, 'system prefix'), 'saved system prefix');
  if (storedPrefix !== savedPrefix || wirePrefix !== savedPrefix) fail('wire and manifest system prefixes differ');
  const projected = [
    storedWireMessage(system, 'manifest system message'),
    ...storedMessages.map((message, index) => storedWireMessage(message, `manifest messages[${index}]`)),
  ];
  if (canonical(projected) !== canonical(messages)) fail('wire messages do not match the durable manifest');
  assertOnlyMemoryTools(blob(workspace, manifest.tool_schema_ref, 'tool schema'), false);
}

export function assertModelDispatchBudget(currentCalls: number, maximumCalls: number): void {
  if (!Number.isSafeInteger(currentCalls) || currentCalls < 0) throw new Error('invalid current model dispatch count');
  if (!Number.isSafeInteger(maximumCalls) || maximumCalls < 1) throw new Error('invalid maximum model dispatch count');
  if (currentCalls >= maximumCalls) throw new Error('model dispatch budget exhausted');
}

export function assertNoModelDispatchAfterClose(
  snapshots: readonly Readonly<{ flashCalls: number; proCalls: number }>[],
): void {
  if (snapshots.length === 0) throw new Error('model dispatch snapshots are required');
  const first = snapshots[0]!;
  for (const [index, snapshot] of snapshots.entries()) {
    if (
      !Number.isSafeInteger(snapshot.flashCalls) ||
      snapshot.flashCalls < 0 ||
      !Number.isSafeInteger(snapshot.proCalls) ||
      snapshot.proCalls < 0
    )
      throw new Error(`invalid model dispatch snapshot at index ${index}`);
    if (snapshot.flashCalls !== first.flashCalls || snapshot.proCalls !== first.proCalls)
      throw new Error('model dispatch occurred after close');
  }
}

export function validateRealThreeCompaction(
  calls: readonly RealThreeProCall[],
  workspaces: readonly PortableWorkspace[],
): RealThreeCompactionEvidence {
  assertBindings(workspaces);
  if (calls.length > 1) fail('more than one Pro call was dispatched');
  const allManifests = workspaces.flatMap((workspace) =>
    workspace.manifests
      .filter((manifest) => manifest.logical_model === 'pro')
      .map((manifest) => ({ workspace, manifest })),
  );
  const allCommits = workspaces.flatMap((workspace) =>
    workspace.compactionCommits.map((commit) => ({ workspace, commit })),
  );
  if (calls.length === 0) {
    if (allCommits.length !== 0) fail('a compaction was published without a Pro call');
    if (allManifests.length !== 0) fail('a Pro manifest was persisted without a dispatched Pro call');
    workspaces.forEach(assertFreshDefaultWorkspace);
    return {
      proCalls: 0,
      manifestCount: 0,
      receiptCount: 0,
      commitCount: 0,
      preparedNotDispatched: [],
    };
  }

  const call = calls[0]!;
  if (!Number.isFinite(call.startedAt) || !Number.isFinite(call.finishedAt) || call.finishedAt! < call.startedAt)
    fail('Pro call has no completed timing marker');
  const response = object(call.response, 'Pro response marker');
  const responseStatus = integer(response.status, 'Pro response status');
  if (responseStatus < 200 || responseStatus >= 300) fail('Pro response was not successful');
  text(response.finishReason, 'Pro response finish reason');
  if (integer(response.toolCount, 'Pro response tool count', 1) < 1) fail('Pro response did not call a tool');

  const request = object(call.request, 'Pro wire request');
  if (request.model !== 'pro') fail('wire request did not use the Pro model');
  assertOnlyMemoryTools(request.tools, true);
  const messages = array(request.messages, 'wire messages');
  const system = object(messages[0], 'wire system message');
  if (system.role !== 'system') fail('wire request has no leading system message');
  const wirePrefix = messageText(system.content, 'wire system content');
  if (!wirePrefix.includes('authorized Pro memory editor')) fail('wire request has the wrong system authority');
  const lastUser = object(messages.at(-1), 'wire last message');
  if (lastUser.role !== 'user') fail('wire request does not end with a user message');
  const wireTask = parsedJson(lastUser.content, 'wire compact_memory message');
  assertTask(wireTask);

  const manifests = allManifests;
  const matching = manifests.filter(({ workspace, manifest }) => {
    try {
      assertManifestMatchesWire(workspace, manifest, messages, wireTask, wirePrefix);
      return true;
    } catch {
      return false;
    }
  });
  if (matching.length !== 1) fail('wire request does not match exactly one durable Pro manifest');
  const { workspace, manifest } = matching[0]!;
  const namespace = text(workspace.state.namespace, 'workspace namespace');
  if (manifest.namespace !== namespace) fail('Pro manifest is not bound to its workspace namespace');
  const { requestId, modelStep } = manifestRequestIdentity(manifest);
  if (modelStep !== 1) fail('dispatched Pro manifest is not model step 1');
  const receipts = workspace.receipts.filter((receipt) => receipt.request_id === requestId);
  if (receipts.length !== 1) fail('published compaction receipt is missing or duplicated');
  const outcome = object(receipts[0]!.outcome, 'published receipt');
  if (outcome.status !== 'published' || outcome.frozenWindowId !== wireTask.frozenWindowId)
    fail('compaction receipt is not published for the requested window');

  if (allCommits.length !== 1 || allCommits[0]!.workspace !== workspace)
    fail('the durable Pro manifest does not own the single compaction commit');
  const commit = allCommits[0]!.commit;
  const frozenWindowId = text(wireTask.frozenWindowId, 'frozenWindowId');
  const oldRevision = integer(wireTask.expectedMemoryRevision, 'expectedMemoryRevision', 1);
  const throughJournalSeq = integer(wireTask.throughJournalSeq, 'throughJournalSeq');
  const throughEventCursor = integer(wireTask.throughEventCursor, 'throughEventCursor');
  const newRevision = integer(commit.new_memory_revision, 'new memory revision', 1);
  if (oldRevision !== 1 || newRevision !== 2)
    fail('automatic compaction must advance the fresh memory lineage from 1 to 2');
  if (
    commit.namespace !== namespace ||
    commit.frozen_window_id !== frozenWindowId ||
    integer(commit.old_memory_revision, 'old memory revision', 1) !== oldRevision ||
    newRevision !== oldRevision + 1 ||
    integer(commit.through_journal_seq, 'commit journal frontier') !== throughJournalSeq ||
    integer(commit.through_event_cursor, 'commit event frontier') !== throughEventCursor
  )
    fail('compaction commit does not match the requested frontier');

  const frozenWindow = workspace.windows.find((entry) => entry.window_id === frozenWindowId);
  const nextWindowId = text(commit.next_window_id, 'next window id');
  const nextWindow = workspace.windows.find((entry) => entry.window_id === nextWindowId);
  if (
    !frozenWindow ||
    frozenWindow.status !== 'sealed' ||
    integer(frozenWindow.memory_revision, 'frozen memory revision', 1) !== oldRevision ||
    integer(frozenWindow.frozen_through_journal_seq, 'frozen journal frontier') !== throughJournalSeq ||
    integer(frozenWindow.frozen_through_event_cursor, 'frozen event frontier') !== throughEventCursor
  )
    fail('requested frozen window is not sealed at the committed frontier');
  if (
    !nextWindow ||
    nextWindow.status !== 'active' ||
    integer(nextWindow.memory_revision, 'active memory revision', 1) !== newRevision ||
    integer(nextWindow.starts_after_journal_seq, 'active window start') !== throughJournalSeq
  )
    fail('compaction did not create the expected active window');
  if (
    workspace.state.current_window_id !== nextWindowId ||
    integer(workspace.state.memory_revision, 'workspace memory revision', 1) !== newRevision ||
    integer(workspace.state.compacted_through, 'workspace compacted frontier') !== throughEventCursor
  )
    fail('workspace state was not advanced to the published compaction');

  const oldMemory = workspace.documents.find(
    (entry) => entry.path === '/MEMORY.md' && integer(entry.revision, 'old MEMORY revision', 1) === oldRevision,
  );
  if (!oldMemory || oldMemory.content !== wireTask.oldMemory)
    fail('request oldMemory does not match the frozen revision');
  const newMemory = workspace.documents.find(
    (entry) => entry.path === '/MEMORY.md' && integer(entry.revision, 'new MEMORY revision', 1) === newRevision,
  );
  if (!newMemory || newMemory.writer_role !== 'pro-memory-editor' || !text(newMemory.content, 'new MEMORY').trim())
    fail('published Pro MEMORY is missing or empty');
  const memoryContentHash = text(newMemory.content_hash, 'new MEMORY content hash');

  const frozenSequences = workspace.journal
    .filter(
      (entry) => entry.window_id === frozenWindowId && integer(entry.seq, 'journal sequence', 1) <= throughJournalSeq,
    )
    .map((entry) => integer(entry.seq, 'journal sequence', 1))
    .sort((left, right) => left - right);
  const indexedSequences = array(wireTask.journalIndex, 'journalIndex').map((entry, index) =>
    integer(object(entry, `journalIndex[${index}]`).journalSeq, `journalIndex[${index}].journalSeq`, 1),
  );
  if (canonical(indexedSequences) !== canonical(frozenSequences))
    fail('request journalIndex does not match the frozen window');
  const sources = array(commit.sources, 'compaction sources');
  let citedJournal = false;
  for (const [index, entry] of sources.entries()) {
    const source = object(entry, `compaction sources[${index}]`);
    const sequence = integer(source.journalSeq, `compaction sources[${index}].journalSeq`);
    if (source.kind === 'prior-memory') {
      if (sequence !== 0) fail('prior-memory source must use journal sequence zero');
    } else {
      if (!['observed', 'authority-receipt', 'resident-decision'].includes(String(source.kind)))
        fail('compaction source kind is invalid');
      if (!frozenSequences.includes(sequence)) fail('compaction source is outside the frozen journal');
      citedJournal = true;
    }
  }
  if (!citedJournal) fail('compaction must cite at least one frozen journal message');
  if (canonical(memoryRevisions(workspace)) !== canonical([1, 2]) || workspace.windows.length !== 2)
    fail('compacted workspace has a pre-existing or incomplete memory lineage');
  const preparedNotDispatched = manifests
    .filter((entry) => entry !== matching[0])
    .map(({ workspace: preparedWorkspace, manifest: preparedManifest }) => {
      const preparedNamespace = text(preparedWorkspace.state.namespace, 'prepared workspace namespace');
      if (preparedManifest.namespace !== preparedNamespace || preparedWorkspace === workspace)
        fail('prepared Pro manifest is not isolated from the published compaction');
      const preparedIdentity = manifestRequestIdentity(preparedManifest);
      if (preparedIdentity.requestId === requestId) fail('prepared Pro manifest reused the published request identity');
      const terminal = preparedWorkspace.receipts.filter(
        (receipt) => receipt.request_id === preparedIdentity.requestId,
      );
      if (terminal.length !== 1) fail('prepared Pro manifest has no unique terminal receipt');
      const preparedOutcome = object(terminal[0]!.outcome, 'prepared Pro receipt');
      if (preparedOutcome.status !== 'failed' || preparedOutcome.reason !== 'model dispatch budget exhausted')
        fail('prepared Pro manifest did not fail at the model dispatch budget');
      if (preparedWorkspace.state.cognition_suspended !== false)
        fail('prepared Pro workspace remained suspended after dispatch rejection');
      assertFreshDefaultWorkspace(preparedWorkspace);
      return {
        actorId: preparedWorkspace.binding.actorId,
        modelStep: preparedIdentity.modelStep,
        status: 'failed-budget-exhausted' as const,
      };
    });
  workspaces.filter((entry) => entry !== workspace).forEach(assertFreshDefaultWorkspace);
  const runtimeCompactions = integer(workspace.runtimeMetadata.compactions, 'published runtime compactions');
  if (runtimeCompactions !== 1) fail('published actor runtime compaction count did not settle to one');

  return {
    proCalls: 1,
    manifestCount: manifests.length,
    receiptCount: receipts.length + preparedNotDispatched.length,
    commitCount: allCommits.length,
    actorId: workspace.binding.actorId,
    frozenWindowId,
    currentWindowId: nextWindowId,
    oldMemoryRevision: oldRevision,
    memoryRevision: newRevision,
    throughJournalSeq,
    throughEventCursor,
    sourceCount: sources.length,
    runtimeCompactions,
    memoryContentHash,
    preparedNotDispatched,
  };
}
