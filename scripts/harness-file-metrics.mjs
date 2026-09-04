import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function collectDistMetrics(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(resolve(root, 'dist'));
  let totalBytes = 0;
  let jsBytes = 0;
  let gzipBytes = 0;
  for (const file of files) {
    const content = await readFile(file);
    totalBytes += content.byteLength;
    if (file.endsWith('.js')) {
      jsBytes += content.byteLength;
      gzipBytes += gzipSync(content).byteLength;
    }
  }
  return { fileCount: files.length, totalBytes, jsBytes, gzipBytes };
}
