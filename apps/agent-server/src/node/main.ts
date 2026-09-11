import { createGatewayChatModel } from '../gateway-model.js';
import { ResidentFactory } from '../resident-factory.js';
import { createPostgresFrameworkPersistence, PersistentNpcWorkspace } from '../workspace/index.js';
import { readLoopbackGatewayUrl } from './loopback-gateway-url.js';
import { startResidentServer } from './resident-host.js';

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
const connectionString = process.env.SEEDLANDS_COGNITION_DATABASE_URL?.trim();
if (!connectionString) throw new Error('SEEDLANDS_COGNITION_DATABASE_URL is required');
const baseUrl = readLoopbackGatewayUrl(process.env.SEEDLANDS_MODEL_GATEWAY_URL);
const gatewayToken = process.env.SEEDLANDS_MODEL_GATEWAY_TOKEN?.trim();
if (Boolean(baseUrl) !== Boolean(gatewayToken))
  throw new Error('SEEDLANDS_MODEL_GATEWAY_URL and SEEDLANDS_MODEL_GATEWAY_TOKEN must be configured together');
const flashTimeoutMs = 65_000;
const proTimeoutMs = 305_000;
const factoryTimeoutMs = 315_000;
const flash =
  baseUrl && gatewayToken
    ? createGatewayChatModel({ tier: 'flash', baseUrl, apiKey: gatewayToken, timeoutMs: flashTimeoutMs })
    : null;
const pro =
  baseUrl && gatewayToken
    ? createGatewayChatModel({ tier: 'pro', baseUrl, apiKey: gatewayToken, timeoutMs: proTimeoutMs })
    : null;

const workspace = PersistentNpcWorkspace.open({ connectionString });
await workspace.setup();
const framework = await createPostgresFrameworkPersistence(connectionString);
const factory = pro ? ResidentFactory.open({ pro, connectionString, modelTimeoutMs: factoryTimeoutMs }) : null;
if (factory) await factory.setup();
const handle = await startResidentServer({
  workspace,
  framework,
  flash,
  pro,
  factory: factory ?? undefined,
  allowedOrigins: origins,
  port: parsePort(process.env.AGENT_SERVER_PORT ?? '8787'),
});

process.stdout.write(
  `${JSON.stringify({
    kind: 'resident-server-ready',
    protocolVersion: 2,
    url: handle.url,
    pairingToken: handle.pairingToken,
    modelAvailability: flash && pro ? 'available' : 'missing-gateway',
  })}\n`,
);

let stopping: Promise<void> | null = null;
const stop = (): Promise<void> => {
  stopping ??= (async () => {
    await handle.close();
    await factory?.close();
    await framework.close();
    await workspace.close();
    process.exitCode = 0;
  })();
  return stopping;
};
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
