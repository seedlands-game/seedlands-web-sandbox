import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import {
  BaseChatModel,
  type BaseChatModelParams,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import { AIMessageChunk, mapChatMessagesToStoredMessages, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import { ChatOpenAI } from '@langchain/openai';
import { JOURNAL_MESSAGE_UTF8_LIMIT } from './workspace/types.js';
import {
  boundedText,
  GATEWAY_MAX_TOOL_CALLS,
  GATEWAY_TOOL_ARGUMENT_BYTES,
  object,
  readGatewayResponse,
} from './gateway-response.js';

export type GatewayModelTier = 'flash' | 'pro';

export type GatewayChatModelOptions = BaseChatModelParams &
  Readonly<{
    tier: GatewayModelTier;
    baseUrl: string;
    apiKey: string;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
    maxOutputTokens?: number;
  }>;

function wireMessage(message: BaseMessage): Readonly<Record<string, unknown>> {
  const nativeFields = Object.fromEntries(
    Object.entries(message.additional_kwargs).filter(
      ([key]) => key !== 'gateway_raw_message' && key !== 'gateway_raw_response',
    ),
  );
  const type = message._getType();
  if (type === 'tool') {
    const tool = message as BaseMessage & { tool_call_id?: string };
    return { role: 'tool', content: message.content, tool_call_id: tool.tool_call_id };
  }
  if (type === 'ai') {
    const ai = message as BaseMessage & { tool_calls?: readonly Readonly<Record<string, unknown>>[] };
    const standardized = ai.tool_calls?.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
    }));
    return {
      role: 'assistant',
      content: message.content,
      ...nativeFields,
      ...(standardized?.length ? { tool_calls: standardized } : {}),
    };
  }
  return {
    role: type === 'system' ? 'system' : type === 'human' ? 'user' : type,
    content: message.content,
    ...nativeFields,
  };
}

function responseToolCalls(message: Record<string, unknown>) {
  const valid: { id: string; name: string; args: Record<string, unknown>; type: 'tool_call' }[] = [];
  const invalid: { id?: string; name?: string; args?: string; error?: string; type: 'invalid_tool_call' }[] = [];
  if (message.tool_calls === undefined) return { valid, invalid };
  if (!Array.isArray(message.tool_calls) || message.tool_calls.length > GATEWAY_MAX_TOOL_CALLS)
    throw new Error('gateway tool call count exceeds limit or has invalid type');
  const ids = new Set<string>();
  for (const value of message.tool_calls) {
    const call = object(value) ? value : {};
    if (
      call.type !== 'function' ||
      !boundedText(call.id, 128) ||
      !call.id ||
      ids.has(call.id) ||
      !object(call.function) ||
      !boundedText(call.function.name, 64) ||
      !call.function.name ||
      !boundedText(call.function.arguments, GATEWAY_TOOL_ARGUMENT_BYTES)
    )
      throw new Error('gateway tool call exceeds limit or has invalid fields');
    ids.add(call.id);
    try {
      const parsed = JSON.parse(call.function.arguments) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('arguments are not an object');
      valid.push({ id: call.id, name: call.function.name, args: parsed as Record<string, unknown>, type: 'tool_call' });
    } catch {
      invalid.push({
        id: call.id,
        name: call.function.name,
        args: call.function.arguments,
        error: 'invalid JSON tool arguments',
        type: 'invalid_tool_call',
      });
    }
  }
  return { valid, invalid };
}

/**
 * Thin OpenAI-compatible adapter. It owns no retry, queue, pool, or provider
 * selection. Raw response/message objects are retained for lossless journaling.
 */
export class GatewayChatModel extends BaseChatModel {
  readonly options: GatewayChatModelOptions;
  private readonly boundTools: readonly unknown[];

  constructor(
    options: GatewayChatModelOptions,
    boundTools: readonly unknown[] = [],
    private readonly boundCallOptions: Readonly<Record<string, unknown>> = {},
  ) {
    super({ ...options, maxRetries: 0 });
    if (!options.baseUrl || !options.apiKey)
      throw new Error('gateway base URL and an explicitly supplied credential are required');
    this.options = options;
    this.boundTools = boundTools;
  }

  _llmType(): string {
    return 'seedlands-openai-compatible-gateway';
  }

  bindTools(tools: BindToolsInput[], kwargs?: Partial<this['ParsedCallOptions']>) {
    return new GatewayChatModel(
      this.options,
      tools.map((entry) => convertToOpenAITool(entry)),
      kwargs ?? {},
    );
  }

  async _generate(
    messages: BaseMessage[],
    options?: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    options?.signal?.throwIfAborted();
    const fetchImplementation = this.options.fetch ?? globalThis.fetch;
    const controller = this.options.timeoutMs === undefined ? undefined : new AbortController();
    const abortFromCaller = () => controller?.abort(options?.signal?.reason);
    options?.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = controller
      ? setTimeout(() => controller.abort(new Error('gateway request timed out')), this.options.timeoutMs)
      : undefined;
    let raw: Record<string, unknown>;
    if (options?.signal?.aborted) controller?.abort(options.signal.reason);
    try {
      const response = await fetchImplementation(`${this.options.baseUrl.replace(/\/$/u, '')}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.options.tier,
          messages: messages.map(wireMessage),
          ...(this.boundTools.length ? { tools: this.boundTools } : {}),
          max_tokens: this.options.maxOutputTokens ?? 8192,
          ...((options as Record<string, unknown> | undefined)?.reasoning_effort
            ? { reasoning_effort: (options as Record<string, unknown>).reasoning_effort }
            : {}),
          ...(((options as Record<string, unknown> | undefined)?.tool_choice ?? this.boundCallOptions.tool_choice)
            ? {
                tool_choice:
                  (options as Record<string, unknown> | undefined)?.tool_choice ?? this.boundCallOptions.tool_choice,
              }
            : {}),
        }),
        signal: controller?.signal ?? options?.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`gateway request failed with HTTP ${response.status}`);
      }
      raw = await readGatewayResponse(response);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      options?.signal?.removeEventListener('abort', abortFromCaller);
    }
    const choices = raw.choices;
    const choice = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined;
    const rawMessage = choice?.message;
    if (!rawMessage || typeof rawMessage !== 'object') throw new Error('gateway response has no assistant message');
    const message = rawMessage as Record<string, unknown>;
    const content = typeof message.content === 'string' || Array.isArray(message.content) ? message.content : '';
    const parsedToolCalls = responseToolCalls(message);
    // The standard structured-output pipeline requires a complete AIMessageChunk, even without streaming.
    const aiMessage = new AIMessageChunk({
      content,
      id: typeof raw.id === 'string' ? raw.id : undefined,
      tool_calls: parsedToolCalls.valid,
      invalid_tool_calls: parsedToolCalls.invalid,
      additional_kwargs: { ...message, gateway_raw_message: message, gateway_raw_response: raw },
      response_metadata: {
        finish_reason: choice?.finish_reason ?? null,
        model_name: typeof raw.model === 'string' ? raw.model : undefined,
        usage: raw.usage,
      },
    });
    // Non-streaming responses must keep strict JSON failures; chunk construction resets this field.
    aiMessage.invalid_tool_calls = parsedToolCalls.invalid;
    // BaseChatModel merges llmOutput into response_metadata after _generate; include that final copy now.
    aiMessage.response_metadata.gateway_raw_response = raw;
    // Opaque/raw fields are intentionally lossless duplicates. Budget the actual durable representation,
    // including a small allowance for the resident's later request-scoped id and storage encoding.
    const stored = mapChatMessagesToStoredMessages([aiMessage])[0];
    if (new TextEncoder().encode(JSON.stringify(stored)).byteLength > JOURNAL_MESSAGE_UTF8_LIMIT - 1024)
      throw new Error('gateway message exceeds durable journal byte limit');
    return {
      generations: [{ text: typeof content === 'string' ? content : JSON.stringify(content), message: aiMessage }],
      llmOutput: { gateway_raw_response: raw },
    };
  }
}

export function createGatewayChatModel(options: GatewayChatModelOptions): GatewayChatModel {
  return new GatewayChatModel(options);
}

/** Admission control used to detect whether the standard adapter is lossless enough. */
export function createStandardGatewayChatModel(options: GatewayChatModelOptions): ChatOpenAI {
  return new ChatOpenAI({
    model: options.tier,
    apiKey: options.apiKey,
    maxRetries: 0,
    timeout: options.timeoutMs,
    configuration: { baseURL: options.baseUrl, ...(options.fetch ? { fetch: options.fetch } : {}) },
  });
}
