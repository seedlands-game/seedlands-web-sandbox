import { readFile } from 'node:fs/promises';

const [path] = process.argv.slice(2);
if (!path) throw new Error('usage: check-rust-reference.mjs <wasm>');

const bytes = await readFile(path);
const module = await WebAssembly.compile(bytes);
const exports = WebAssembly.Module.exports(module).map(({ name }) => name);
for (const name of ['memory', 'fill_chunk', 'fluid_candidate', 'mesh_describe', '__heap_base']) {
  if (!exports.includes(name)) throw new Error(`Rust reference is missing export ${name}.`);
}
const instance = await WebAssembly.instantiate(module, {});
const memory = instance.exports.memory;
if (!(memory instanceof WebAssembly.Memory)) throw new Error('Rust reference did not export memory.');
const initialBytes = memory.buffer.byteLength;
if (initialBytes < 16 * 1024 * 1024 || initialBytes > 32 * 1024 * 1024)
  throw new Error(`Rust reference initial memory is outside 16-32 MiB: ${initialBytes}.`);
const heapBase = Number(instance.exports.__heap_base?.value ?? -1);
if (!Number.isInteger(heapBase) || heapBase < 16 * 1024 * 1024 || heapBase > 32 * 1024 * 1024)
  throw new Error(`Rust reference __heap_base is outside 16-32 MiB: ${heapBase}.`);
console.log(`rust-reference memory=${initialBytes} heap_base=${heapBase}`);
