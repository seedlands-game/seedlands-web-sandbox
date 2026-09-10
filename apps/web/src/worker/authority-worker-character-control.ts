import type { AuthorityRuntime } from '@seedlands/game-core/server/authority/authority-runtime';
import type { BoundCharacterControlRequest } from '@seedlands/game-core/compute/authority-worker-protocol';
import type {
  CharacterControlRequest,
  CharacterControlResult,
  CharacterState,
  ControlBinding,
} from '@seedlands/game-core/runtime/character-control-protocol';
import type {
  WorldFrontier,
  WorldHarnessError,
  WorldHarnessResult,
} from '@seedlands/game-core/server/harness/world-harness-contract';
import {
  WorldResourceAuthorizer,
  type WorldAuthorizationRule,
} from '@seedlands/game-core/server/harness/world-authorization';
import { characterHarnessOperation } from '@seedlands/game-core/server/harness/world-harness-operations';

const DIALOGUE_RANGE = 10;

type Options = Readonly<{
  runtime: () => AuthorityRuntime;
  worldId: () => string;
  worldEpoch: () => string;
  /** Additional world rules. Explicit denies override the bound visitor's default self grants. */
  authorizationRules?: readonly WorldAuthorizationRule[];
}>;

type BindingRecord = { binding: ControlBinding; lastSequence: number; authorizer: WorldResourceAuthorizer };

const distance = (left: readonly number[], right: readonly number[]) =>
  Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);

const failure = (cause: unknown): WorldHarnessError => {
  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') {
    const code = cause.code;
    return {
      code,
      message: cause instanceof Error ? cause.message : code,
      kind: code.endsWith('_CONFLICT') ? 'conflict' : 'unavailable',
    };
  }
  const invalid = cause instanceof TypeError || cause instanceof RangeError;
  return {
    code: invalid ? 'WORLD_REQUEST_INVALID' : 'WORLD_EXECUTION_FAILED',
    message: cause instanceof Error ? cause.message : String(cause),
    kind: invalid ? 'validation' : 'execution',
  };
};

export class BrowserCharacterAuthority {
  private readonly bindings = new Map<string, BindingRecord>();
  private bindingSequence = 0;

  constructor(private readonly options: Options) {}

  trusted(request: CharacterControlRequest): WorldHarnessResult<CharacterControlResult> {
    try {
      if (!request || typeof request !== 'object' || typeof request.kind !== 'string')
        throw new TypeError('Character request is invalid.');
      if (
        (request.kind === 'capabilities' && request.entityId) ||
        request.kind === 'intent' ||
        request.kind === 'memory' ||
        request.kind === 'behavior' ||
        request.kind === 'speak'
      )
        return this.denied('Bound character control is required.');
      if (request.kind === 'dialogue') this.assertDialogueAvailable(request.entityId);
      return this.success(this.options.runtime().character(request));
    } catch (cause) {
      return this.failed(cause);
    }
  }

  bind(entityId: string): ControlBinding {
    if (typeof entityId !== 'string' || !entityId.trim()) throw new TypeError('Character id is invalid.');
    const state = this.state(entityId);
    if (state.lifecycle !== 'active')
      throw new BoundControlFailure('CHARACTER_UNAVAILABLE', 'Character is unavailable.');
    const actor = this.options.runtime().server.createEntityReference(entityId);
    if (!actor) throw new BoundControlFailure('CHARACTER_UNAVAILABLE', 'Character is unavailable.');
    const binding: ControlBinding = Object.freeze({
      sessionId: `character-control-${++this.bindingSequence}`,
      worldId: this.options.worldId(),
      epoch: this.options.worldEpoch(),
      entityId,
      incarnation: state.incarnation,
      policyRevision: state.policyRevision,
      actor: Object.freeze(actor),
    });
    const authorizer = new WorldResourceAuthorizer({
      principals: [{ id: binding.sessionId, boundEntityId: entityId, labels: ['character-controller'] }],
      rules: [
        {
          effect: 'allow',
          resources: ['world.character'],
          operations: ['read', 'execute', 'write'],
          scope: 'self',
        },
        ...(this.options.authorizationRules ?? []),
      ],
    });
    this.bindings.set(binding.sessionId, { binding, lastSequence: -1, authorizer });
    return binding;
  }

  control(
    binding: ControlBinding,
    sequence: number,
    request: BoundCharacterControlRequest,
  ): WorldHarnessResult<CharacterControlResult> {
    try {
      const record = this.requireBinding(binding);
      if (!Number.isSafeInteger(sequence) || sequence <= record.lastSequence)
        throw new BoundControlFailure('CHARACTER_SEQUENCE_STALE', 'Character control sequence is stale.');
      if (
        !request ||
        typeof request !== 'object' ||
        !['capabilities', 'observe', 'intent', 'memory', 'behavior', 'speak'].includes(request.kind)
      )
        throw new TypeError('Bound character request is invalid.');
      if (request.entityId !== binding.entityId)
        throw new BoundControlFailure('CHARACTER_BINDING_INVALID', 'Character binding is invalid.');
      if (request.kind === 'intent' && (!Number.isSafeInteger(request.expectedCursor) || request.expectedCursor < 0))
        throw new TypeError('Bound character event cursor is invalid.');
      const decision = record.authorizer.authorize(binding.sessionId, characterHarnessOperation(request).authorization);
      if (!decision.allowed) return this.denied(decision.message);
      record.lastSequence = sequence;
      return this.success(this.options.runtime().character(request, binding.actor));
    } catch (cause) {
      return this.failed(cause);
    }
  }

  unbind(binding: ControlBinding): boolean {
    const record = this.bindings.get(binding?.sessionId);
    if (!record || !this.sameBinding(record.binding, binding)) return false;
    return this.bindings.delete(binding.sessionId);
  }

  clear(): void {
    this.bindings.clear();
  }

  private assertDialogueAvailable(entityId: string): void {
    const runtime = this.options.runtime();
    const player = runtime.server.getEntity(runtime.playerId);
    const character = runtime.server.getEntity(entityId);
    const playerState = runtime.server.getPlayerState(runtime.playerId);
    if (
      !player ||
      playerState.lifecycle !== 'alive' ||
      !character ||
      character.type !== 'npc' ||
      character.health === 0 ||
      distance(player.position, character.position) > DIALOGUE_RANGE
    )
      throw new BoundControlFailure('CHARACTER_UNAVAILABLE', 'Character is unavailable.');
  }

  private state(entityId: string): CharacterState {
    const result = this.options.runtime().server.character({ kind: 'inspect', entityId });
    if (result.kind !== 'state') throw new Error('Character state is unavailable.');
    return result.character;
  }

  private requireBinding(binding: ControlBinding): BindingRecord {
    if (!binding || typeof binding !== 'object')
      throw new BoundControlFailure('CHARACTER_BINDING_INVALID', 'Character binding is invalid.');
    const record = this.bindings.get(binding.sessionId);
    if (
      !record ||
      !this.sameBinding(record.binding, binding) ||
      binding.worldId !== this.options.worldId() ||
      binding.epoch !== this.options.worldEpoch()
    )
      throw new BoundControlFailure('CHARACTER_BINDING_INVALID', 'Character binding is invalid.');
    const actor = this.options.runtime().server.createEntityReference(binding.entityId);
    if (!actor) throw new BoundControlFailure('CHARACTER_BINDING_INVALID', 'Character binding is invalid.');
    const state = this.state(binding.entityId);
    if (
      state.lifecycle !== 'active' ||
      actor.epoch !== binding.actor.epoch ||
      actor.lifetime !== binding.actor.lifetime ||
      state.incarnation !== binding.incarnation ||
      state.policyRevision !== binding.policyRevision
    )
      throw new BoundControlFailure('CHARACTER_BINDING_INVALID', 'Character binding is invalid.');
    return record;
  }

  private sameBinding(left: ControlBinding, right: ControlBinding): boolean {
    return (
      left.sessionId === right.sessionId &&
      left.worldId === right.worldId &&
      left.epoch === right.epoch &&
      left.entityId === right.entityId &&
      left.incarnation === right.incarnation &&
      left.policyRevision === right.policyRevision &&
      left.actor.entityId === right.actor.entityId &&
      left.actor.epoch === right.actor.epoch &&
      left.actor.lifetime === right.actor.lifetime
    );
  }

  private success(data: CharacterControlResult): WorldHarnessResult<CharacterControlResult> {
    return { ok: true, data, frontier: this.frontier() };
  }

  private denied(message: string): WorldHarnessResult<CharacterControlResult> {
    return {
      ok: false,
      error: { code: 'WORLD_PERMISSION_DENIED', message, kind: 'permission' },
      frontier: this.frontier(),
    };
  }

  private failed(cause: unknown): WorldHarnessResult<CharacterControlResult> {
    return { ok: false, error: failure(cause), frontier: this.frontier() };
  }

  private frontier(): WorldFrontier {
    const runtime = this.options.runtime();
    const snapshot = runtime.snapshot();
    const diagnostics = runtime.settlementDiagnostics;
    return {
      worldId: this.options.worldId(),
      epoch: this.options.worldEpoch(),
      worldRevision: snapshot.worldRevision,
      commitSequence: snapshot.commitSequence,
      physicsTick: snapshot.physicsTick,
      fluidWorkSequence: diagnostics.fluidIssuedWorkCount,
      logicObservationSequence: diagnostics.logicIssuedObservationSequence,
    };
  }
}

class BoundControlFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}
