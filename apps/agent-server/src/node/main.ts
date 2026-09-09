import { resolveDeepSeekEndpoint } from '../config.js';
import { DeepSeekChatCompletionsTransport } from '../deepseek-transport.js';
import { startAgentServer } from './websocket-host.js';

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 0;
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) throw new Error('AGENT_SERVER_PORT is invalid');
  return port;
}

const origins = (process.env.SEEDLANDS_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const endpoint = resolveDeepSeekEndpoint(process.env);
const handle = await startAgentServer({
  model: endpoint ? new DeepSeekChatCompletionsTransport({ endpoint }) : null,
  allowedOrigins: origins,
  port: parsePort(process.env.AGENT_SERVER_PORT ?? '8787'),
});

process.stdout.write(
  `${JSON.stringify({
    kind: 'agent-server-ready',
    protocolVersion: 1,
    url: handle.url,
    pairingToken: handle.pairingToken,
    modelAvailability: endpoint ? 'available' : 'missing-key',
  })}\n`,
);

const stop = async (): Promise<void> => {
  await handle.close();
  process.exitCode = 0;
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
