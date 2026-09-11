import { existsSync, realpathSync } from 'node:fs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createImpactPlan } from './impact-plan.mjs';
import { changedPathsBetween, readCommitSnapshot, readWorkingSnapshot } from './repository-snapshot.mjs';

export function generatePlan({ root, baseSha, headSha, all = false }) {
  const failures = [];
  let base = null;
  try {
    base = readCommitSnapshot(root, baseSha);
  } catch (error) {
    failures.push(error.message);
  }
  const head = headSha ? readCommitSnapshot(root, headSha) : readWorkingSnapshot(root);
  let changedPaths = [];
  try {
    changedPaths = changedPathsBetween(root, baseSha, headSha);
  } catch (error) {
    failures.push(error.message);
  }
  const plan = createImpactPlan({ base, head, changedPaths, all });
  return { ...plan, worktreeDigest: head.worktreeDigest ?? null, diagnostics: failures };
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.includes('--help')) {
    process.stdout.write('plan --base <sha> [--head <sha>] [--all] [--out <path>]\n');
    process.exit(0);
  }
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const value = (key) => {
    const index = args.indexOf(key);
    return index < 0 ? undefined : args[index + 1];
  };
  try {
    const plan = generatePlan({
      root: value('--root') ? resolve(value('--root')) : resolve(import.meta.dirname, '../..'),
      baseSha: value('--base'),
      headSha: value('--head'),
      all: args.includes('--all'),
    });
    const output = value('--out');
    const text = `${JSON.stringify(plan, null, 2)}\n`;
    if (output) {
      mkdirSync(dirname(resolve(output)), { recursive: true });
      writeFileSync(output, text);
    }
    process.stdout.write(text);
    if (plan.status !== 'READY') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
