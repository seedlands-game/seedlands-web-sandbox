import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { RESIDENT_FRAME_MAX_BYTES } from '@seedlands/cognition-protocol';

export function matchesResidentPairingToken(value: string, pairingToken: string): boolean {
  const token = Buffer.from(value);
  const expected = Buffer.from(pairingToken);
  return token.length === expected.length && timingSafeEqual(token, expected);
}

export function createResidentListener(allowedOrigins: readonly string[], sockets: ReadonlySet<WebSocket>) {
  if (!allowedOrigins.length) throw new Error('Exact browser Origins are required');
  const origins = new Set(
    allowedOrigins.map((origin) => {
      if (new URL(origin).origin !== origin) throw new Error('Invalid exact browser Origin');
      return origin;
    }),
  );
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const ws = new WebSocketServer({ noServer: true, maxPayload: RESIDENT_FRAME_MAX_BYTES, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    if (
      request.url !== '/' ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '') ||
      !origins.has(request.headers.origin ?? '') ||
      sockets.size >= 1
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    ws.handleUpgrade(request, socket, head, (connection) => ws.emit('connection', connection));
  });
  return { server, ws };
}

export async function listenResident(server: Server, port: number) {
  await new Promise<void>((resolve, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', rejectListen);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('resident listener unavailable');
  return `ws://127.0.0.1:${address.port}/`;
}
