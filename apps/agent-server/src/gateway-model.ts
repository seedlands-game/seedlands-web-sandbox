import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import {
  BaseChatModel,
  type BaseChatModelParams,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import { ChatOpenAI } from '@langchain/openai';

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
  if (!Array.isArray(message.tool_calls)) return { valid, invalid };
  for (const value of message.tool_calls) {
    if (!value || typeof value !== 'object') continue;
    const call = value as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    if (
      typeof call.id !== 'string' ||
      typeof call.function?.name !== 'string' ||
      typeof call.function.arguments !== 'string'
    )
      continue;
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

  constructor(options: GatewayChatModelOptions, boundTools: readonly unknown[] = []) {
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
    void kwargs;
    return new GatewayChatModel(
      this.options,
      tools.map((entry) => convertToOpenAITool(entry)),
    );
  }

  async _generate(
    messages: BaseMessage[],
    options?: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
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
        }),
        signal: controller?.signal ?? options?.signal,
      });
      if (!response.ok) throw new Error(`gateway request failed with HTTP ${response.status}`);
      raw = (await response.json()) as Record<string, unknown>;
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
    const aiMessage = new AIMessage({
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
