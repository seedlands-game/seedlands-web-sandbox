#!/usr/bin/env node
// A byte-level identity for the whole proposed contract, not an approval stamp.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, 'contract-snapshot.json');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const files = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else if (entry.isFile() && path !== output && /\.(?:md|json|mjs)$/.test(entry.name)) files.push(path);
  }
}

await visit(root);
const members = Object.fromEntries(
  await Promise.all(
    files
      .sort((a, b) => a.localeCompare(b, 'en'))
      .map(async (path) => [relative(root, path), hash(await readFile(path))]),
  ),
);
const profile = JSON.parse(await readFile(join(root, 'harness-profile.json'), 'utf8'));
const snapshot = {
  schemaVersion: 1,
  profileId: profile.profileId,
  referenceCaseSetVersion: profile.referenceCaseSetVersion,
  status: 'CANDIDATE_SNAPSHOT_NOT_APPROVED',
  fileCount: files.length,
  members,
  rootSha256: hash(JSON.stringify(members)),
};
const body = `${JSON.stringify(snapshot, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = await readFile(output, 'utf8');
  if (current !== body) throw new Error('contract snapshot drift: rebuild and review the complete diff');
} else {
  await writeFile(output, body);
}
console.log(
  JSON.stringify({
    profileId: snapshot.profileId,
    fileCount: snapshot.fileCount,
    rootSha256: snapshot.rootSha256,
    status: snapshot.status,
  }),
);
