import { RESIDENT_TRANSFER_CHUNK_BYTES, RESIDENT_TRANSFER_MAX_BYTES } from '@seedlands/cognition-protocol';
import type { ResidentBridge } from './resident-bridge';

export async function checkpointHash(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
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
