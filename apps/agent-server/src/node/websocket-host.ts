import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { isIP } from 'node:net';
import type { ControlBinding } from '@seedlands/stdlib/runtime/character-control-protocol';
import type { ControllerHostMessage } from '@seedlands/cognition-protocol';
import { CONTROLLER_FRAME_MAX_BYTES } from '@seedlands/cognition-protocol';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { CognitionModel } from '../model-types.js';
import { CognitionRuntime } from '../runtime.js';
import { parseControllerClientMessage, sameBinding } from '../wire-validation.js';

export type AgentServerOptions = Readonly<{
  model: CognitionModel | null;
  allowedOrigins: readonly string[];
  host?: '127.0.0.1' | '::1';
  port?: number;
  pairingToken?: string;
  maxFrameBytes?: number;
  maxBufferedBytes?: number;
  authenticationTimeoutMs?: number;
  maxConnections?: number;
  createRuntime?: (options: ConstructorParameters<typeof CognitionRuntime>[0]) => CognitionRuntime;
}>;

export type AgentServerHandle = Readonly<{
  url: string;
  pairingToken: string;
  close: () => Promise<void>;
}>;

/** Node-only client constructor exposed for focused host integration tests and local diagnostics. */
export const AgentServerWebSocketClient = WebSocket;

const errorFrame = (
  code: Extract<ControllerHostMessage, { kind: 'error' }>['code'],
  message: string,
  sequence: number,
): Extract<ControllerHostMessage, { kind: 'error' }> => ({
  kind: 'error',
  protocolVersion: 1,
  sequence,
  code,
  message,
});

const isLoopback = (address: string | undefined): boolean =>
  address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';

function validOrigin(request: IncomingMessage, allowedOrigins: ReadonlySet<string>): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && allowedOrigins.has(origin);
  } catch {
    return false;
  }
}

function tokensEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function startAgentServer(options: AgentServerOptions): Promise<AgentServerHandle> {
  if (!options.allowedOrigins.length) throw new Error('at least one exact browser origin is required');
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('agent server must bind to an explicit loopback address');
  const allowedOrigins = new Set(
    options.allowedOrigins.map((entry) => {
      const parsed = new URL(entry);
      if (parsed.origin !== entry) throw new Error('allowedOrigins entries must be exact origins');
      return entry;
    }),
  );
  const pairingToken = options.pairingToken ?? randomBytes(32).toString('base64url');
  const maxFrameBytes = options.maxFrameBytes ?? CONTROLLER_FRAME_MAX_BYTES;
  const maxBufferedBytes = options.maxBufferedBytes ?? 262_144;
  const authTimeoutMs = options.authenticationTimeoutMs ?? 5000;
  const maxConnections = options.maxConnections ?? 1;
  if (!Number.isSafeInteger(maxConnections) || maxConnections < 1 || maxConnections > 16)
    throw new Error('maxConnections must be between 1 and 16');
  const createRuntime = options.createRuntime ?? ((runtimeOptions) => new CognitionRuntime(runtimeOptions));
  const http: Server = createServer((_request, response) => {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });
  const sockets = new Set<WebSocket>();
  const runtimes = new Map<WebSocket, CognitionRuntime>();
  const ws = new WebSocketServer({ noServer: true, maxPayload: maxFrameBytes, perMessageDeflate: false });

  http.on('upgrade', (request, socket, head) => {
    if (
      !isLoopback(request.socket.remoteAddress) ||
      !validOrigin(request, allowedOrigins) ||
      request.url !== '/' ||
      sockets.size >= maxConnections
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    ws.handleUpgrade(request, socket, head, (connection) => ws.emit('connection', connection, request));
  });

  ws.on('connection', (socket) => {
    sockets.add(socket);
    let binding: ControlBinding | null = null;
    let clientSequence = -1;
    let errorSequence = 0;
    const send = (message: ControllerHostMessage): void => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const body = JSON.stringify(message);
      if (Buffer.byteLength(body, 'utf8') > maxFrameBytes || socket.bufferedAmount > maxBufferedBytes) {
        socket.close(1009, 'bounded queue exceeded');
        return;
      }
      socket.send(body);
    };
    const reject = (code: Extract<ControllerHostMessage, { kind: 'error' }>['code'], message: string): void => {
      send(errorFrame(code, message, ++errorSequence));
      socket.close(1008, message);
    };
    const authTimer = setTimeout(() => reject('PAIRING_REJECTED', 'pairing required'), authTimeoutMs);

    socket.on('message', (raw: RawData, binary: boolean) => {
      if (binary) {
        reject('BAD_FRAME', 'binary frames are not accepted');
        return;
      }
      const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
      if (bytes.byteLength > maxFrameBytes) {
        reject('FRAME_TOO_LARGE', 'frame exceeded configured limit');
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      } catch {
        reject('BAD_FRAME', 'frame must be valid JSON');
        return;
      }
      const message = parseControllerClientMessage(parsed);
      if (!message) {
        reject('BAD_FRAME', 'frame does not match the controller protocol');
        return;
      }
      if (!binding) {
        if (message.kind !== 'hello' || message.sequence !== 0 || !tokensEqual(pairingToken, message.pairingToken)) {
          reject('PAIRING_REJECTED', 'pairing rejected');
          return;
        }
        binding = message.binding;
        clientSequence = message.sequence;
        clearTimeout(authTimer);
        const runtime = createRuntime({ binding, model: options.model, send });
        runtimes.set(socket, runtime);
        runtime.ready();
        return;
      }
      if (message.kind === 'hello') {
        reject('BAD_FRAME', 'hello may only be sent once');
        return;
      }
      if (!sameBinding(binding, message.binding)) {
        reject('BINDING_MISMATCH', 'connection binding is immutable');
        return;
      }
      if (message.sequence <= clientSequence) {
        reject('STALE_SEQUENCE', 'sequence must increase monotonically');
        return;
      }
      clientSequence = message.sequence;
      runtimes.get(socket)?.receive(message);
    });

    const dispose = (): void => {
      clearTimeout(authTimer);
      sockets.delete(socket);
      runtimes.get(socket)?.dispose();
      runtimes.delete(socket);
    };
    socket.once('close', dispose);
    socket.once('error', dispose);
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port ?? 0, host, () => {
      http.off('error', reject);
      resolve();
    });
  });
  const address = http.address();
  if (!address || typeof address === 'string' || !isIP(address.address)) throw new Error('agent server did not bind');
  const hostname = address.family === 'IPv6' ? `[${address.address}]` : address.address;

  return {
    url: `ws://${hostname}:${address.port}/`,
    pairingToken,
    close: async () => {
      for (const runtime of runtimes.values()) runtime.dispose();
      runtimes.clear();
      for (const socket of sockets) socket.close(1001, 'server stopping');
      sockets.clear();
      await new Promise<void>((resolve, reject) => ws.close((error) => (error ? reject(error) : resolve())));
      await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
