import { AIMessage, ToolMessage, mapStoredMessagesToChatMessages } from '@langchain/core/messages';
import { addMessages } from '@langchain/langgraph';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ResidentTurnJournal } from '../src/resident-turn-journal';
import { hashJson } from '../src/workspace/codec';
import { appendWorkspaceMessages, restoreWorkspaceMessages } from '../src/workspace/journal';
import type { PersistentNpcWorkspace } from '../src/workspace/postgres';
import type { JournalMessage, JournalMessageInput, WorkspaceBinding } from '../src/workspace/types';

const binding: WorkspaceBinding = {
  worldId: 'world-1',
  timelineId: 'timeline-1',
  actorId: 'npc-1',
  incarnation: 'life-1',
};

function workspaceFixture() {
  const durable: JournalMessage[] = [];
  let next = 1;
  const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK' || text.includes('UPDATE test_journal'))
      return { rows: [] };
    if (text.includes('SELECT current_window_id,next_journal_seq'))
      return { rows: [{ current_window_id: 'window-1', next_journal_seq: next }] };
    if (text.includes('SELECT status FROM test_journal.windows')) return { rows: [{ status: 'active' }] };
    if (text.includes('SELECT count(*)::bigint')) return { rows: [{ row_count: next - 1, utf8_bytes: 0 }] };
    if (text.includes('INSERT INTO test_journal.journal')) {
      const storedJson = String(values?.[5]);
      const row = {
        seq: Number(values?.[1]),
        message_id: String(values?.[3]),
        window_id: String(values?.[4]),
        message: JSON.parse(storedJson) as JournalMessage['storedMessage'],
        content_hash: String(values?.[6]),
        world_event_range: null,
        created_at: '2026-09-11T00:00:00.000Z',
        message_bytes: Buffer.byteLength(storedJson, 'utf8'),
      };
      next++;
      return { rows: [row] };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const pool = {
    connect: async () => ({ query, release: vi.fn() }),
  } as unknown as Pool;
  const append = async (entries: readonly JournalMessageInput[]) => {
    const appended = await appendWorkspaceMessages(pool, 'test_journal', binding, entries);
    durable.push(...appended);
    return appended;
  };
  const workspace = {
    appendMessages: (_binding: WorkspaceBinding, entries: readonly JournalMessageInput[]) => append(entries),
    restoreMessages: restoreWorkspaceMessages,
  } as unknown as PersistentNpcWorkspace;
  return { workspace, durable, append };
}

function toolMessage(input: Readonly<{ callId: string; constructorId?: string; canonicalId: string }>) {
  const message = new ToolMessage({
    ...(input.constructorId ? { id: input.constructorId } : {}),
    tool_call_id: input.callId,
    content: JSON.stringify({ ok: true, callId: input.callId }),
  });
  message.id = input.canonicalId;
  return message;
}

function storedId(message: JournalMessage): unknown {
  return message.storedMessage.data.id;
}

describe('resident turn journal message identity', () => {
  it.each([
    ['a tool result without a constructor id', undefined],
    ['a tool result whose provider id is replaced', 'provider-response-id'],
  ])('keeps one canonical id through %s, storage, restore, and graph reduction', async (_name, constructorId) => {
    const fixture = workspaceFixture();
    const canonicalId = `turn-1:tool:${constructorId ?? 'missing'}`;
    const message = toolMessage({ callId: 'call-1', constructorId, canonicalId });
    const journal = new ResidentTurnJournal(fixture.workspace, binding, []);

    await journal.append([message]);

    expect(message.toDict().data.id).toBe(canonicalId);
    expect(fixture.durable).toHaveLength(1);
    expect(fixture.durable[0]).toMatchObject({ messageId: canonicalId });
    expect(storedId(fixture.durable[0]!)).toBe(canonicalId);
    const restored = restoreWorkspaceMessages(fixture.durable);
    expect(restored[0]?.id).toBe(canonicalId);

    await journal.append(addMessages([], restored));
    expect(fixture.durable).toHaveLength(1);
  });

  it('forces the row id into StoredMessage for callers outside ResidentTurnJournal', async () => {
    const fixture = workspaceFixture();
    const message = toolMessage({ callId: 'call-direct', canonicalId: 'direct:tool:call-direct' });

    const [stored] = await fixture.append([{ idempotencyKey: 'direct', message }]);

    expect(message.id).toBe('direct:tool:call-direct');
    expect(stored?.messageId).toBe(message.id);
    expect(storedId(stored!)).toBe(message.id);
    expect(mapStoredMessagesToChatMessages([stored!.storedMessage])[0]?.id).toBe(message.id);
  });

  it.each([undefined, 'old-provider-id'])('restores legacy row identity with stored id %s', async (legacyId) => {
    const fixture = workspaceFixture();
    const canonicalId = 'legacy-turn:tool:call-1';
    const storedMessage = new ToolMessage({
      ...(legacyId ? { id: legacyId } : {}),
      tool_call_id: 'call-1',
      content: 'original receipt',
    }).toDict();
    const row: JournalMessage = {
      seq: 1,
      messageId: canonicalId,
      windowId: 'window-1',
      storedMessage,
      contentHash: await hashJson(storedMessage),
      worldEventRange: null,
      createdAt: '2026-09-11T00:00:00.000Z',
    };
    const original = JSON.stringify(row);
    const restored = restoreWorkspaceMessages([row]);
    expect(restored[0]?.id).toBe(canonicalId);
    expect(restored[0]?.toDict().data.id).toBe(canonicalId);
    expect(JSON.stringify(row)).toBe(original);
    const journal = new ResidentTurnJournal(fixture.workspace, binding, restored);
    await journal.append(addMessages([], restored));
    expect(fixture.durable).toHaveLength(0);
  });

  it('keeps distinct tool calls and persists only the missing interrupted receipt', async () => {
    const fixture = workspaceFixture();
    const completed = toolMessage({ callId: 'call-completed', canonicalId: 'turn-1:tool:call-completed' });
    const journal = new ResidentTurnJournal(fixture.workspace, binding, []);
    await journal.append([completed]);
    const request = new AIMessage({
      id: 'turn-1:model:1',
      content: '',
      tool_calls: [
        { id: 'call-completed', name: 'observe_self', args: {}, type: 'tool_call' },
        { id: 'call-interrupted', name: 'read_file', args: { path: '/AGENT.md' }, type: 'tool_call' },
      ],
    });

    await journal.closeInterruptedTools([request, completed]);

    expect(fixture.durable).toHaveLength(2);
    const restored = restoreWorkspaceMessages(fixture.durable) as ToolMessage[];
    expect(restored.map((message) => message.tool_call_id)).toEqual(['call-completed', 'call-interrupted']);
    expect(restored.map((message) => message.id)).toEqual([
      'turn-1:tool:call-completed',
      'interrupted:call-interrupted',
    ]);
    expect(fixture.durable.map(storedId)).toEqual(restored.map((message) => message.id));
    expect(restored[1]?.content).toContain('host-recovery');
  });
});
