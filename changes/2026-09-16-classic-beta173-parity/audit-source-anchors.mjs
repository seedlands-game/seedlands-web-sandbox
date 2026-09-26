#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const commit = '740c583901e1ff1150e9ef37e37dab5bc0e4f807';
const prefix = `https://github.com/jacobo-mc/mc_b1.7.3_release/blob/${commit}/`;
const pattern = new RegExp(`${prefix.replaceAll('.', '\\.')}([^\\s)"|<>]+?\\.java)#L(\\d+)(?:-L(\\d+))?`, 'g');
const files = (await readdir(root)).filter(
  (name) => /\.(?:json|md|mjs)$/.test(name) && name !== 'contract-snapshot.json',
);
const anchors = new Map();
for (const name of files) {
  const body = await readFile(join(root, name), 'utf8');
  for (const match of body.matchAll(pattern)) {
    const [, path, first, last] = match;
    const key = `${path}#L${first}${last ? `-L${last}` : ''}`;
    anchors.set(key, { path, first: Number(first), last: Number(last ?? first), foundIn: name });
  }
}

const paths = [...new Set([...anchors.values()].map((entry) => entry.path))];
const counts = new Map();
const errors = [];
let index = 0;
async function worker() {
  while (index < paths.length) {
    const path = paths[index++];
    const url = `https://raw.githubusercontent.com/jacobo-mc/mc_b1.7.3_release/${commit}/${path}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      counts.set(path, body.replace(/\n$/, '').split('\n').length);
    } catch (error) {
      errors.push({ path, error: String(error) });
    }
  }
}
await Promise.all(Array.from({ length: Math.min(6, paths.length) }, () => worker()));
const invalid = [...anchors.values()]
  .map((entry) => ({ ...entry, lineCount: counts.get(entry.path) }))
  .filter(
    (entry) =>
      entry.lineCount !== undefined && (entry.first < 1 || entry.first > entry.last || entry.last > entry.lineCount),
  )
  .sort((a, b) => a.path.localeCompare(b.path, 'en') || a.first - b.first);
console.log(
  JSON.stringify({
    files: files.length,
    sourceFiles: paths.length,
    uniqueAnchors: anchors.size,
    invalid,
    fetchErrors: errors,
  }),
);
if (invalid.length || errors.length) process.exitCode = 1;
