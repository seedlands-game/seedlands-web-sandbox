import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { WebSocket } from '../apps/node-server/node_modules/ws/wrapper.mjs';

const origin = 'http://127.0.0.1:4173';
const key = 'isolated-listen-smoke-key';
const utf8 = new TextEncoder();

const freePort = async () => {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法分配 loopback 测试端口。');
  await new Promise((accept, reject) => server.close((error) => (error ? reject(error) : accept())));
  return address.port;
};

const hello = () => {
  const metadata = utf8.encode(
    JSON.stringify({
      draftVersion: 1,
      messageClass: 'session-hello',
      message: {
        kind: 'session-hello',
        protocolVersion: 1,
        transport: 'experimental-local-c0-v1',
        accessKey: key,
      },
      blocks: [],
    }),
  );
  const frame = new Uint8Array(16 + metadata.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, 0x534c4330, true);
  view.setUint16(4, 1, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, metadata.byteLength, true);
  view.setUint32(12, 0, true);
  frame.set(metadata, 16);
  return frame;
};

const directory = await mkdtemp(resolve(tmpdir(), 'seedlands-web-node-dist-'));
const port = await freePort();
const artifact = resolve('apps/node-server/dist/node-server.js');
await writeFile(resolve(directory, 'access-key'), `${key}\n`, { mode: 0o600 });
const child = spawn(
  process.execPath,
  [
    artifact,
    '--data-directory',
    resolve(directory, 'world'),
    '--seed',
    'web-node-dist-smoke',
    '--compute',
    'worker-thread',
    '--listen',
    `127.0.0.1:${port}`,
    '--origin',
    origin,
    '--access-key-file',
    resolve(directory, 'access-key'),
  ],
  { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] },
);
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});
const exited = new Promise((accept) => child.once('exit', accept));
const waitFor = async (check, label) => {
  const deadline = Date.now() + 20_000;
  while (!check()) {
    if (child.exitCode !== null) throw new Error(`${label} 前进程退出 ${child.exitCode}：${stderr}`);
    if (Date.now() >= deadline) throw new Error(`等待 ${label} 超时：${stderr}`);
    await new Promise((accept) => setTimeout(accept, 20));
  }
};

try {
  await waitFor(() => stdout.includes('"kind":"network-ready"'), 'dist 网络监听');
  const socket = new WebSocket(`ws://127.0.0.1:${port}/seedlands`, { origin, perMessageDeflate: false });
  let welcome = false;
  let socketFailure = null;
  socket.on('open', () => socket.send(hello()));
  socket.on('message', (data) => {
    const bytes = data instanceof Buffer ? data : Buffer.from(data);
    welcome ||= bytes.includes(Buffer.from('"messageClass":"welcome"'));
  });
  socket.on('error', (error) => {
    socketFailure = error;
  });
  socket.on('close', (code, reason) => {
    if (!welcome) socketFailure = new Error(`socket closed ${code}: ${reason.toString()}`);
  });
  await waitFor(() => welcome || socketFailure !== null, '认证 hello/welcome');
  if (socketFailure) throw socketFailure;
  socket.close(1000, 'smoke-complete');
  child.kill('SIGTERM');
  const code = await exited;
  if (code !== 0 || !stdout.includes('"kind":"stopped"')) throw new Error(`dist 关停失败 ${code}：${stderr}`);
  process.stdout.write(`dist listen+hello 通过：${stdout.match(/"kind":"network-ready"/g)?.length ?? 0} 个监听事件\n`);
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await rm(directory, { recursive: true, force: true });
}
