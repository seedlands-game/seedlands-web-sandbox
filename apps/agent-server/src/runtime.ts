import type {
  CharacterObservation,
  ControlBinding,
  ControllerReceipt,
} from '@seedlands/stdlib/runtime/character-control-protocol';
import type { ControllerClientMessage, ControllerHostMessage } from '@seedlands/cognition-protocol';
import { CognitionBudget, type BudgetReservation } from './budget.js';
import { createCognitionGraph, decideWithGraph } from './cognition-graph.js';
import { ContextSession, estimateWireTokens, type ContextLimit } from './context-session.js';
import { DeepSeekTransportError } from './deepseek-transport.js';
import type { CognitionModel, ModelCompletion, ModelRequest } from './model-types.js';
import {
  CognitionScheduler,
  type CognitionSchedulerOptions,
  type SchedulerDispatch,
  validateFallbackSeconds,
} from './scheduler.js';

export type RuntimeOptions = Readonly<{
  binding: ControlBinding;
  model: CognitionModel | null;
  send: (message: ControllerHostMessage) => void;
  fallbackSeconds?: number;
  contextLimit?: ContextLimit;
  schedulerClock?: CognitionSchedulerOptions['clock'];
  requestId?: () => string;
  context?: ContextSession;
}>;

class BudgetExceededError extends Error {}

function budgetedModel(model: CognitionModel, budget: CognitionBudget, compression: boolean): CognitionModel {
  return {
    async complete(request: ModelRequest): Promise<ModelCompletion> {
      const estimatedInput = estimateWireTokens(request.messages);
      const reservation: BudgetReservation | null = budget.reserve(estimatedInput, request.maxTokens, compression);
      if (!reservation) throw new BudgetExceededError('cognition budget exhausted');
      try {
        const completion = await model.complete(request);
        budget.settle(reservation, completion.usage);
        return completion;
      } catch (error) {
        budget.settle(reservation, null);
        throw error;
      }
    },
  };
}

function bindingMatches(left: ControlBinding, right: ControlBinding): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.worldId === right.worldId &&
    left.epoch === right.epoch &&
    left.entityId === right.entityId &&
    left.incarnation === right.incarnation &&
    left.policyRevision === right.policyRevision
  );
}

function validateObservationBinding(binding: ControlBinding, observation: CharacterObservation): boolean {
  const character = observation.character;
  return (
    character.entityId === binding.entityId &&
    character.incarnation === binding.incarnation &&
    character.policyRevision === binding.policyRevision
  );
}

const significantEvent = (type: CharacterObservation['events'][number]['type']): boolean =>
  type === 'dialogue-heard' ||
  type === 'attacked' ||
  type === 'target-lost' ||
  type === 'goal-succeeded' ||
  type === 'goal-failed' ||
  type === 'goal-interrupted';

export class CognitionRuntime {
  private readonly budget = new CognitionBudget();
  private readonly scheduler: CognitionScheduler;
  private readonly requestId: () => string;
  private context: ContextSession;
  private readonly flashModel: CognitionModel | null;
  private readonly proModel: CognitionModel | null;
  private graph: ReturnType<typeof createCognitionGraph> | null;
  private latestObservation: CharacterObservation | null = null;
  private latestEventCursor = -1;
  private initialHistoryThroughCursor: number | null = null;
  private lastDecisionCursor = -1;
  private hostSequence = 0;
  private pendingIntent: Readonly<{
    requestId: string;
    toolCallId: string;
    observedCursor: number;
    observedRevision: number;
  }> | null = null;
  private pendingMemoryRequestId: string | null = null;
  private pendingContextTail: import('./model-types.js').DeepSeekMessage[] = [];
  private retryAfterObservation: Readonly<{ cursor: number; revision: number }> | null = null;
  private deferredTrigger = false;
  private paused = false;
  private terminal = false;
  private disposed = false;
  private abort: AbortController | null = null;
  private consecutiveFailures = 0;
  private backoffUntil = 0;
  private contextLimit: ContextLimit;
  private fallbackSeconds: number;

  constructor(private readonly options: RuntimeOptions) {
    this.requestId = options.requestId ?? (() => globalThis.crypto.randomUUID());
    this.contextLimit = options.contextLimit ?? 128_000;
    this.fallbackSeconds = validateFallbackSeconds(options.fallbackSeconds ?? 180);
    this.context = options.context ?? new ContextSession([], { contextLimit: this.contextLimit });
    this.flashModel = options.model ? budgetedModel(options.model, this.budget, false) : null;
    this.proModel = options.model ? budgetedModel(options.model, this.budget, true) : null;
    this.graph = this.flashModel ? createCognitionGraph({ model: this.flashModel }) : null;
    this.scheduler = new CognitionScheduler({
      fallbackSeconds: this.fallbackSeconds,
      ...(options.schedulerClock ? { clock: options.schedulerClock } : {}),
      dispatch: (trigger) => this.beginDispatch(trigger.kind),
    });
  }

  ready(): void {
    this.emit({
      kind: 'ready',
      fallbackSeconds: this.fallbackSeconds,
      modelAvailability: this.options.model ? 'available' : 'missing-key',
    });
    if (!this.options.model) this.status('fallback', 'missing-key');
  }

  receive(message: ControllerClientMessage): void {
    if (this.disposed || !bindingMatches(message.binding, this.options.binding)) return;
    if (message.kind === 'observe') {
      if (
        message.observation.character.entityId === this.options.binding.entityId &&
        message.observation.character.incarnation === this.options.binding.incarnation &&
        message.observation.character.lifecycle === 'deceased'
      ) {
        this.terminateDeceased(message.observation);
        return;
      }
      if (this.terminal) return;
      if (!validateObservationBinding(this.options.binding, message.observation)) {
        this.status(this.paused ? 'paused' : 'fallback', 'stale');
        return;
      }
      if (!this.latestObservation) {
        this.latestObservation = message.observation;
        this.latestEventCursor = message.observation.cursor;
        this.initialHistoryThroughCursor = message.observation.character.eventCursor;
        this.lastDecisionCursor = this.initialHistoryThroughCursor;
        this.context.appendEvents(message.observation.events);
        return;
      }
      const freshEvents = message.observation.events.filter((event) => event.cursor > this.latestEventCursor);
      this.latestObservation = message.observation;
      if (freshEvents.length) {
        this.latestEventCursor = Math.max(...freshEvents.map((event) => event.cursor));
        const contextBoundary = this.context.messageCount;
        this.context.appendEvents(freshEvents);
        if (this.pendingIntent) this.pendingContextTail.push(...this.context.extractTail(contextBoundary));
        for (const event of freshEvents)
          if (event.cursor > (this.initialHistoryThroughCursor ?? -1) && significantEvent(event.type))
            this.scheduler.notifyEvent(event.type);
      }
      if (
        this.retryAfterObservation &&
        (message.observation.cursor > this.retryAfterObservation.cursor ||
          message.observation.character.revision !== this.retryAfterObservation.revision)
      ) {
        this.retryAfterObservation = null;
        this.scheduler.notifyEvent('fresh-observation');
      }
      return;
    }
    if (this.terminal) return;
    if (message.kind === 'receipt') {
      this.receiveReceipt(message.receipt);
      return;
    }
    if (message.kind === 'control') {
      if (message.command === 'pause') this.pause();
      if (message.command === 'resume') this.resume();
      if (message.command === 'unbind') this.dispose();
      return;
    }
    if (message.kind === 'configure') {
      this.fallbackSeconds = validateFallbackSeconds(message.fallbackSeconds);
      this.scheduler.configureFallback(this.fallbackSeconds);
      if (message.contextLimit !== this.contextLimit) {
        this.contextLimit = message.contextLimit;
        this.context.configureLimit(this.contextLimit);
      }
      this.status(
        this.paused ? 'paused' : this.options.model ? 'ready' : 'fallback',
        this.options.model ? undefined : 'missing-key',
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort?.abort(new Error('runtime disposed'));
    this.scheduler.dispose();
    this.latestObservation = null;
    this.pendingIntent = null;
    this.pendingMemoryRequestId = null;
    this.pendingContextTail = [];
    this.retryAfterObservation = null;
    this.graph = null;
  }

  private pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.abort?.abort(new Error('runtime paused'));
    this.scheduler.pause();
    this.status('paused');
  }

  private terminateDeceased(observation: CharacterObservation): void {
    if (this.terminal) return;
    this.terminal = true;
    this.latestObservation = observation;
    this.abort?.abort(new Error('controlled character is deceased'));
    this.scheduler.dispose();
    this.pendingIntent = null;
    this.pendingMemoryRequestId = null;
    this.pendingContextTail = [];
    this.deferredTrigger = false;
    this.retryAfterObservation = null;
    this.context.rejectPreparedRotation();
    this.status('fallback', 'stale');
  }

  private resume(): void {
    if (!this.paused || this.disposed) return;
    this.paused = false;
    this.scheduler.resume();
    this.status(
      this.pendingIntent || this.pendingMemoryRequestId
        ? 'awaiting-receipt'
        : this.options.model
          ? 'ready'
          : 'fallback',
      this.options.model ? undefined : 'missing-key',
    );
  }

  private receiveReceipt(receipt: ControllerReceipt): void {
    if (receipt.requestId === this.pendingMemoryRequestId) {
      if (receipt.status === 'accepted' || receipt.status === 'succeeded') this.context.commitPreparedRotation();
      else this.context.rejectPreparedRotation();
      this.pendingMemoryRequestId = null;
      this.deferredTrigger = false;
      this.scheduler.notifyEvent('context-reconciled');
      this.status(this.paused ? 'paused' : this.pendingIntent ? 'awaiting-receipt' : 'ready');
      return;
    }
    if (receipt.requestId !== this.pendingIntent?.requestId) return;
    const pendingIntent = this.pendingIntent;
    this.context.appendMessages([
      {
        role: 'tool',
        tool_call_id: this.pendingIntent.toolCallId,
        content: JSON.stringify({
          status: receipt.status,
          ...(receipt.actionId ? { actionId: receipt.actionId } : {}),
          ...(receipt.reason ? { reason: receipt.reason } : {}),
          cursor: receipt.cursor,
          revision: receipt.revision,
        }),
      },
      ...this.pendingContextTail,
    ]);
    this.pendingContextTail = [];
    this.pendingIntent = null;
    if (receipt.status === 'rejected' && receipt.reason === 'CHARACTER_REVISION_CONFLICT') {
      this.retryAfterObservation = {
        cursor: pendingIntent.observedCursor,
        revision: pendingIntent.observedRevision,
      };
      this.deferredTrigger = false;
    } else if (this.deferredTrigger) {
      this.deferredTrigger = false;
      this.scheduler.notifyEvent('deferred-event');
    }
    this.status(this.paused ? 'paused' : 'ready');
  }

  private beginDispatch(kind: 'event' | 'fallback'): SchedulerDispatch {
    const observation = this.latestObservation;
    const graph = this.graph;
    if ((this.pendingIntent || this.pendingMemoryRequestId) && kind === 'event') this.deferredTrigger = true;
    if (
      this.disposed ||
      this.terminal ||
      this.paused ||
      this.pendingIntent ||
      this.pendingMemoryRequestId ||
      this.retryAfterObservation ||
      !observation ||
      !graph ||
      !this.flashModel ||
      (kind === 'fallback' && observation.cursor <= this.lastDecisionCursor)
    )
      return { dispatched: false, completion: Promise.resolve() };
    const retryAfterMs = this.backoffUntil - Date.now();
    if (retryAfterMs > 0) return { dispatched: false, completion: Promise.resolve(), retryAfterMs };
    return { dispatched: true, completion: this.runDecision(observation, graph) };
  }

  private async runDecision(
    observation: CharacterObservation,
    graph: NonNullable<CognitionRuntime['graph']>,
  ): Promise<void> {
    const startingRevision = observation.character.revision;
    const startingGeneration = this.context.generation;
    this.abort = new AbortController();
    try {
      if (this.context.needsRotation() && this.proModel && !this.pendingMemoryRequestId) {
        this.status('compressing');
        const rotation = await this.context.rotate(
          this.proModel,
          observation.character.memory,
          4096,
          this.abort.signal,
        );
        if (this.disposed || this.terminal || this.paused) {
          if (rotation.memory) this.context.rejectPreparedRotation();
          return;
        }
        if (rotation.memory) {
          const memoryRequestId = this.requestId();
          this.pendingMemoryRequestId = memoryRequestId;
          this.emit({ kind: 'memory', requestId: memoryRequestId, ...rotation.memory });
          this.status('awaiting-receipt');
          return;
        }
      }

      this.status('thinking');
      const graphSnapshotLength = this.context.messageCount;
      const graphMessages = [...this.context.messages];
      const result = await decideWithGraph(graph, observation, graphMessages, this.abort.signal);
      const latestObservation = this.latestObservation;
      if (
        this.disposed ||
        this.terminal ||
        this.paused ||
        this.context.generation !== startingGeneration ||
        !latestObservation ||
        latestObservation.character.revision !== startingRevision ||
        latestObservation.cursor !== observation.cursor
      ) {
        if (!this.disposed && !this.terminal && !this.paused && latestObservation?.cursor !== observation.cursor)
          this.scheduler.notifyEvent('stale-observation');
        if (!this.disposed && !this.terminal && !this.paused) this.status('ready', 'stale');
        return;
      }
      const concurrentTail = this.context.extractTail(graphSnapshotLength);
      this.context.replaceMessages(result.messages);
      this.lastDecisionCursor = observation.cursor;
      if (result.status !== 'intent' || !result.proposal) {
        this.context.appendMessages(concurrentTail);
        this.status('fallback', result.status === 'over-budget' ? 'over-budget' : 'invalid-tool');
        return;
      }
      if (!result.intentToolCallId) {
        this.context.appendMessages(concurrentTail);
        this.status('fallback', 'invalid-tool');
        return;
      }
      const requestId = this.requestId();
      this.pendingIntent = {
        requestId,
        toolCallId: result.intentToolCallId,
        observedCursor: observation.cursor,
        observedRevision: startingRevision,
      };
      this.pendingContextTail.push(...concurrentTail);
      this.consecutiveFailures = 0;
      this.emit({
        kind: 'intent',
        requestId,
        observedRevision: startingRevision,
        observedCursor: observation.cursor,
        intent: result.proposal,
      });
      this.status('awaiting-receipt');
      return;
    } catch (error) {
      if (this.disposed || this.terminal || this.paused) return;
      if (error instanceof BudgetExceededError) {
        this.status('fallback', 'over-budget');
        return;
      }
      this.consecutiveFailures += 1;
      const transport = error instanceof DeepSeekTransportError ? error : null;
      const delay = transport?.retryAfterMs ?? Math.min(60_000, 1000 * 2 ** (this.consecutiveFailures - 1));
      this.backoffUntil = Date.now() + delay;
      this.status(
        'fallback',
        transport?.kind === 'timeout' ? 'timeout' : transport?.kind === 'rate-limited' ? 'rate-limited' : 'transport',
      );
      return;
    } finally {
      this.abort = null;
    }
  }

  private status(
    state: Extract<ControllerHostMessage, { kind: 'status' }>['state'],
    reason?: Extract<ControllerHostMessage, { kind: 'status' }>['reason'],
  ): void {
    this.emit({ kind: 'status', state, ...(reason ? { reason } : {}), usage: this.budget.snapshot() });
  }

  private emit(
    value:
      | Omit<Extract<ControllerHostMessage, { kind: 'ready' }>, 'protocolVersion' | 'binding' | 'sequence'>
      | Omit<Extract<ControllerHostMessage, { kind: 'intent' }>, 'protocolVersion' | 'binding' | 'sequence'>
      | Omit<Extract<ControllerHostMessage, { kind: 'memory' }>, 'protocolVersion' | 'binding' | 'sequence'>
      | Omit<Extract<ControllerHostMessage, { kind: 'status' }>, 'protocolVersion' | 'binding' | 'sequence'>,
  ): void {
    this.options.send({
      ...value,
      protocolVersion: 1,
      binding: this.options.binding,
      sequence: ++this.hostSequence,
    } as ControllerHostMessage);
  }
}
