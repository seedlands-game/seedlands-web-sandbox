import { describe, expect, it, vi } from 'vitest';
import type { ResidentBridge } from '../../apps/web/src/client/character/resident-bridge';
import {
  checkpointHash,
  exportResidentCheckpoint,
  importResidentCheckpoint,
  inspectResidentCheckpoint,
} from '../../apps/web/src/client/character/resident-checkpoint-transfer';
import { RESIDENT_HISTORY_MAX, RESIDENT_TRANSFER_CHUNK_BYTES } from '@seedlands/cognition-protocol';

describe('resident checkpoint transfer', () => {
  it('reads only a bounded real manifest header and rejects unknown sources', () => {
    const source = { worldId: 'world-a', timelineId: 'timeline-a', epoch: 'epoch-a' };
    expect(
      inspectResidentCheckpoint(
        JSON.stringify({
          format: 'seedlands-resident-cognition',
          version: 1,
          source,
          workspaces: [{ deferred: true }],
        }),
      ),
    ).toEqual({ source });
    for (const invalid of [
      '',
      JSON.stringify({ source }),
      JSON.stringify({ format: 'seedlands-resident-cognition', version: 1, source: {}, workspaces: [] }),
      JSON.stringify({
        format: 'seedlands-resident-cognition',
        version: 1,
        source,
        workspaces: Array.from({ length: RESIDENT_HISTORY_MAX + 1 }, () => null),
      }),
    ])
      expect(() => inspectResidentCheckpoint(invalid)).toThrow(/认知存档/u);
  });

  it('round-trips multibyte JSON across the chunk boundary and rejects reordered or corrupt responses', async () => {
    const content = JSON.stringify({ memory: '一起寻找浆果。'.repeat(10000) });
    const bytes = new TextEncoder().encode(content);
    const sha256 = await checkpointHash(bytes);
    const parts = Math.ceil(bytes.length / RESIDENT_TRANSFER_CHUNK_BYTES);
    const flushObservations = vi.fn(async () => undefined);
    let mode = 'normal';
    const bridge = {
      flushObservations,
      request: vi.fn(async (request: Record<string, unknown>) => {
        if (request.kind === 'checkpoint-export')
          return {
            kind: 'checkpoint-ready',
            transferId: 'frozen',
            byteLength: bytes.length,
            parts,
            sha256: mode === 'corrupt' ? '0'.repeat(64) : sha256,
          };
        const part = request.part as number;
        return {
          kind: 'checkpoint-part',
          transferId: 'frozen',
          part: mode === 'reordered' ? part + 1 : part,
          content: Buffer.from(
            bytes.subarray(part * RESIDENT_TRANSFER_CHUNK_BYTES, (part + 1) * RESIDENT_TRANSFER_CHUNK_BYTES),
          ).toString('base64'),
        };
      }),
    } as unknown as ResidentBridge;
    expect(await exportResidentCheckpoint(bridge)).toBe(content);
    expect(flushObservations).toHaveBeenCalledOnce();
    mode = 'reordered';
    await expect(exportResidentCheckpoint(bridge)).rejects.toThrow('分块回执无效');
    mode = 'corrupt';
    await expect(exportResidentCheckpoint(bridge)).rejects.toThrow('校验失败');
    const chunks: Uint8Array[] = [];
    let importedHash = '';
    const importing = {
      request: vi.fn(async (request: Record<string, unknown>) => {
        chunks.push(Buffer.from(request.content as string, 'base64'));
        importedHash = request.sha256 as string;
        return { kind: 'checkpoint-imported', transferId: request.transferId, complete: request.part === parts - 1 };
      }),
    } as unknown as ResidentBridge;
    await importResidentCheckpoint(importing, content);
    expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe(content);
    expect(importedHash).toBe(sha256);
    expect(chunks.every((chunk) => chunk.length <= RESIDENT_TRANSFER_CHUNK_BYTES)).toBe(true);
  });
});
