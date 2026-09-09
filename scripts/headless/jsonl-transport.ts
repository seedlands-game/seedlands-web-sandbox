import { CHUNK_SIZE } from '@seedlands/game-core/world/voxel';

export const JSONL_CHECKPOINT_LINE_BYTES = 96 * 1024 * 1024;

/** Incremental bounded framing; excess lines are discarded until the next newline. */
export async function* readBoundedLines(
  input: AsyncIterable<Uint8Array | string>,
  maxBytes: number,
): AsyncGenerator<{ line: string } | { oversized: true }> {
  let parts: Buffer[] = [];
  let bytes = 0;
  let oversized = false;
  for await (const inputChunk of input) {
    const chunk = typeof inputChunk === 'string' ? Buffer.from(inputChunk) : Buffer.from(inputChunk);
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline;
      if (!oversized) {
        bytes += end - start;
        if (bytes > maxBytes) {
          parts = [];
          oversized = true;
        } else if (end > start) parts.push(chunk.subarray(start, end));
      }
      if (newline < 0) break;
      yield oversized ? { oversized: true } : { line: Buffer.concat(parts, bytes).toString('utf8') };
      parts = [];
      bytes = 0;
      oversized = false;
      start = newline + 1;
    }
  }
  if (oversized) yield { oversized: true };
  else if (bytes) yield { line: Buffer.concat(parts, bytes).toString('utf8') };
}

/** Binary arrays retain explicit element type and endian order on the JSONL wire. */
export function stringifyWorldJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item instanceof Uint16Array) {
      const buffer = Buffer.alloc(item.length * 2);
      for (let index = 0; index < item.length; index++) buffer.writeUInt16LE(item[index], index * 2);
      return { encoding: 'u16le-base64', byteLength: buffer.length, data: buffer.toString('base64') };
    }
    if (item instanceof Uint8Array) {
      const buffer = Buffer.from(item.buffer, item.byteOffset, item.byteLength);
      return { encoding: 'u8-base64', byteLength: buffer.length, data: buffer.toString('base64') };
    }
    return item;
  });
}

function decodeChunkArray(value: unknown, wide: boolean): Uint16Array | Uint8Array {
  if (!value || typeof value !== 'object') throw new TypeError('Checkpoint binary field must be encoded.');
  const item = value as Record<string, unknown>;
  const length = CHUNK_SIZE ** 3 * (wide ? 2 : 1);
  if (
    item.encoding !== (wide ? 'u16le-base64' : 'u8-base64') ||
    item.byteLength !== length ||
    typeof item.data !== 'string' ||
    item.data.length !== Math.ceil(length / 3) * 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)
  )
    throw new TypeError('Checkpoint binary type, length or encoding is invalid.');
  const bytes = Buffer.from(item.data, 'base64');
  if (bytes.length !== length || bytes.toString('base64') !== item.data)
    throw new TypeError('Checkpoint binary is not canonical base64.');
  if (!wide) return new Uint8Array(bytes);
  const output = new Uint16Array(CHUNK_SIZE ** 3);
  for (let index = 0; index < output.length; index++) output[index] = bytes.readUInt16LE(index * 2);
  return output;
}

export function decodeCheckpointRequest(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const request = value as Record<string, unknown>;
  if (request.method !== 'checkpoint' || !Array.isArray(request.args)) return value;
  const argument = request.args[0] as Record<string, unknown> | null;
  if (!argument || argument.kind !== 'restore') return value;
  const snapshot = argument.snapshot as Record<string, unknown> | null;
  if (!snapshot || !Array.isArray(snapshot.chunks) || snapshot.chunks.length > 4096)
    throw new TypeError('Checkpoint chunk list is invalid.');
  return {
    ...request,
    args: [
      {
        ...argument,
        snapshot: {
          ...snapshot,
          chunks: snapshot.chunks.map((chunk) => {
            if (!chunk || typeof chunk !== 'object') throw new TypeError('Checkpoint chunk must be an object.');
            return {
              ...chunk,
              voxels: decodeChunkArray(chunk.voxels, true),
              ...(chunk.fluid === undefined ? {} : { fluid: decodeChunkArray(chunk.fluid, false) }),
            };
          }),
        },
      },
      ...request.args.slice(1),
    ],
  };
}
