import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prepareRun, readRunStatus, requestStop, runBatch, waitForRun } from '../scripts/lib/batch-runtime.mjs';

async function startFixture() {
  const values = new Map();
  const calls = new Map();
  let active = 0;
  let maxActive = 0;
  const blocked = new Set();
  const verificationBlocked = new Set();
  const server = http.createServer(async (request, response) => {
    const body = await new Promise((resolve) => {
      let value = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => (value += chunk));
      request.on('end', () => resolve(value ? JSON.parse(value) : {}));
    });
    const id = decodeURIComponent(new URL(request.url, 'http://fixture').pathname.slice(1));
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 3));
    if (request.method === 'PUT') {
      calls.set(id, (calls.get(id) ?? 0) + 1);
      if (body.transient && calls.get(id) === 1) {
        response.statusCode = 503;
      } else if (blocked.has(id)) {
        response.statusCode = 503;
      } else {
        values.set(id, body.value);
        response.statusCode = 204;
      }
    } else {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ value: verificationBlocked.has(id) ? '__mismatch__' : (values.get(id) ?? null) }));
    }
    active -= 1;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    values,
    maxActive: () => maxActive,
    blocked,
    verificationBlocked,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function makeRun(fixture, items, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'batch-runtime-'));
  const adapterPath = path.join(directory, 'adapter.mjs');
  const sourceAdapter = new URL('./support/http-adapter.mjs', import.meta.url);
  await writeFile(adapterPath, await readFile(sourceAdapter, 'utf8'));
  const configPath = path.join(directory, 'config.json');
  const inputPath = path.join(directory, 'input.json');
  await writeFile(
    configPath,
    `${JSON.stringify({ version: 1, adapter: adapterPath, endpoint: fixture.url, concurrency: 5, maxAttempts: 3, retryBaseMs: 1, timeoutMs: 500, ...overrides }, null, 2)}\n`,
  );
  await writeFile(inputPath, `${JSON.stringify(items, null, 2)}\n`);
  const runDir = path.join(directory, 'run');
  await prepareRun({ configPath, inputPath, runDir });
  return { directory, adapterPath, configPath, inputPath, runDir };
}

test('100 项有限并发完成 prepare→write→read→verify，临时失败有限重试', async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const items = Array.from({ length: 100 }, (_, index) => ({
    id: `item-${index}`,
    value: index,
    transient: index % 17 === 0,
  }));
  const run = await makeRun(fixture, items);
  const result = await runBatch({ runDir: run.runDir });
  assert.equal(result.counts.succeeded, 100);
  assert.ok(fixture.maxActive() <= 5);
  assert.equal(fixture.calls.get('item-0'), 2);
});

test('续跑只处理失败项，成功项不重写；输入、配置和 adapter 漂移拒绝', async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const items = [
    { id: 'ok', value: 1 },
    { id: 'repair', value: 2 },
  ];
  fixture.blocked.add('repair');
  const run = await makeRun(fixture, items, { maxAttempts: 1 });
  let result = await runBatch({ runDir: run.runDir });
  assert.equal(result.counts.failed, 1);
  items[1].alwaysFail = false;
  await writeFile(run.inputPath, `${JSON.stringify(items, null, 2)}\n`);
  await assert.rejects(runBatch({ runDir: run.runDir }), /输入漂移/);
  await writeFile(run.inputPath, await readFile(path.join(run.runDir, 'input.snapshot.json')));
  fixture.blocked.delete('repair');
  result = await runBatch({ runDir: run.runDir });
  assert.equal(result.counts.succeeded, 2);
  assert.equal(fixture.calls.get('ok'), 1);

  await writeFile(run.configPath, `${JSON.stringify({ changed: true })}\n`);
  await assert.rejects(runBatch({ runDir: run.runDir }), /配置漂移/);
  await writeFile(run.configPath, await readFile(path.join(run.runDir, 'config.snapshot.json')));
  await writeFile(run.adapterPath, `${await readFile(run.adapterPath, 'utf8')}\n`);
  await assert.rejects(runBatch({ runDir: run.runDir }), /adapter 漂移/);
});

test('非幂等写入结果不明进入对账，不盲目重写；审计不含 payload、响应和密钥', async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const secret = 'fixture-secret-do-not-log';
  const run = await makeRun(fixture, [{ id: 'unknown', value: secret, simulateUnknown: true }], {
    idempotency: 'none',
    maxAttempts: 3,
  });
  const result = await runBatch({ runDir: run.runDir });
  assert.equal(result.counts.needsReconciliation, 1);
  assert.equal(fixture.calls.get('unknown'), 1);
  const audit = await readFile(path.join(run.runDir, 'audit.jsonl'), 'utf8');
  assert.doesNotMatch(audit, /fixture-secret|payload|rawResponse/i);
});

test('验证失败续跑只读回验证，不重复写入', async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  fixture.verificationBlocked.add('verify-later');
  const run = await makeRun(fixture, [{ id: 'verify-later', value: 7 }]);
  let result = await runBatch({ runDir: run.runDir });
  assert.equal(result.counts.verifyFailed, 1);
  assert.equal(fixture.calls.get('verify-later'), 1);
  fixture.verificationBlocked.delete('verify-later');
  result = await runBatch({ runDir: run.runDir });
  assert.equal(result.counts.succeeded, 1);
  assert.equal(fixture.calls.get('verify-later'), 1);
});

test('状态、有界等待和停止可恢复，停止不会伪装成远端撤销', async (t) => {
  const fixture = await startFixture();
  t.after(() => fixture.close());
  const items = Array.from({ length: 60 }, (_, index) => ({ id: `slow-${index}`, value: index }));
  const run = await makeRun(fixture, items, { concurrency: 1 });
  const running = runBatch({ runDir: run.runDir });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await requestStop(run.runDir);
  const result = await running;
  assert.ok(result.counts.cancelled > 0 || result.counts.pending > 0);
  const status = await readRunStatus(run.runDir);
  assert.equal(status.stopRequested, true);
  const waited = await waitForRun(run.runDir, { timeoutMs: 30 });
  assert.ok(['cancelled', 'completed', 'completed-with-errors'].includes(waited.phase));
  const resumed = await runBatch({ runDir: run.runDir });
  assert.equal(resumed.counts.succeeded, 60);
});

test('CLI 失败只输出固定错误码，不泄露 adapter 异常秘密', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'batch-cli-safe-'));
  const adapterPath = path.join(directory, 'secret-adapter.mjs');
  const configPath = path.join(directory, 'config.json');
  const inputPath = path.join(directory, 'input.json');
  const runDir = path.join(directory, 'run');
  const secret = 'fixture-secret-never-print';
  await writeFile(adapterPath, `export async function prepare(){throw new Error('${secret}')}\n`);
  await writeFile(
    configPath,
    `${JSON.stringify({ version: 1, adapter: adapterPath, concurrency: 1, maxAttempts: 1 })}\n`,
  );
  await writeFile(inputPath, '[{"id":"one"}]\n');
  const cli = new URL('../scripts/batch-runtime.mjs', import.meta.url);
  const output = await new Promise((resolve) => {
    const child = spawn(process.execPath, [
      cli.pathname,
      'prepare',
      '--config',
      configPath,
      '--input',
      inputPath,
      '--run-dir',
      runDir,
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(output.code, 1);
  assert.match(output.stderr, /BATCH_RUNTIME_FAILED/);
  assert.doesNotMatch(`${output.stdout}${output.stderr}`, new RegExp(secret));
  assert.doesNotMatch(output.stderr, /Error:|at file:/);
});
