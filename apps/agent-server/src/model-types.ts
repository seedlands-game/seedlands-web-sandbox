export type DeepSeekRole = 'system' | 'user' | 'assistant' | 'tool';

export type DeepSeekToolCall = Readonly<{
  id: string;
  type: 'function';
  function: Readonly<{ name: string; arguments: string }>;
}>;

export type DeepSeekMessage = Readonly<{
  role: DeepSeekRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: readonly DeepSeekToolCall[];
  /** Provider-private wire state. It must never enter world memory or ordinary logs. */
  reasoning_content?: string | null;
}>;

export type DeepSeekTool = Readonly<{
  type: 'function';
  function: Readonly<{
    name: string;
    description: string;
    parameters: Readonly<Record<string, unknown>>;
  }>;
}>;

export type ModelUsage = Readonly<{
  inputTokens: number;
  cacheHitTokens: number;
  outputTokens: number;
  totalTokens: number;
}>;

export type ModelCompletion = Readonly<{
  message: DeepSeekMessage;
  finishReason: string | null;
  usage: ModelUsage | null;
  latencyMs: number;
}>;

export type ModelRequest = Readonly<{
  model: string;
  messages: readonly DeepSeekMessage[];
  tools?: readonly DeepSeekTool[];
  maxTokens: number;
  signal?: AbortSignal;
}>;

export interface CognitionModel {
  complete(request: ModelRequest): Promise<ModelCompletion>;
}
