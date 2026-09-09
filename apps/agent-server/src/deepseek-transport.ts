import { redactSecrets, type DeepSeekEndpointConfig } from './config.js';
import type {
  CognitionModel,
  DeepSeekMessage,
  DeepSeekToolCall,
  ModelCompletion,
  ModelRequest,
  ModelUsage,
} from './model-types.js';

export class DeepSeekTransportError extends Error {
  constructor(
    readonly kind: 'timeout' | 'rate-limited' | 'http' | 'invalid-response' | 'network',
    message: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'DeepSeekTransportError';
  }
}

export type DeepSeekTransportOptions = Readonly<{
  endpoint: DeepSeekEndpointConfig;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}>;

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const finiteNonNegative = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

function parseUsage(value: unknown): ModelUsage | null {
  const source = record(value);
  if (!source) return null;
  const inputTokens = finiteNonNegative(source.prompt_tokens);
  const outputTokens = finiteNonNegative(source.completion_tokens);
  const cacheHitTokens = finiteNonNegative(source.prompt_cache_hit_tokens);
  return {
    inputTokens,
    cacheHitTokens,
    outputTokens,
    totalTokens: finiteNonNegative(source.total_tokens) || inputTokens + outputTokens,
  };
}

function parseToolCalls(value: unknown): readonly DeepSeekToolCall[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 8) throw new Error('tool_calls must be a bounded array');
  return value.map((entry, index) => {
    const call = record(entry);
    const fn = record(call?.function);
    if (
      call?.type !== 'function' ||
      typeof call.id !== 'string' ||
      !call.id ||
      call.id.length > 128 ||
      typeof fn?.name !== 'string' ||
      !fn.name ||
      fn.name.length > 64 ||
      typeof fn.arguments !== 'string' ||
      fn.arguments.length > 16_384
    )
      throw new Error(`invalid tool call at index ${index}`);
    return { id: call.id, type: 'function' as const, function: { name: fn.name, arguments: fn.arguments } };
  });
}

function parseCompletion(value: unknown, latencyMs: number): ModelCompletion {
  const source = record(value);
  if (!source || !Array.isArray(source.choices) || source.choices.length !== 1)
    throw new Error('response must contain exactly one choice');
  const choice = record(source.choices[0]);
  if (!choice) throw new Error('choice must be an object');
  const message = record(choice?.message);
  if (message?.role !== 'assistant') throw new Error('choice must contain an assistant message');
  const content = message.content;
  const reasoning = message.reasoning_content;
  if (content !== null && typeof content !== 'string') throw new Error('assistant content is invalid');
  if (reasoning !== undefined && reasoning !== null && typeof reasoning !== 'string')
    throw new Error('assistant reasoning is invalid');
  const parsed: DeepSeekMessage = {
    role: 'assistant',
    content: content ?? null,
    ...(reasoning === undefined ? {} : { reasoning_content: reasoning }),
    ...(message.tool_calls === undefined ? {} : { tool_calls: parseToolCalls(message.tool_calls) }),
  };
  return {
    message: parsed,
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null,
    usage: parseUsage(source.usage),
    latencyMs,
  };
}

function retryAfter(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // The response is already being rejected; cancellation is best-effort resource cleanup.
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Keep the bounded-response error stable even if provider stream cleanup fails.
        }
        throw new DeepSeekTransportError('invalid-response', 'DeepSeek response exceeded the configured limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export class DeepSeekChatCompletionsTransport implements CognitionModel {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(private readonly options: DeepSeekTransportOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.requestTimeoutMs ?? 30_000;
    this.maxResponseBytes = options.maxResponseBytes ?? 1_048_576;
  }

  async complete(request: ModelRequest): Promise<ModelCompletion> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(request.signal?.reason);
    let listening = false;
    if (request.signal?.aborted) onAbort();
    else if (request.signal) {
      request.signal.addEventListener('abort', onAbort, { once: true });
      listening = true;
      if (request.signal.aborted) onAbort();
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const started = this.now();
    try {
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error('request aborted');
      timeout = setTimeout(() => controller.abort(new Error('deadline exceeded')), this.timeoutMs);
      const response = await this.fetchImpl(`${this.options.endpoint.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.endpoint.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          ...(request.tools?.length ? { tools: request.tools, tool_choice: 'auto' } : {}),
          max_tokens: request.maxTokens,
          stream: false,
          thinking: { type: 'enabled' },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const kind = response.status === 429 ? 'rate-limited' : 'http';
        const retryAfterMs = retryAfter(response);
        await cancelBody(response.body);
        throw new DeepSeekTransportError(kind, `DeepSeek request failed with status ${response.status}`, retryAfterMs);
      }
      const lengthHeader = response.headers.get('content-length');
      const length = lengthHeader === null ? null : Number(lengthHeader);
      if (length !== null && Number.isFinite(length) && length > this.maxResponseBytes) {
        await cancelBody(response.body);
        throw new DeepSeekTransportError('invalid-response', 'DeepSeek response exceeded the configured limit');
      }
      const body = await readBoundedBody(response, this.maxResponseBytes);
      try {
        return parseCompletion(JSON.parse(body), Math.max(0, this.now() - started));
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown response error';
        throw new DeepSeekTransportError('invalid-response', `Invalid DeepSeek response: ${detail}`);
      }
    } catch (error) {
      if (error instanceof DeepSeekTransportError) throw error;
      const aborted = controller.signal.aborted;
      const raw = error instanceof Error ? error.message : 'request failed';
      const message = redactSecrets(raw, [this.options.endpoint.apiKey]);
      throw new DeepSeekTransportError(
        aborted ? 'timeout' : 'network',
        aborted ? 'DeepSeek request timed out' : message,
      );
    } finally {
      if (timeout !== null) clearTimeout(timeout);
      if (listening) request.signal?.removeEventListener('abort', onAbort);
    }
  }
}
