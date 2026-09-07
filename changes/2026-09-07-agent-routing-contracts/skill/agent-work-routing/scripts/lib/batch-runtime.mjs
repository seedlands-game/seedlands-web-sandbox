import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, readFile, rename, rm, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const terminalPhases = new Set(['completed', 'completed-with-errors', 'cancelled']);

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicJson(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

async function parseJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function importAdapter(adapterPath) {
  return import(`${pathToFileURL(adapterPath).href}?v=${Date.now()}`);
}

function validateConfig(config) {
  if (config?.version !== 1) throw new Error('runtime config version 必须为 1');
  if (typeof config.adapter !== 'string') throw new Error('config.adapter 缺失');
  for (const name of ['concurrency', 'maxAttempts']) {
    if (!Number.isInteger(config[name]) || config[name] < 1) throw new Error(`${name} 必须为正整数`);
  }
  if ((config.idempotency ?? 'required') === 'none' && config.maxAttempts > 1) {
    // 可重试 read，但 write 结果不明时不得重写。
  }
  if (!['required', 'none'].includes(config.idempotency ?? 'required'))
    throw new Error('idempotency 必须为 required 或 none');
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('input 必须是非空数组');
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || item.id.length === 0) throw new Error('每项必须有非空字符串 id');
    if (ids.has(item.id)) throw new Error(`重复 item id: ${item.id}`);
    ids.add(item.id);
  }
}

async function audit(runDir, event) {
  const safe = {
    time: new Date().toISOString(),
    event: event.event,
    ...(event.itemId ? { itemId: event.itemId } : {}),
    ...(event.stage ? { stage: event.stage } : {}),
    ...(event.status ? { status: event.status } : {}),
    ...(event.code ? { code: event.code } : {}),
  };
  await appendFile(path.join(runDir, 'audit.jsonl'), `${JSON.stringify(safe)}\n`, { mode: 0o600 });
}

function counts(state) {
  const result = {
    succeeded: 0,
    failed: 0,
    verifyFailed: 0,
    needsReconciliation: 0,
    cancelled: 0,
    pending: 0,
    running: 0,
  };
  for (const item of Object.values(state.items)) {
    if (item.status === 'succeeded') result.succeeded += 1;
    else if (item.status === 'verify-failed') result.verifyFailed += 1;
    else if (item.status === 'needs-reconciliation') result.needsReconciliation += 1;
    else if (item.status === 'cancelled') result.cancelled += 1;
    else if (item.status === 'running') result.running += 1;
    else if (item.status === 'pending') result.pending += 1;
    else result.failed += 1;
  }
  return result;
}

export async function prepareRun({ configPath, inputPath, runDir }) {
  const absoluteConfig = path.resolve(configPath);
  const absoluteInput = path.resolve(inputPath);
  const absoluteRun = path.resolve(runDir);
  const configRaw = await readFile(absoluteConfig);
  const inputRaw = await readFile(absoluteInput);
  const config = JSON.parse(configRaw);
  const items = JSON.parse(inputRaw);
  validateConfig(config);
  validateItems(items);
  const adapterPath = path.resolve(path.dirname(absoluteConfig), config.adapter);
  const adapterRaw = await readFile(adapterPath);
  await mkdir(absoluteRun, { recursive: false, mode: 0o700 });
  await writeFile(path.join(absoluteRun, 'config.snapshot.json'), configRaw, { mode: 0o600 });
  await writeFile(path.join(absoluteRun, 'input.snapshot.json'), inputRaw, { mode: 0o600 });
  const definitionHash = digest(Buffer.concat([configRaw, Buffer.from([0]), inputRaw, Buffer.from([0]), adapterRaw]));
  const manifest = {
    version: 1,
    runId: definitionHash.slice(0, 24),
    configPath: absoluteConfig,
    inputPath: absoluteInput,
    adapterPath,
    configHash: digest(configRaw),
    inputHash: digest(inputRaw),
    adapterHash: digest(adapterRaw),
    definitionHash,
  };
  await atomicJson(path.join(absoluteRun, 'manifest.json'), manifest);
  const state = {
    version: 1,
    phase: 'preparing',
    prepared: false,
    stopRequested: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: Object.fromEntries(
      items.map((item) => [
        item.id,
        {
          id: item.id,
          status: 'pending',
          attempts: 0,
          writeStarted: false,
          writeCompleted: false,
          idempotencyKey: digest(`${definitionHash}\0${item.id}`),
        },
      ]),
    ),
  };
  await atomicJson(path.join(absoluteRun, 'state.json'), state);
  const adapter = await importAdapter(adapterPath);
  if (typeof adapter.prepare === 'function') await adapter.prepare({ config, runDir: absoluteRun });
  state.prepared = true;
  state.phase = 'prepared';
  state.updatedAt = new Date().toISOString();
  await atomicJson(path.join(absoluteRun, 'state.json'), state);
  await audit(absoluteRun, { event: 'prepared', status: 'prepared' });
  return readRunStatus(absoluteRun);
}

async function verifyNoDrift(runDir) {
  const manifest = await parseJson(path.join(runDir, 'manifest.json'));
  const [configRaw, inputRaw, adapterRaw] = await Promise.all([
    readFile(manifest.configPath),
    readFile(manifest.inputPath),
    readFile(manifest.adapterPath),
  ]);
  if (digest(configRaw) !== manifest.configHash) throw new Error('配置漂移：拒绝恢复');
  if (digest(inputRaw) !== manifest.inputHash) throw new Error('输入漂移：拒绝恢复');
  if (digest(adapterRaw) !== manifest.adapterHash) throw new Error('adapter 漂移：拒绝恢复');
  return { manifest, config: JSON.parse(configRaw), items: JSON.parse(inputRaw) };
}

function errorCode(error, fallback) {
  if (error?.name === 'AbortError') return 'OUTCOME_UNKNOWN';
  return typeof error?.code === 'string' ? error.code : fallback;
}

async function withTimeout(operation, timeoutMs, stage) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error(`${stage} timeout`);
      timeout.code = stage === 'write' ? 'OUTCOME_UNKNOWN' : 'TIMEOUT';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function stopped(runDir) {
  try {
    await readFile(path.join(runDir, 'stop.request'));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function runBatch({ runDir }) {
  const absoluteRun = path.resolve(runDir);
  const lockPath = path.join(absoluteRun, 'runtime.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('run 已由另一进程执行', { cause: error });
    throw error;
  }
  try {
    const { config, items } = await verifyNoDrift(absoluteRun);
    const byId = new Map(items.map((item) => [item.id, item]));
    const adapter = await importAdapter(
      path.resolve(path.dirname((await parseJson(path.join(absoluteRun, 'manifest.json'))).configPath), config.adapter),
    );
    for (const name of ['write', 'read', 'verify']) {
      if (typeof adapter[name] !== 'function') throw new Error(`adapter.${name} 缺失`);
    }
    const statePath = path.join(absoluteRun, 'state.json');
    const state = await parseJson(statePath);
    if (!state.prepared) throw new Error('run 尚未 prepare 完成');
    if (state.phase === 'cancelled') await rm(path.join(absoluteRun, 'stop.request'), { force: true });
    state.phase = 'running';
    state.stopRequested = await stopped(absoluteRun);
    state.updatedAt = new Date().toISOString();
    let saveChain = Promise.resolve();
    const persist = () => {
      state.updatedAt = new Date().toISOString();
      saveChain = saveChain.then(() => atomicJson(statePath, state));
      return saveChain;
    };
    await persist();
    const candidates = Object.values(state.items).filter(
      (entry) => !['succeeded', 'needs-reconciliation'].includes(entry.status),
    );
    let cursor = 0;
    const retryBaseMs = Math.max(0, config.retryBaseMs ?? 100);
    const timeoutMs = Math.max(1, config.timeoutMs ?? 30_000);

    async function processItem(entry) {
      const item = byId.get(entry.id);
      if (!item) throw new Error(`snapshot 缺少 item: ${entry.id}`);
      entry.status = 'running';
      entry.lastErrorCode = undefined;
      await persist();
      const context = { config, runDir: absoluteRun, idempotencyKey: entry.idempotencyKey };
      let wrote = entry.writeCompleted === true;
      if (entry.writeStarted && !entry.writeCompleted && (config.idempotency ?? 'required') === 'none') {
        entry.status = 'needs-reconciliation';
        entry.lastErrorCode = 'OUTCOME_UNKNOWN';
        await audit(absoluteRun, {
          event: 'item-finished',
          itemId: entry.id,
          stage: 'write',
          status: entry.status,
          code: entry.lastErrorCode,
        });
        await persist();
        return;
      }
      for (let attempt = 1; !wrote && attempt <= config.maxAttempts; attempt += 1) {
        if (await stopped(absoluteRun)) {
          entry.status = 'cancelled';
          await audit(absoluteRun, { event: 'item-finished', itemId: entry.id, status: entry.status });
          await persist();
          return;
        }
        entry.attempts += 1;
        entry.writeStarted = true;
        await persist();
        try {
          await withTimeout((signal) => adapter.write(item, { ...context, signal }), timeoutMs, 'write');
          wrote = true;
          entry.writeCompleted = true;
          await persist();
          break;
        } catch (error) {
          const code = errorCode(error, 'WRITE_ERROR');
          entry.lastErrorCode = code;
          if ((config.idempotency ?? 'required') === 'none' && code !== 'NOT_SENT') {
            entry.status = 'needs-reconciliation';
            await audit(absoluteRun, {
              event: 'item-finished',
              itemId: entry.id,
              stage: 'write',
              status: entry.status,
              code,
            });
            await persist();
            return;
          }
          if (code === 'NOT_SENT') {
            entry.writeStarted = false;
            await persist();
          }
          if (!['TRANSIENT', 'OUTCOME_UNKNOWN'].includes(code) || attempt === config.maxAttempts) {
            entry.status = 'write-failed';
            await audit(absoluteRun, {
              event: 'item-finished',
              itemId: entry.id,
              stage: 'write',
              status: entry.status,
              code,
            });
            await persist();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, retryBaseMs * 2 ** (attempt - 1)));
        }
      }
      if (!wrote) return;
      for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
        try {
          const remote = await withTimeout((signal) => adapter.read(item, { ...context, signal }), timeoutMs, 'read');
          const valid = await adapter.verify(item, remote, context);
          entry.status = valid ? 'succeeded' : 'verify-failed';
          entry.lastErrorCode = valid ? undefined : 'VERIFY_MISMATCH';
          await audit(absoluteRun, {
            event: 'item-finished',
            itemId: entry.id,
            stage: 'verify',
            status: entry.status,
            code: entry.lastErrorCode,
          });
          await persist();
          return;
        } catch (error) {
          const code = errorCode(error, 'READ_ERROR');
          entry.lastErrorCode = code;
          if (!['TRANSIENT', 'TIMEOUT'].includes(code) || attempt === config.maxAttempts) {
            entry.status = 'read-failed';
            await audit(absoluteRun, {
              event: 'item-finished',
              itemId: entry.id,
              stage: 'read',
              status: entry.status,
              code,
            });
            await persist();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, retryBaseMs * 2 ** (attempt - 1)));
        }
      }
    }

    async function worker() {
      while (true) {
        if (await stopped(absoluteRun)) return;
        const index = cursor++;
        if (index >= candidates.length) return;
        await processItem(candidates[index]);
      }
    }

    await Promise.all(Array.from({ length: Math.min(config.concurrency, candidates.length) }, () => worker()));
    state.stopRequested = await stopped(absoluteRun);
    const currentCounts = counts(state);
    if (state.stopRequested) state.phase = 'cancelled';
    else if (currentCounts.failed || currentCounts.verifyFailed || currentCounts.needsReconciliation)
      state.phase = 'completed-with-errors';
    else state.phase = 'completed';
    await persist();
    await audit(absoluteRun, { event: 'run-finished', status: state.phase });
    return { ...state, counts: counts(state) };
  } finally {
    await lock?.close();
    await rm(lockPath, { force: true });
  }
}

export async function readRunStatus(runDir) {
  const state = await parseJson(path.join(path.resolve(runDir), 'state.json'));
  return { ...state, counts: counts(state) };
}

export async function requestStop(runDir) {
  const absoluteRun = path.resolve(runDir);
  await writeFile(path.join(absoluteRun, 'stop.request'), `${new Date().toISOString()}\n`, { flag: 'a', mode: 0o600 });
  const statePath = path.join(absoluteRun, 'state.json');
  const state = await parseJson(statePath);
  state.stopRequested = true;
  state.updatedAt = new Date().toISOString();
  await atomicJson(statePath, state);
  await audit(absoluteRun, { event: 'stop-requested', status: state.phase });
  return readRunStatus(absoluteRun);
}

export async function waitForRun(runDir, { timeoutMs = 30_000, pollMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const state = await readRunStatus(runDir);
    if (terminalPhases.has(state.phase)) return state;
    if (Date.now() >= deadline) return { ...state, timedOut: true };
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
  }
}
