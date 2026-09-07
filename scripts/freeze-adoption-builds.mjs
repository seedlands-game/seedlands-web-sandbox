import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Run after both production builds. The runner checks this stamp and all served bytes.
for (const root of [resolve('.'), '/tmp/seedlands-adoption-baseline']) {
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const files = [
    ...new Set(
      execFileSync(
        'git',
        [
          'ls-files',
          '-co',
          '--exclude-standard',
          '--',
          'src',
          'crates',
          'vite.config.ts',
          'package.json',
          'pnpm-lock.yaml',
        ],
        { cwd: root, encoding: 'utf8' },
      )
        .trim()
        .split('\n'),
    ),
  ].sort();
  const hash = createHash('sha256');
  for (const file of files)
    hash
      .update(file)
      .update('\0')
      .update(
        createHash('sha256')
          .update(readFileSync(resolve(root, file)))
          .digest('hex'),
      )
      .update('\0');
  const record = { sourceSha, productionSourceHash: hash.digest('hex'), stampedAt: new Date().toISOString() };
  writeFileSync(resolve(root, 'dist/adoption-source.json'), JSON.stringify(record, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ root, ...record }) + '\n');
}
