const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function readLoopbackGatewayUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  const value = new URL(raw);
  if (
    !['http:', 'https:'].includes(value.protocol) ||
    !LOOPBACK_HOSTNAMES.has(value.hostname) ||
    value.username ||
    value.password ||
    value.search ||
    value.hash
  )
    throw new Error('SEEDLANDS_MODEL_GATEWAY_URL must be an exact loopback gateway URL');
  return value.toString().replace(/\/$/u, '');
}
