import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync, appendFileSync, openSync, closeSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.cwd(),
  out = resolve(process.env.HOTPATH_OUT),
  raw = resolve(out, 'profiles');
mkdirSync(raw, { recursive: true });
const run = process.env.HOTPATH_RUN,
  port = 9487;
// Fail before launching if the diagnostic port belongs to another browser or task.
await new Promise((accept, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(port, '127.0.0.1', () => probe.close(accept));
});
const log = openSync(resolve(out, 'profile-run.log'), 'w');
const child = spawn('pnpm', ['harness:classic'], {
  cwd: root,
  stdio: ['ignore', log, log],
  env: {
    ...process.env,
    SEEDLANDS_CLASSIC_BENCHMARK: '1',
    SEEDLANDS_DIAGNOSTIC_CDP_PORT: String(port),
    SEEDLANDS_HARNESS_RUN_ID: run,
    SEEDLANDS_RESERVATION_RUN: run,
    SEEDLANDS_RESERVATION_EVIDENCE: `harness/results/${run}/window.json`,
    SEEDLANDS_CLASSIC_GENERAL_WORKERS: '1',
  },
});
let done = false,
  exitCode = null;
child.on('exit', (code) => {
  done = true;
  exitCode = code;
  closeSync(log);
});
const event = (kind, data = {}) =>
  appendFileSync(
    resolve(out, 'profile-events.jsonl'),
    JSON.stringify({ at: new Date().toISOString(), kind, ...data }) + '\n',
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version;
for (let i = 0; i < 90 && !done; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`);
    version = await r.json();
    break;
  } catch {
    await sleep(500);
  }
}
if (!version) {
  event('CONNECT_FAILED');
  process.exitCode = 1;
  await new Promise((r) => child.on('exit', r));
} else {
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener('open', r, { once: true });
    ws.addEventListener('error', j, { once: true });
  });
  let seq = 0;
  const pending = new Map(),
    targets = new Map();
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('timeout ' + method));
      }, 7000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  ws.addEventListener('message', (message) => {
    const x = JSON.parse(message.data);
    if (x.id) {
      const p = pending.get(x.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(x.id);
        x.error ? p.reject(new Error(JSON.stringify(x.error))) : p.resolve(x.result);
      }
    } else if (x.method === 'Target.targetDestroyed') {
      const t = targets.get(x.params.targetId);
      if (t) {
        t.destroyed = true;
        event('TARGET_DESTROYED', { targetId: t.info.targetId, url: t.info.url, uncapturedTailSince: t.lastCaptureAt });
      }
    }
  });
  ws.addEventListener('close', () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('CDP closed'));
    }
    pending.clear();
  });
  event('CONNECTED', { browser: version.Browser });
  async function discover() {
    const { targetInfos } = await send('Target.getTargets');
    for (const info of targetInfos) {
      if (
        !['page', 'worker'].includes(info.type) ||
        !info.url.startsWith('http://127.0.0.1:4273/') ||
        targets.has(info.targetId)
      )
        continue;
      const t = { info, index: targets.size, segment: 0, startedAt: new Date().toISOString(), lastCaptureAt: null };
      targets.set(info.targetId, t);
      try {
        t.sessionId = (await send('Target.attachToTarget', { targetId: info.targetId, flatten: true })).sessionId;
        await send('Profiler.enable', {}, t.sessionId);
        await send('Profiler.setSamplingInterval', { interval: 2000 }, t.sessionId);
        await send('Profiler.start', {}, t.sessionId);
        t.cpu = true;
        try {
          await send(
            'HeapProfiler.startSampling',
            { samplingInterval: 65536, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true },
            t.sessionId,
          );
          t.heap = true;
        } catch (e) {
          event('HEAP_UNAVAILABLE', { targetId: info.targetId, error: e.message });
        }
        event('ATTACHED', { ...info, index: t.index, heap: t.heap ?? false });
      } catch (e) {
        t.error = e.message;
        event('ATTACH_FAILED', { ...info, error: e.message });
      }
    }
  }
  async function capture(t) {
    if (!t.cpu || t.destroyed) return;
    const stages = [
      ...readFileSync(resolve(out, 'profile-run.log'), 'utf8').matchAll(/› (C[0-5])[^\n]*\([\d.]+[ms]\)/g),
    ].map((m) => m[1]);
    const completedStage = stages.at(-1) ?? null;
    const capturedAt = new Date().toISOString(),
      prefix = `target-${t.index}-segment-${t.segment++}`;
    try {
      const { profile } = await send('Profiler.stop', {}, t.sessionId);
      writeFileSync(resolve(raw, prefix + '.cpuprofile'), JSON.stringify(profile));
      await send('Profiler.start', {}, t.sessionId);
      if (t.heap) {
        const { profile: heap } = await send('HeapProfiler.getSamplingProfile', {}, t.sessionId);
        writeFileSync(resolve(raw, prefix + '.heapprofile'), JSON.stringify(heap));
      }
      event('CAPTURE', {
        targetId: t.info.targetId,
        url: t.info.url,
        prefix,
        startedAt: t.lastCaptureAt ?? t.startedAt,
        capturedAt,
        completedStage,
        previousCompletedStage: t.lastCompletedStage ?? null,
      });
      t.lastCaptureAt = capturedAt;
      t.lastCompletedStage = completedStage;
    } catch (e) {
      event('CAPTURE_FAILED', { targetId: t.info.targetId, prefix, error: e.message });
    }
  }
  let last = Date.now();
  while (!done) {
    try {
      await discover();
      if (Date.now() - last >= 10000) {
        await Promise.all([...targets.values()].map(capture));
        last = Date.now();
      }
    } catch (e) {
      event('DISCOVERY_FAILED', { error: e.message });
      if (ws.readyState !== WebSocket.OPEN) break;
    }
    await sleep(500);
  }
  writeFileSync(resolve(out, 'profile-targets.json'), JSON.stringify([...targets.values()], null, 2) + '\n');
  ws.close();
  event('COLLECTOR_DONE', { exitCode });
  if (!done) await new Promise((r) => child.on('exit', r));
  process.exitCode = exitCode ?? 1;
}
