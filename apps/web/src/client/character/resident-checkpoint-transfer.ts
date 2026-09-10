import {
  RESIDENT_CHECKPOINT_FORMAT,
  RESIDENT_CHECKPOINT_VERSION,
  RESIDENT_HISTORY_MAX,
  RESIDENT_TRANSFER_CHUNK_BYTES,
  RESIDENT_TRANSFER_MAX_BYTES,
  type ResidentCheckpointManifest,
  type ResidentWorldBinding,
} from '@seedlands/cognition-protocol';
import type { ResidentBridge } from './resident-bridge';

export async function checkpointHash(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const textId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 160;

/** Reads only the bounded portable envelope; the Agent host remains the workspace semantic validator. */
export function inspectResidentCheckpoint(content: string): Readonly<{ source: ResidentWorldBinding }> {
  const bytes = new TextEncoder().encode(content);
  if (bytes.length < 1 || bytes.length > RESIDENT_TRANSFER_MAX_BYTES) throw new Error('认知存档超出大小限制');
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error('认知存档清单无效');
  }
  if (
    !record(value) ||
    value.format !== RESIDENT_CHECKPOINT_FORMAT ||
    value.version !== RESIDENT_CHECKPOINT_VERSION ||
    !record(value.source) ||
    !['worldId', 'timelineId', 'epoch'].every((key) => textId((value.source as Record<string, unknown>)[key])) ||
    !Array.isArray(value.workspaces) ||
    value.workspaces.length > RESIDENT_HISTORY_MAX
  )
    throw new Error('认知存档清单无效');
  const manifest = value as unknown as ResidentCheckpointManifest;
  return { source: { ...manifest.source } };
}
const encodePart = (bytes: Uint8Array): string => {
  let text = '';
  for (const value of bytes) text += String.fromCharCode(value);
  return btoa(text);
};
const decodePart = (content: string): Uint8Array => {
  if (content.length > Math.ceil(RESIDENT_TRANSFER_CHUNK_BYTES / 3) * 4) throw new Error('认知存档分块过大');
  const text = atob(content);
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
};

export async function exportResidentCheckpoint(bridge: ResidentBridge): Promise<string> {
  await bridge.flushObservations();
  const ready = await bridge.request({ kind: 'checkpoint-export' }, 30000);
  if (
    ready.kind !== 'checkpoint-ready' ||
    !Number.isSafeInteger(ready.parts) ||
    ready.parts < 1 ||
    !Number.isSafeInteger(ready.byteLength) ||
    ready.byteLength < 1 ||
    ready.byteLength > RESIDENT_TRANSFER_MAX_BYTES ||
    ready.parts !== Math.ceil(ready.byteLength / RESIDENT_TRANSFER_CHUNK_BYTES) ||
    !/^[a-f0-9]{64}$/u.test(ready.sha256)
  )
    throw new Error('认知存档清单无效');
  const bytes = new Uint8Array(ready.byteLength);
  let offset = 0;
  for (let part = 0; part < ready.parts; part++) {
    const result = await bridge.request({ kind: 'checkpoint-read', transferId: ready.transferId, part });
    if (
      result.kind !== 'checkpoint-part' ||
      result.transferId !== ready.transferId ||
      result.part !== part ||
      typeof result.content !== 'string'
    )
      throw new Error('认知存档分块回执无效');
    const chunk = decodePart(result.content);
    if (chunk.length !== Math.min(RESIDENT_TRANSFER_CHUNK_BYTES, ready.byteLength - offset))
      throw new Error('认知存档长度不一致');
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if ((await checkpointHash(bytes)) !== ready.sha256) throw new Error('认知存档校验失败');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function importResidentCheckpoint(bridge: ResidentBridge, content: string): Promise<void> {
  const bytes = new TextEncoder().encode(content);
  if (bytes.length < 1 || bytes.length > RESIDENT_TRANSFER_MAX_BYTES) throw new Error('认知存档超出大小限制');
  const sha256 = await checkpointHash(bytes);
  const transferId = crypto.randomUUID();
  const parts = Math.ceil(bytes.length / RESIDENT_TRANSFER_CHUNK_BYTES);
  for (let part = 0; part < parts; part++) {
    const result = await bridge.request(
      {
        kind: 'checkpoint-import',
        transferId,
        part,
        parts,
        sha256,
        content: encodePart(
          bytes.subarray(part * RESIDENT_TRANSFER_CHUNK_BYTES, (part + 1) * RESIDENT_TRANSFER_CHUNK_BYTES),
        ),
      },
      30000,
    );
    if (
      result.kind !== 'checkpoint-imported' ||
      result.transferId !== transferId ||
      result.complete !== (part === parts - 1)
    )
      throw new Error('认知存档导入回执无效');
  }
}
