import type { CharacterEvent, CharacterMemory } from '@seedlands/game-core/runtime/character-control-protocol';
import { PRO_MODEL } from './config.js';
import type { CognitionModel, DeepSeekMessage, ModelCompletion } from './model-types.js';

export type ContextLimit = 128_000 | 256_000;
export type ContextRotation = Readonly<{
  kind: 'none' | 'pro' | 'deterministic';
  generation: number;
  memory?: Readonly<{
    summary: string;
    throughCursor: number;
    expectedMemoryRevision: number;
  }>;
  completion?: ModelCompletion;
  error?: 'compression-failed' | 'incomplete-tool-pair';
}>;

type PreparedRotation = Readonly<{
  summary: string;
  throughCursor: number;
  expectedMemoryRevision: number;
  frozenLength: number;
}>;

export type ContextSessionOptions = Readonly<{
  contextLimit?: ContextLimit;
  estimateTokens?: (messages: readonly DeepSeekMessage[]) => number;
  softThreshold?: number;
  hardThreshold?: number;
}>;

type EventEntry = Readonly<{ cursor: number; message: DeepSeekMessage }>;

function hasCompleteToolPairs(messages: readonly DeepSeekMessage[]): boolean {
  const pending = new Set<string>();
  for (const message of messages) {
    if (message.role === 'assistant') for (const call of message.tool_calls ?? []) pending.add(call.id);
    if (message.role === 'tool' && message.tool_call_id) pending.delete(message.tool_call_id);
  }
  return pending.size === 0;
}

export function estimateWireTokens(messages: readonly DeepSeekMessage[]): number {
  const bytes = Buffer.byteLength(JSON.stringify(messages), 'utf8');
  return Math.ceil((bytes / 3) * 1.2);
}

function eventMessage(event: CharacterEvent): DeepSeekMessage {
  return { role: 'user', content: JSON.stringify({ kind: 'authority-event', event }) };
}

function deterministicSummary(messages: readonly DeepSeekMessage[], throughCursor: number): string {
  const publicText = messages
    .filter((message) => message.role === 'user' || message.role === 'tool')
    .slice(-12)
    .map((message) => message.content ?? '')
    .join('\n')
    .slice(-4096);
  return `Deterministic context recovery through event cursor ${throughCursor}. Recent public evidence:\n${publicText}`;
}

function publicCompressionMessages(messages: readonly DeepSeekMessage[]): readonly DeepSeekMessage[] {
  return messages.map(({ reasoning_content: _privateReasoning, ...message }) => message);
}

export class ContextSession {
  private messagesValue: DeepSeekMessage[];
  private events: EventEntry[] = [];
  private generationValue = 1;
  private rotation: Promise<ContextRotation> | null = null;
  private contextLimit: ContextLimit;
  private softThreshold: number;
  private hardThreshold: number;
  private readonly estimate: (messages: readonly DeepSeekMessage[]) => number;
  private prepared: PreparedRotation | null = null;

  constructor(initialMessages: readonly DeepSeekMessage[] = [], options: ContextSessionOptions = {}) {
    this.messagesValue = [...initialMessages];
    this.contextLimit = options.contextLimit ?? 128_000;
    this.softThreshold = options.softThreshold ?? (this.contextLimit === 128_000 ? 112_000 : 224_000);
    this.hardThreshold = options.hardThreshold ?? this.contextLimit;
    this.estimate = options.estimateTokens ?? estimateWireTokens;
  }

  get messages(): readonly DeepSeekMessage[] {
    return this.messagesValue;
  }

  get generation(): number {
    return this.generationValue;
  }

  get hasPreparedRotation(): boolean {
    return this.prepared !== null;
  }

  appendMessages(messages: readonly DeepSeekMessage[]): void {
    this.messagesValue.push(...messages);
  }

  replaceMessages(messages: readonly DeepSeekMessage[]): void {
    this.messagesValue = [...messages];
  }

  configureLimit(contextLimit: ContextLimit): void {
    this.contextLimit = contextLimit;
    this.softThreshold = contextLimit === 128_000 ? 112_000 : 224_000;
    this.hardThreshold = contextLimit;
  }

  appendEvents(events: readonly CharacterEvent[]): void {
    for (const event of events) {
      const message = eventMessage(event);
      this.events.push({ cursor: event.cursor, message });
      this.messagesValue.push(message);
    }
  }

  needsRotation(): boolean {
    return this.estimate(this.messagesValue) >= this.softThreshold;
  }

  rotate(
    model: CognitionModel,
    memory: CharacterMemory,
    maxTokens = 4096,
    signal?: AbortSignal,
  ): Promise<ContextRotation> {
    if (this.rotation) return this.rotation;
    if (this.prepared) return Promise.resolve({ kind: 'none', generation: this.generationValue });
    if (!this.needsRotation()) return Promise.resolve({ kind: 'none', generation: this.generationValue });
    if (!hasCompleteToolPairs(this.messagesValue))
      return Promise.resolve({
        kind: 'none',
        generation: this.generationValue,
        error: 'incomplete-tool-pair',
      });

    const frozenMessages = [...this.messagesValue];
    const throughCursor = this.events.at(-1)?.cursor ?? memory.throughCursor;
    this.rotation = this.performRotation(model, memory, frozenMessages, throughCursor, maxTokens, signal).finally(
      () => {
        this.rotation = null;
      },
    );
    return this.rotation;
  }

  commitPreparedRotation(): boolean {
    const prepared = this.prepared;
    if (!prepared) return false;
    const tail = this.messagesValue.slice(prepared.frozenLength);
    this.messagesValue = [
      {
        role: 'user',
        content: JSON.stringify({
          kind: 'confirmed-memory',
          summary: prepared.summary,
          throughCursor: prepared.throughCursor,
        }),
      },
      ...tail,
    ];
    this.events = this.events.filter((entry) => entry.cursor > prepared.throughCursor);
    this.prepared = null;
    this.generationValue += 1;
    return true;
  }

  rejectPreparedRotation(): void {
    this.prepared = null;
  }

  private async performRotation(
    model: CognitionModel,
    memory: CharacterMemory,
    frozenMessages: readonly DeepSeekMessage[],
    throughCursor: number,
    maxTokens: number,
    signal?: AbortSignal,
  ): Promise<ContextRotation> {
    try {
      const completion = await model.complete({
        model: PRO_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'Compress only confirmed public facts, goals, and evidence references. Never expose private reasoning. Return a concise plain-text memory summary.',
          },
          ...publicCompressionMessages(frozenMessages),
        ],
        maxTokens,
        signal,
      });
      const summary = completion.message.content?.trim();
      if (!summary || summary.length > 16_000) throw new Error('invalid compression length');
      this.prepared = {
        summary,
        throughCursor,
        expectedMemoryRevision: memory.revision,
        frozenLength: frozenMessages.length,
      };
      return {
        kind: 'pro',
        generation: this.generationValue + 1,
        memory: { summary, throughCursor, expectedMemoryRevision: memory.revision },
        completion,
      };
    } catch {
      if (this.estimate(this.messagesValue) < this.hardThreshold)
        return { kind: 'none', generation: this.generationValue, error: 'compression-failed' };
      const summary = deterministicSummary(frozenMessages, throughCursor);
      this.prepared = {
        summary,
        throughCursor,
        expectedMemoryRevision: memory.revision,
        frozenLength: frozenMessages.length,
      };
      return {
        kind: 'deterministic',
        generation: this.generationValue + 1,
        memory: { summary, throughCursor, expectedMemoryRevision: memory.revision },
        error: 'compression-failed',
      };
    }
  }
}
