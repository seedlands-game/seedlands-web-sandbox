import type { Pool } from 'pg';
import { createWorkspaceNamespace, normalizeWorkspaceBinding } from './namespace.js';
import {
  MEMORY_TOKEN_LIMIT,
  MEMORY_UTF8_LIMIT,
  type InitializeNpcInput,
  type WorkspaceBinding,
  type WorkspaceFilePath,
} from './types.js';

async function contentHash(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function initializeWorkspace(
  pool: Pool,
  schema: string,
  binding: WorkspaceBinding,
  input: InitializeNpcInput,
): Promise<void> {
  const memoryBytes = new TextEncoder().encode(input.memory).byteLength;
  if (!input.memory.trim()) throw new Error('memory draft is empty');
  if (
    !Number.isInteger(input.memoryEstimatedTokens) ||
    input.memoryEstimatedTokens < 0 ||
    input.memoryEstimatedTokens > MEMORY_TOKEN_LIMIT
  )
    throw new Error('memory token estimate exceeds limit');
  if (memoryBytes > MEMORY_UTF8_LIMIT) throw new Error('memory UTF-8 size exceeds limit');
  if (new TextEncoder().encode(input.agent).byteLength > 8 * 1024) throw new Error('AGENT UTF-8 size exceeds limit');
  if (new TextEncoder().encode(input.soul).byteLength > 4 * 1024) throw new Error('SOUL UTF-8 size exceeds limit');
  const trusted = normalizeWorkspaceBinding(binding);
  const namespace = createWorkspaceNamespace(trusted);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO ${schema}.workspace_state(namespace,binding,current_window_id,memory_revision)
       VALUES ($1,$2::jsonb,'window-1',1) ON CONFLICT (namespace) DO NOTHING`,
      [namespace, JSON.stringify(trusted)],
    );
    if (inserted.rowCount === 0) {
      const existing = await client.query<{ binding: WorkspaceBinding }>(
        `SELECT binding FROM ${schema}.workspace_state WHERE namespace=$1`,
        [namespace],
      );
      const existingBinding = existing.rows[0]?.binding;
      if (
        !existingBinding ||
        (Object.keys(trusted) as (keyof WorkspaceBinding)[]).some((key) => existingBinding[key] !== trusted[key])
      )
        throw new Error('namespace collision');
      const birthRows = await client.query<{ path: WorkspaceFilePath; content: string; template_version: string }>(
        `SELECT path,content,template_version FROM ${schema}.documents WHERE namespace=$1 AND revision=1`,
        [namespace],
      );
      const birth = new Map(birthRows.rows.map((row) => [row.path, row]));
      const expected = new Map<WorkspaceFilePath, string>([
        ['/AGENT.md', input.agent],
        ['/SOUL.md', input.soul],
        ['/MEMORY.md', input.memory],
        ['/behavior/current.json', JSON.stringify(input.behavior)],
      ]);
      if (
        birth.size !== expected.size ||
        [...expected].some(
          ([path, content]) =>
            birth.get(path)?.content !== content || birth.get(path)?.template_version !== input.templateVersion,
        )
      )
        throw new Error('NPC birth package conflicts with the immutable workspace');
      await client.query('COMMIT');
      return;
    }
    await client.query(
      `INSERT INTO ${schema}.windows(namespace,window_id,status,memory_revision,starts_after_journal_seq)
       VALUES ($1,'window-1','active',1,0)`,
      [namespace],
    );
    await client.query(`INSERT INTO ${schema}.runtime_metadata(namespace) VALUES ($1)`, [namespace]);
    const documents: readonly [WorkspaceFilePath, string, string][] = [
      ['/AGENT.md', input.agent, 'birth-package'],
      ['/SOUL.md', input.soul, 'birth-package'],
      ['/MEMORY.md', input.memory, 'birth-package'],
      ['/behavior/current.json', JSON.stringify(input.behavior), 'authority'],
    ];
    for (const [path, content, writerRole] of documents)
      await client.query(
        `INSERT INTO ${schema}.documents(namespace,path,revision,content,utf8_bytes,content_hash,schema_version,template_version,writer_role)
         VALUES ($1,$2,1,$3,$4,$5,1,$6,$7)`,
        [
          namespace,
          path,
          content,
          new TextEncoder().encode(content).byteLength,
          await contentHash(content),
          input.templateVersion,
          writerRole,
        ],
      );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
