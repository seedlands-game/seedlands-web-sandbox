export const WASM_ARENA_BYTES = 16 * 1024 * 1024;

type NumericExport = (...parameters: number[]) => number;

export class KernelMemory {
  failed = false;
  readonly memory: WebAssembly.Memory;

  constructor(private readonly exports: WebAssembly.Exports) {
    const memory = exports.memory;
    if (
      !(memory instanceof WebAssembly.Memory) ||
      typeof exports.abi_version !== 'function' ||
      exports.abi_version() !== 1 ||
      typeof exports.arena_bytes !== 'function' ||
      exports.arena_bytes() !== WASM_ARENA_BYTES
    )
      throw new TypeError('Unsupported Wasm kernel ABI.');
    this.memory = memory;
    if (
      (typeof SharedArrayBuffer !== 'undefined' && memory.buffer instanceof SharedArrayBuffer) ||
      memory.buffer.byteLength < WASM_ARENA_BYTES
    )
      throw new TypeError('Wasm kernel requires an independent arena.');
  }

  bytes(offset: number, length: number): Uint8Array {
    this.validateRange(offset, length, 1);
    return new Uint8Array(this.memory.buffer, offset, length);
  }

  u16(offset: number, length: number): Uint16Array {
    this.validateRange(offset, length, 2);
    return new Uint16Array(this.memory.buffer, offset, length);
  }

  u32(offset: number, length: number): Uint32Array {
    this.validateRange(offset, length, 4);
    return new Uint32Array(this.memory.buffer, offset, length);
  }

  f64(offset: number, length: number): Float64Array {
    this.validateRange(offset, length, 8);
    return new Float64Array(this.memory.buffer, offset, length);
  }

  invoke(name: string, ...parameters: number[]): number {
    if (this.failed) throw new Error('Wasm kernel is disabled after failure.');
    const fn = this.exports[name];
    if (typeof fn !== 'function') throw new TypeError(`Missing Wasm kernel export: ${name}`);
    try {
      return (fn as NumericExport)(...parameters);
    } catch (error) {
      this.failed = true;
      throw error;
    }
  }

  private validateRange(offset: number, length: number, width: number): void {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 64 ||
      length < 0 ||
      offset % width !== 0 ||
      offset + length * width > WASM_ARENA_BYTES
    )
      throw new RangeError('Wasm arena range is invalid.');
  }
}

export async function createKernelMemory(bytes: Uint8Array): Promise<KernelMemory> {
  const { instance } = await WebAssembly.instantiate(Uint8Array.from(bytes), {});
  return new KernelMemory(instance.exports);
}
