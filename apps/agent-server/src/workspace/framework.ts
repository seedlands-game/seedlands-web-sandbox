import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { PostgresStore } from '@langchain/langgraph-checkpoint-postgres/store';
import { StoreBackend } from 'deepagents';
import { createWorkspaceStoreNamespace, createWorkspaceThreadId } from './namespace.js';
import type { WorkspaceBinding } from './types.js';

export type FrameworkPersistence = Readonly<{
  checkpointer: PostgresSaver;
  store: PostgresStore;
  close(): Promise<void>;
}>;

export async function createPostgresFrameworkPersistence(
  connectionString: string,
  options: Readonly<{ checkpointSchema?: string }> = {},
): Promise<FrameworkPersistence> {
  const checkpointer = PostgresSaver.fromConnString(connectionString, {
    schema: options.checkpointSchema ?? 'npc_langgraph',
  });
  const store = PostgresStore.fromConnString(connectionString, { ensureTables: true });
  await checkpointer.setup();
  await store.start();
  return {
    checkpointer,
    store,
    async close() {
      await Promise.all([checkpointer.end(), store.stop()]);
    },
  };
}

/**
 * Public Deep Agents adapter for the host-owned LangGraph Store. It is not
 * installed as filesystem middleware because its write/patch surface would
 * bypass the workspace permission and MEMORY publication contracts.
 */
export function createDeepAgentsStoreBackend(store: PostgresStore, binding: WorkspaceBinding): StoreBackend {
  return new StoreBackend({ store, namespace: createWorkspaceStoreNamespace(binding) });
}

export function residentAgentConfig(
  binding: WorkspaceBinding,
  windowId: string,
): Readonly<{ configurable: { thread_id: string } }> {
  if (!windowId) throw new Error('active workspace window id is required');
  return { configurable: { thread_id: `${createWorkspaceThreadId(binding)}:${windowId}` } };
}
