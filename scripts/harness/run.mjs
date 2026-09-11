import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { generatePlan } from './plan.mjs';
import { changedPathsBetween } from './repository-snapshot.mjs';
import { buildArtifact, verifyArtifact, root } from './artifact.mjs';
import { validateClassicReceipt } from './classic-receipt.mjs';
import { requirePerformanceWindowContext, writeMeasurementDeclaration } from './performance-window-proof.mjs';

if (process.argv.includes('--help')) {
  process.stdout.write(
    'run --stage <affected|all|tests|classic|runtime> [--base <sha>] [--head <sha>] [--plan <path>]\n',
  );
  process.exit(0);
}
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const value = (key) => {
  const index = args.indexOf(key);
  return index < 0 ? undefined : args[index + 1];
};
const stage = value('--stage') ?? 'affected';
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, '-').toLowerCase()}-${randomUUID().slice(0, 8)}`;
const directory = resolve(root, 'harness/results', runId);
mkdirSync(directory, { recursive: true });
const record = {
  schemaVersion: 1,
  runId,
  stage,
  status: 'RUNNING',
  startedAt: new Date().toISOString(),
  plan: null,
  configHash: createHash('sha256')
    .update(
      ['package.json', 'playwright.config.ts', 'vitest.config.ts', 'harness/contracts.json']
        .map((path) => `${path}\0${readFileSync(resolve(root, path), 'utf8')}`)
        .join('\0'),
    )
    .digest('hex'),
  phases: {
    selection: 'NOT_RUN',
    static: 'NOT_RUN',
    contracts: 'NOT_RUN',
    build: 'NOT_SELECTED',
    artifact: 'NOT_SELECTED',
    classic: 'NOT_SELECTED',
  },
  steps: [],
};
let activePhase = 'selection';
let performanceWindow;
const startPhase = (name) => {
  activePhase = name;
  record.phases[name] = 'RUNNING';
  persist();
};
const finishPhase = () => {
  record.phases[activePhase] = 'PASS';
  persist();
};
const persist = () => writeFileSync(resolve(directory, 'result.json'), JSON.stringify(record, null, 2) + '\n');
function run(name, command, commandArgs, env = {}) {
  const entry = { name, command: [command, ...commandArgs], status: 'RUNNING', startedAt: new Date().toISOString() };
  record.steps.push(entry);
  persist();
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  entry.exitCode = result.status;
  entry.status = result.status === 0 && !result.error ? 'PASS' : 'FAIL';
  entry.finishedAt = new Date().toISOString();
  persist();
  if (result.error) throw result.error;
  if (entry.status !== 'PASS') throw new Error(`${name} failed (${result.status ?? result.signal}).`);
}
function tests(plan) {
  const groups = new Map();
  for (const contract of [...plan.selectedContracts, ...plan.selectedIntegrations])
    for (const file of contract.files) {
      if (!/^(?:packages|apps|playbooks)\/[^/]+\/tests\/.+\.test\.ts$/.test(file) || file.split('/').includes('..'))
        throw new Error(`Invalid selected test path: ${file}`);
      const ownerRoot = file.startsWith('packages/eslint-plugin/')
        ? 'packages/eslint-plugin'
        : /^apps\/web\/tests\/integration\/(?:engineering|architecture)\//.test(file)
          ? 'web-engineering'
          : 'runtime';
      if (!groups.has(ownerRoot)) groups.set(ownerRoot, new Set());
      groups.get(ownerRoot).add(file);
    }
  if (!groups.size && !plan.documentationOnly) throw new Error('No effective tests selected.');
  for (const [owner, files] of groups) {
    const report = resolve(directory, `${owner.replaceAll('/', '-')}.json`);
    run(`tests:${owner}`, 'pnpm', [
      ...(owner === 'packages/eslint-plugin'
        ? ['--filter', '@seedlands/eslint-plugin', 'test']
        : [
            'exec',
            'vitest',
            'run',
            '--config',
            owner === 'runtime' ? 'vitest.config.ts' : 'apps/web/vitest.config.ts',
            `--maxWorkers=${process.env.CI ? 1 : 2}`,
          ]),
      ...((stage === 'all' || plan.mode === 'full-new') && owner === 'runtime' ? ['--coverage'] : []),
      ...[...files].sort().map((file) => resolve(root, file)),
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${report}`,
    ]);
    const result = JSON.parse(readFileSync(report, 'utf8'));
    if (!result.success || result.numTotalTests < 1 || result.numPendingTests || result.numTodoTests)
      throw new Error(`Empty, incomplete or failed contract report: ${owner}`);
    const executed = new Set(result.testResults.map((test) => relative(root, test.name).replaceAll('\\', '/')));
    for (const file of files) if (!executed.has(file)) throw new Error(`Selected test did not execute: ${file}`);
  }
}
try {
  if (!['affected', 'all', 'tests', 'classic', 'runtime'].includes(stage)) throw new Error(`Unknown stage: ${stage}`);
  if (stage === 'runtime') performanceWindow = requirePerformanceWindowContext();
  if (stage === 'classic' || stage === 'runtime') {
    record.phases.selection = record.phases.static = record.phases.contracts = 'NOT_SELECTED';
    record.phases.classic = 'NOT_RUN';
    startPhase('artifact');
    record.artifact = verifyArtifact();
    finishPhase();
  } else {
    startPhase('selection');
    const plan = value('--plan')
      ? JSON.parse(readFileSync(resolve(value('--plan')), 'utf8'))
      : generatePlan({
          root,
          baseSha: value('--base'),
          headSha: value('--head'),
          all: stage === 'all' || args.includes('--all'),
        });
    record.plan = plan;
    record.planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    if (stage === 'all' && plan.productionBuild) record.phases.build = 'NOT_RUN';
    if (stage === 'all' && plan.classic?.required) record.phases.classic = 'NOT_RUN';
    if (stage === 'tests') record.phases.static = 'NOT_SELECTED';
    persist();
    const current = generatePlan({ root, baseSha: plan.baseSha ?? undefined, all: stage === 'all' });
    if (plan.headSha !== current.headSha || (plan.worktreeDigest && plan.worktreeDigest !== current.worktreeDigest))
      throw new Error('Selection plan does not identify the current source.');
    if (!plan.worktreeDigest && changedPathsBetween(root, plan.headSha).length)
      throw new Error('Committed plan cannot validate a changed worktree.');
    if (plan.status !== 'READY') throw new Error(`Selection blocked: ${plan.errors.join('; ')}`);
    const selected = new Set(
      [...plan.selectedContracts, ...plan.selectedIntegrations].flatMap((contract) => contract.files),
    );
    const required = [...current.selectedContracts, ...current.selectedIntegrations].flatMap(
      (contract) => contract.files,
    );
    if (
      current.status !== 'READY' ||
      required.some((file) => !selected.has(file)) ||
      (!current.documentationOnly && plan.documentationOnly) ||
      (current.productionBuild && !plan.productionBuild) ||
      (current.classic.required && !plan.classic?.required) ||
      (current.mode === 'full-new' && plan.mode !== 'full-new')
    )
      throw new Error('Selection plan weakens the current required verification.');
    finishPhase();
    if (stage !== 'tests') {
      startPhase('static');
      for (const script of plan.documentationOnly
        ? ['format:check', 'lint:paths']
        : ['ssg:check', 'format:check', 'lint', 'lint:paths', 'typecheck'])
        run(script, 'pnpm', [script]);
      finishPhase();
    }
    if (plan.documentationOnly) record.phases.contracts = 'NOT_SELECTED';
    else {
      startPhase('contracts');
      tests(plan);
      finishPhase();
    }
    if (stage === 'all' && plan.productionBuild) {
      startPhase('build');
      record.artifact = buildArtifact();
      finishPhase();
    }
  }
  if (stage === 'classic' || stage === 'runtime' || (stage === 'all' && record.plan.classic.required)) {
    startPhase('classic');
    run('classic-production', 'pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.config.ts'], {
      SEEDLANDS_CLASSIC_RESULT: resolve(directory, 'classic.json'),
      SEEDLANDS_CLASSIC_BENCHMARK: stage === 'runtime' ? '1' : '0',
      SEEDLANDS_HARNESS_RUN_ID: runId,
    });
    const classic = JSON.parse(readFileSync(resolve(directory, 'classic.json'), 'utf8'));
    validateClassicReceipt(classic, {
      runId,
      artifact: record.artifact,
      scenario: JSON.parse(
        readFileSync(resolve(root, 'playbooks/classic/scenarios/canonical-runtime-v1.json'), 'utf8'),
      ),
      benchmark: stage === 'runtime',
      performanceWindow,
    });
    record.classic = classic;
    finishPhase();
    startPhase('artifact');
    verifyArtifact();
    finishPhase();
    if (performanceWindow)
      writeMeasurementDeclaration(performanceWindow, {
        measurementPath: resolve(directory, 'classic.json'),
        format: 'classic',
        runId,
        owner: 'web-runtime',
        scenario: classic.attempts[0].scenario.id,
      });
  }
  record.status = 'PASS';
} catch (error) {
  record.status = ['selection', 'artifact'].includes(activePhase) ? 'BLOCKED' : 'FAIL';
  record.phases[activePhase] = record.status;
  for (const [name, status] of Object.entries(record.phases)) if (status === 'NOT_RUN') record.phases[name] = 'BLOCKED';
  record.error = error.message;
  if (existsSync(resolve(directory, 'classic.json'))) {
    try {
      record.classic = JSON.parse(readFileSync(resolve(directory, 'classic.json'), 'utf8'));
    } catch {
      record.classic = { status: 'FAIL', error: 'Unreadable Classic attempt receipt.' };
    }
  }
  process.exitCode = 1;
  process.stderr.write(`${error.message}\n`);
} finally {
  record.finishedAt = new Date().toISOString();
  persist();
  process.stdout.write(`Harness ${record.status}: ${relative(root, resolve(directory, 'result.json'))}\n`);
}
