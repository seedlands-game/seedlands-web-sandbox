import { ToolMessage, type BaseMessage } from '@langchain/core/messages';
import type { PersistentNpcWorkspace } from './workspace/postgres.js';
import type { WorkspaceBinding } from './workspace/types.js';

/** Persist intermediate model/tool receipts before another step, including interrupted rounds. */
export class ResidentTurnJournal {
  private readonly saved = new Set<string>();
  constructor(
    private readonly workspace: PersistentNpcWorkspace,
    private readonly binding: WorkspaceBinding,
    existing: readonly BaseMessage[],
  ) {
    for (const message of existing) if (message.id) this.saved.add(message.id);
  }
  adopt(messages: readonly BaseMessage[]): void {
    for (const message of messages) if (message.id) this.saved.add(message.id);
  }
  async append(messages: readonly BaseMessage[]): Promise<void> {
    for (const message of messages) {
      if (!message.id) message.id = crypto.randomUUID();
      if (this.saved.has(message.id)) continue;
      await this.workspace.appendMessages(this.binding, [{ idempotencyKey: `message:${message.id}`, message }]);
      this.saved.add(message.id);
    }
  }
  async closeInterruptedTools(messages: readonly BaseMessage[]): Promise<void> {
    const open = new Set<string>();
    for (const message of messages) {
      if ('tool_calls' in message && Array.isArray(message.tool_calls))
        for (const call of message.tool_calls) if (typeof call.id === 'string') open.add(call.id);
      if ('tool_call_id' in message && typeof message.tool_call_id === 'string') open.delete(message.tool_call_id);
    }
    await this.append(
      [...open].map(
        (id) =>
          new ToolMessage({
            id: `interrupted:${id}`,
            tool_call_id: id,
            status: 'error',
            content: JSON.stringify({
              status: 'interrupted',
              outcome: 'unknown',
              source: 'host-recovery',
              message:
                'The previous round stopped before its receipt was persisted. Observe Authority before deciding; this is not evidence that the action failed or succeeded.',
            }),
          }),
      ),
    );
  }
}
