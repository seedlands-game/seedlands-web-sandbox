import { timingSafeEqual, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage } from 'node:http';
import { Buffer } from 'node:buffer';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { decodeC0Envelope } from '@seedlands/game-core/server/protocol/network-c0-codec';
import {
  NETWORK_DRAFT_PROTOCOL_VERSION,
  type PublicInboundMessage,
  type PublicSessionRef,
} from '@seedlands/game-core/server/protocol/network-message-semantics';
import { projectWelcomePresentationReference } from '@seedlands/game-core/server/protocol/network-reference-bootstrap-presentation';
import type { NodeAuthorityLane, NodeAuthorityPublication } from '../runtime/node-authority-lane';
import { nodeCorePlatform } from '../runtime/node-core-platform';
import {
  createSession,
  MAX_FRAME_BYTES,
  playableNetworkLimits,
  projectGameplay,
} from './node-playable-network-session';

const HELLO_TIMEOUT_MS = 3_000;
type Session = ReturnType<typeof createSession>;

export type NodePlayableNetworkOptions = Readonly<{
  hostname: '127.0.0.1' | '::1';
  port: number;
  origin: string;
  accessKeyFile: string;
  worldId?: string;
}>;

export type NodePlayableNetworkServer = Readonly<{
  url: string;
  close(): Promise<void>;
}>;

const bytes = (raw: RawData): Uint8Array | null => {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Array.isArray(raw)) return new Uint8Array(Buffer.concat(raw));
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  return null;
};

const constantTimeKeyEquals = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
};
export async function createNodePlayableNetworkServer(
  authority: NodeAuthorityLane,
  options: NodePlayableNetworkOptions,
): Promise<NodePlayableNetworkServer> {
  const rawKey = await readFile(options.accessKeyFile, 'utf8');
  const accessKey = rawKey.trim();
  if (!accessKey || accessKey.length > 256) throw new Error('访问口令文件必须包含 1 到 256 个字符。');
  const http = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: MAX_FRAME_BYTES });
  let active: Session | null = null;
  let attaching = false;
  let unauthenticated = 0;
  let inputSequence = 0;
  let actionSequence = 0;
  let captureSequence = 0;
  let closing = false;

  const rejectUpgrade = (_request: IncomingMessage, socket: import('node:stream').Duplex, code: number) => {
    socket.write(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };
  http.on('upgrade', (request, socket, head) => {
    if (closing || request.headers.origin !== options.origin || request.url !== '/seedlands')
      return rejectUpgrade(request, socket, 403);
    if (unauthenticated >= 8) return rejectUpgrade(request, socket, 503);
    unauthenticated += 1;
    sockets.handleUpgrade(request, socket, head, (webSocket) => sockets.emit('connection', webSocket, request));
  });

  sockets.on('connection', (socket) => {
    let unauthenticatedSettled = false;
    const timer = setTimeout(() => socket.close(4003, 'hello-timeout'), HELLO_TIMEOUT_MS);
    const finishUnauthenticated = () => {
      if (unauthenticatedSettled) return;
      unauthenticatedSettled = true;
      unauthenticated = Math.max(0, unauthenticated - 1);
    };
    socket.once('close', finishUnauthenticated);
    socket.once('error', finishUnauthenticated);
    socket.once('message', (raw, isBinary) => {
      clearTimeout(timer);
      finishUnauthenticated();
      if (!isBinary) return socket.close(4003, 'binary-required');
      const value = bytes(raw);
      if (!value || value.byteLength > MAX_FRAME_BYTES) return socket.close(4003, 'frame-limit');
      let decoded;
      try {
        decoded = decodeC0Envelope(value, nodeCorePlatform.utf8);
      } catch {
        return socket.close(4003, 'protocol');
      }
      const hello = decoded.message as Partial<Extract<PublicInboundMessage, { kind: 'session-hello' }>>;
      if (hello.kind !== 'session-hello' || hello.transport !== 'experimental-local-c0-v1')
        return socket.close(4003, 'protocol');
      if (!constantTimeKeyEquals(hello.accessKey ?? '', accessKey)) return socket.close(4004, 'authentication');
      if (active || attaching) return socket.close(4005, 'server-full');
      attaching = true;
      void Promise.all([authority.readReady(), authority.readDiagnostics()])
        .then(([ready, diagnostics]) => {
          if (active || socket.readyState !== WebSocket.OPEN) {
            attaching = false;
            return socket.close(4005, 'server-full');
          }
          const ref: PublicSessionRef = {
            protocolVersion: NETWORK_DRAFT_PROTOCOL_VERSION,
            sessionEpoch: `remote-${randomUUID()}`,
            worldId: options.worldId ?? 'default',
            playerId: ready.playerId,
          };
          const session = createSession(
            socket,
            authority,
            ref,
            ready,
            authority.epoch,
            () => {
              if (active !== session) return;
              active = null;
              void authority.clearInput().catch(() => undefined);
            },
            () => inputSequence++,
            () => actionSequence++,
            () => captureSequence++,
          );
          active = session;
          attaching = false;
          const snapshot = authority.latestSnapshot() ?? ready.snapshot;
          const presentation = projectWelcomePresentationReference(ready, snapshot, {
            serverEpoch: authority.epoch,
            sessionId: ref.sessionEpoch,
            worldId: ref.worldId,
            contentVersion: 'seedlands-web-node-playable-experimental-v1',
            physicsSchema: { version: 1, bodyRegistryVersion: 1 },
            fluidSchema: { version: 1, encoding: 'fluid-v2' },
            publicCapabilities: [],
            limits: playableNetworkLimits,
            durableCommitSequence: diagnostics.host.durableCommitSequence,
          });
          void session
            .enqueue('welcome', {
              kind: 'welcome',
              ref,
              serverEpoch: authority.epoch,
              physicsHz: ready.frequencies.physicsHz,
              presentation,
              gameplay: projectGameplay({ snapshot, gameplay: ready.gameplay }),
            })
            .then(() =>
              session.publish({ snapshot, gameplay: ready.gameplay, commits: [] } as NodeAuthorityPublication),
            )
            .catch(() => session.close(4001, 'welcome-failed'));
        })
        .catch((error) => {
          attaching = false;
          socket.close(
            1011,
            `authority-unavailable:${error instanceof Error ? error.message : 'unknown'}`.slice(0, 120),
          );
        });
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, options.hostname, () => {
      http.off('error', reject);
      resolve();
    });
  });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('网络监听地址无效。');
  const host = options.hostname === '::1' ? '[::1]' : options.hostname;
  return {
    url: `ws://${host}:${address.port}/seedlands`,
    close: async () => {
      if (closing) return;
      closing = true;
      const session = active;
      session?.close(1001, 'server-shutdown');
      await session?.whenDrained().catch(() => undefined);
      for (const socket of sockets.clients) socket.close(1001, 'server-shutdown');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          for (const socket of sockets.clients) socket.terminate();
          resolve();
        }, 500);
        sockets.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
