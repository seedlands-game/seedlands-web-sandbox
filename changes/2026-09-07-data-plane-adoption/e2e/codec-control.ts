import { KernelMemory } from '../../../src/compute/kernel-memory';
// Mirrors the Rust/Moon dense lookup and direct output algorithm. The earlier
// control used Map plus temporary arrays, which is not a language-only control.
export function createDenseCodecControl(): KernelMemory {
  const memory = new WebAssembly.Memory({ initial: 288, maximum: 512 });
  const bytes = new Uint8Array(memory.buffer);
  const values = new Uint16Array(memory.buffer);
  const view = new DataView(memory.buffer);
  const table = Uint32Array.from({ length: 256 }, (_, i) => {
    let v = i;
    for (let b = 0; b < 8; b++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1;
    return v >>> 0;
  });
  const crc = (offset: number, length: number) => {
    let v = 0xffffffff;
    for (let i = 0; i < length; i++) v = table[(v ^ bytes[offset + i]) & 255] ^ (v >>> 8);
    return (v ^ 0xffffffff) >>> 0;
  };
  return new KernelMemory({
    memory,
    abi_version: () => 1,
    arena_bytes: () => 16777216,
    crc32_bytes: crc,
    crc32_u16_le: (offset: number, count: number) => crc(offset, count * 2),
    encode_raw: (input: number, output: number, capacity: number) => {
      if (capacity < 65536) return -2;
      for (let i = 0; i < 32768; i++) view.setUint16(output + i * 2, values[input / 2 + i], true);
      return 65536;
    },
    encode_diff: (input: number, base: number, output: number, capacity: number) => {
      if (capacity < 4) return -2;
      let count = 0,
        previous = 0,
        cursor = output + 4;
      const end = output + capacity;
      for (let i = 0; i < 32768; i++) {
        const v = values[input / 2 + i];
        if (v === values[base / 2 + i]) continue;
        let delta = i - previous;
        do {
          if (cursor >= end) return -2;
          const byte = delta & 127;
          delta >>>= 7;
          bytes[cursor++] = delta ? byte | 128 : byte;
        } while (delta);
        if (cursor + 2 > end) return -2;
        view.setUint16(cursor, v, true);
        cursor += 2;
        previous = i;
        count++;
      }
      view.setUint32(output, count, true);
      return cursor - output;
    },
    encode_palette: (input: number, output: number, capacity: number) => {
      if (capacity < 5) return -2;
      const indexes = new Int32Array(65536).fill(-1);
      let length = 0;
      for (let i = 0; i < 32768; i++) {
        const v = values[input / 2 + i];
        if (indexes[v] < 0) {
          if (7 + length * 2 > capacity) return -2;
          view.setUint16(output + 5 + length * 2, v, true);
          indexes[v] = length++;
        }
      }
      let bits = 0,
        width = 1;
      while (width < length) {
        width <<= 1;
        bits++;
      }
      const total = 5 + length * 2 + Math.ceil((32768 * bits) / 8);
      if (total > capacity) return -2;
      view.setUint32(output, length, true);
      bytes[output + 4] = bits;
      let cursor = output + 5 + length * 2,
        accumulator = 0,
        accumulated = 0;
      for (let i = 0; i < 32768; i++) {
        accumulator |= indexes[values[input / 2 + i]] << accumulated;
        accumulated += bits;
        while (accumulated >= 8) {
          bytes[cursor++] = accumulator & 255;
          accumulator >>>= 8;
          accumulated -= 8;
        }
      }
      if (accumulated) bytes[cursor] = accumulator & 255;
      return total;
    },
  });
}
