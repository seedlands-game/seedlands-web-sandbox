export const GATEWAY_RESPONSE_BYTES = 1024 * 1024;
export const GATEWAY_MAX_TOOL_CALLS = 8;
export const GATEWAY_TOOL_ARGUMENT_BYTES = 16 * 1024;
const encoder = new TextEncoder();
export const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const boundedText = (value: unknown, maxBytes: number): value is string =>
  typeof value === 'string' && encoder.encode(value).byteLength <= maxBytes;

/** Do not trust Content-Length (compression/chunked responses may omit or understate it). */
export async function readGatewayResponse(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('gateway response has no body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    if (Number(response.headers.get('content-length')) > GATEWAY_RESPONSE_BYTES)
      throw new Error('gateway response exceeds byte limit');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > GATEWAY_RESPONSE_BYTES) throw new Error('gateway response exceeds byte limit');
      if (value.byteLength) chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!object(raw) || !Array.isArray(raw.choices) || raw.choices.length !== 1 || !object(raw.choices[0]))
    throw new Error('gateway response must contain exactly one choice');
  const message = raw.choices[0].message;
  if (!object(message) || message.role !== 'assistant') throw new Error('gateway response has no assistant message');
  if (message.content !== null && !boundedText(message.content, 64 * 1024))
    throw new Error('gateway assistant content exceeds limit or has invalid type');
  if (
    message.reasoning_content !== undefined &&
    message.reasoning_content !== null &&
    !boundedText(message.reasoning_content, 512 * 1024)
  )
    throw new Error('gateway reasoning exceeds limit or has invalid type');
  // Opaque provider fields remain lossless, but only inside the bounded response envelope.
  if (raw.id !== undefined && !boundedText(raw.id, 256)) throw new Error('gateway response id is invalid');
  return raw;
}
