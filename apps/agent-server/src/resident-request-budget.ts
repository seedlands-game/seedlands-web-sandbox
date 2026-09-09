import type { BaseMessage } from '@langchain/core/messages';
import { assessContextBudget } from './workspace/types.js';

export const RESIDENT_MAX_MODEL_STEPS = 8;
export const RESIDENT_MAX_BEHAVIOR_PROPOSALS = 3;
export const RESIDENT_OUTPUT_TOKEN_RESERVE = 8192;

/** UTF-8 bytes are a conservative token bound, not a claimed tokenizer measurement. */
export function assessResidentRequest(prefix: string, messages: readonly BaseMessage[], tools: unknown) {
  const content = JSON.stringify({
    prefix,
    messages: messages.map((message) => ({
      type: message._getType(),
      content: message.content,
      fields: Object.fromEntries(
        Object.entries(message.additional_kwargs).filter(([key]) => !key.startsWith('gateway_raw_')),
      ),
      ...('tool_calls' in message ? { tool_calls: message.tool_calls } : {}),
      ...('tool_call_id' in message ? { tool_call_id: message.tool_call_id } : {}),
    })),
    tools,
  });
  const estimatedInputTokens = new TextEncoder().encode(content).byteLength + (messages.length + 1) * 32;
  const estimatedTotalTokens = estimatedInputTokens + RESIDENT_OUTPUT_TOKEN_RESERVE;
  return { estimatedInputTokens, estimatedTotalTokens, status: assessContextBudget(estimatedTotalTokens) };
}
