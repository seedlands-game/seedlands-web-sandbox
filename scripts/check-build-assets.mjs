import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const distDirectory = resolve('dist');
const manifest = JSON.parse(readFileSync(resolve(distDirectory, '.vite/manifest.json'), 'utf8'));
const entry = Object.values(manifest).find((item) => item.isEntry && item.src === 'index.html');

if (!entry) throw new Error('Vite manifest 中缺少 index.html 入口。');

const initialFiles = new Set();
const collectStaticImports = (item) => {
  if (item.file.endsWith('.js')) initialFiles.add(item.file);
  for (const importKey of item.imports ?? []) collectStaticImports(manifest[importKey]);
};
collectStaticImports(entry);

const javascriptFiles = [...new Set(Object.values(manifest).map((item) => item.file))].filter((file) =>
  file.endsWith('.js'),
);
const gzipBytes = (file) => gzipSync(readFileSync(resolve(distDirectory, file))).byteLength;
const initialGzipBytes = [...initialFiles].reduce((total, file) => total + gzipBytes(file), 0);
const initialBudget = 25 * 1024;
const chunkBudget = 550 * 1024;
const oversizedChunks = javascriptFiles.filter((file) => gzipBytes(file) > chunkBudget);

console.log(`首屏静态 JavaScript: ${(initialGzipBytes / 1024).toFixed(2)} KiB gzip (${[...initialFiles].join(', ')})`);
for (const file of javascriptFiles.sort()) {
  console.log(
    `JavaScript 分包: ${file} ${(statSync(resolve(distDirectory, file)).size / 1024).toFixed(2)} KiB / ${(gzipBytes(file) / 1024).toFixed(2)} KiB gzip`,
  );
}

if (initialGzipBytes > initialBudget) {
  throw new Error(`首屏静态 JavaScript 超过 ${initialBudget / 1024} KiB gzip 预算。`);
}
if (oversizedChunks.length) {
  throw new Error(`以下 JavaScript 分包超过 ${chunkBudget / 1024} KiB gzip 预算：${oversizedChunks.join(', ')}`);
}
