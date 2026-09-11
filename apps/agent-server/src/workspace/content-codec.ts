import { MEMORY_TOKEN_LIMIT, MEMORY_UTF8_LIMIT } from './types.js';

/** Shared by ordinary writes and portable restore; checksums do not waive content limits. */
export function validateWorkspaceDocument(path: string, content: string): number {
  const bytes = new TextEncoder().encode(content).byteLength;
  if (path === '/MEMORY.md') {
    if (!content.trim()) throw new Error('memory draft is empty');
    if (bytes > MEMORY_UTF8_LIMIT) throw new Error('memory UTF-8 size exceeds limit');
  }
  if (path === '/AGENT.md' && bytes > 32 * 1024) throw new Error('AGENT UTF-8 size exceeds limit');
  if (path === '/SOUL.md' && bytes > 4 * 1024) throw new Error('SOUL UTF-8 size exceeds limit');
  return bytes;
}

export function validateMemoryEstimate(estimate: number): void {
  if (!Number.isInteger(estimate) || estimate < 0 || estimate > MEMORY_TOKEN_LIMIT)
    throw new Error('memory token estimate exceeds limit');
}

export function validateMemoryDraft(content: string, estimate: number): number {
  if (!content.trim()) throw new Error('memory draft is empty');
  validateMemoryEstimate(estimate);
  return validateWorkspaceDocument('/MEMORY.md', content);
}

export function serializeRuntimeSnapshot(snapshot: Readonly<Record<string, unknown>>): string {
  const serialized = JSON.stringify(snapshot);
  if (new TextEncoder().encode(serialized).byteLength > 64 * 1024)
    throw new Error('runtime metadata snapshot exceeds 64 KiB');
  return serialized;
}
