import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../../src/world/voxel';
import {
  decodeCheckpointRequest,
  readBoundedLines,
  stringifyWorldJson,
} from '../../../../scripts/headless/jsonl-transport';

describe('开发 JSONL 的 framing 与 checkpoint wire', () => {
  it('跨 chunk UTF-8、超长行丢弃与下一行恢复，EOF无需换行', async () => {
    async function* input() {
      const encoded = Buffer.from('你好\n');
      yield encoded.subarray(0, 2);
      yield encoded.subarray(2);
      yield Buffer.from('012345');
      yield Buffer.from('67890\nok\nend');
    }
    const output = [];
    for await (const line of readBoundedLines(input(), 8)) output.push(line);
    expect(output).toEqual([{ line: '你好' }, { oversized: true }, { line: 'ok' }, { line: 'end' }]);
  });

  it('显式小端 typed-array JSON 编码可往返且没有共享可变缓冲', () => {
    const voxels = new Uint16Array(CHUNK_SIZE ** 3);
    const fluid = new Uint8Array(CHUNK_SIZE ** 3);
    voxels[0] = 513;
    fluid[1] = 255;
    const json = JSON.parse(
      stringifyWorldJson({
        protocolVersion: 1,
        requestId: 1,
        method: 'checkpoint',
        args: [
          {
            kind: 'restore',
            snapshot: { chunks: [{ voxels, fluid }] },
          },
        ],
      }),
    );
    expect(json.args[0].snapshot.chunks[0].voxels).toMatchObject({
      encoding: 'u16le-base64',
      byteLength: voxels.byteLength,
    });
    const decoded = decodeCheckpointRequest(json) as {
      args: [{ snapshot: { chunks: [{ voxels: Uint16Array; fluid: Uint8Array }] } }];
    };
    expect(decoded.args[0].snapshot.chunks[0].voxels).toEqual(voxels);
    expect(decoded.args[0].snapshot.chunks[0].fluid).toEqual(fluid);
    decoded.args[0].snapshot.chunks[0].voxels[0] = 0;
    expect(voxels[0]).toBe(513);
    json.args[0].snapshot.chunks[0].voxels.data = '!bad';
    expect(() => decodeCheckpointRequest(json)).toThrow('encoding is invalid');
  });
});
