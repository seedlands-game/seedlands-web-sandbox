import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function productionSourceState() {
  const files = execFileSync(
    'git',
    [
      'ls-files',
      '-co',
      '--exclude-standard',
      '-z',
      '--',
      'src',
      'public',
      'index.html',
      'package.json',
      'pnpm-lock.yaml',
      'vite.config.ts',
      'tsconfig.json',
    ],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean);
  const hash = createHash('sha256');
  for (const file of [...new Set(files)].sort()) hash.update(file).update('\0').update(readFileSync(file));
  return {
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    worktreeDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    productionInputSha256: hash.digest('hex'),
  };
}
