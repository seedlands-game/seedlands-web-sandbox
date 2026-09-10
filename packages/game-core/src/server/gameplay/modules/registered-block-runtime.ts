import type { ModuleInvocationValue } from '../../composition/contracts';
import type { RegisteredOperationRequest, RegisteredOperationResult } from '../../composition/operation-contracts';
import type { WorldModuleBinding } from '../../commands/module-command';
import type { WorldCommitResult } from '../../game-server-types';
import type { GameplayModuleRuntime } from './gameplay-module-runtime';
import type { ModuleSystemAuthority } from './gameplay-module-schedule';
import { positionsInRange, voxelCenter } from '../gameplay-geometry';
import { createBlockOriginEnvironment, BlockOriginUnavailable } from './block-origin-environment';
import { createBlockStatePort } from './block-state-port';
import { prepareRegisteredBlockCommit, type BlockHostOptions } from './block-host-commit';
import {
  BLOCK_BEGIN_OPERATION,
  BLOCK_CANCEL_OPERATION,
  BLOCK_PLACE_OPERATION,
  BLOCK_FINISH_OPERATION,
  BLOCK_ADVANCE_OPERATION,
  BLOCK_SYSTEM,
} from './block-action-model';

type Options = BlockHostOptions &
  Readonly<{
    modules(): GameplayModuleRuntime;
    systemAuthority?: ModuleSystemAuthority;
  }>;
type Position = [number, number, number];

/** Owns only transient delivery receipts; ECS owns break progress and durable origin. */
export class RegisteredBlockRuntime {
  readonly state;
  readonly enabled: boolean;
  private readonly origins;
  private readonly projections: ReturnType<typeof createBlockStatePort>;
  private receipts: readonly WorldCommitResult[] = [];
  constructor(private readonly options: Options) {
    this.enabled = [
      BLOCK_BEGIN_OPERATION,
      BLOCK_CANCEL_OPERATION,
      BLOCK_PLACE_OPERATION,
      BLOCK_FINISH_OPERATION,
      BLOCK_ADVANCE_OPERATION,
    ].every((id) => options.composition.registrations.operations.some(({ definition }) => definition.id === id));
    this.origins = createBlockOriginEnvironment(options);
    this.projections = createBlockStatePort({
      ...options,
      items: options.content.items,
      prepare: (observed, execution) =>
        prepareRegisteredBlockCommit(
          options,
          this.projections,
          this.origins,
          (commit) => this.prepareReceipt(commit),
          observed,
          execution,
        ),
    });
    this.state = this.projections.state;
  }
  private prepareReceipt(commit: WorldCommitResult) {
    if (this.receipts.length >= 4096) throw new RangeError('Block commit receipt capacity exhausted.');
    const previous = this.receipts,
      next = [...previous, commit];
    let validated = false;
    return {
      validate: () => {
        validated = false;
        if (this.receipts !== previous) throw new Error('Block commit receipt frontier is stale.');
        validated = true;
      },
      apply: () => {
        if (!validated) throw new Error('Block receipt requires validation.');
        this.receipts = next;
      },
    };
  }
  takeCommits(): readonly WorldCommitResult[] {
    const commits = this.receipts;
    this.receipts = [];
    return commits;
  }
  acknowledge(value: ModuleInvocationValue): WorldCommitResult | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('commit' in value)) return undefined;
    const candidate = value.commit;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || !('worldRevision' in candidate))
      return undefined;
    const commit = this.receipts.find((entry) => entry.worldRevision === candidate.worldRevision);
    if (commit) this.receipts = this.receipts.filter((entry) => entry !== commit);
    return commit;
  }
  private actorRequest(id: string, request: RegisteredOperationRequest): RegisteredOperationResult {
    if (!this.enabled)
      return { ok: false, code: 'BLOCK_PROVIDER_MISSING', message: 'Block operations are not registered.' };
    return this.options.modules().invokeActor(this.options.actorAuthority, id, request);
  }
  beginBreak(id: string, position: Position) {
    const result = this.actorRequest(id, {
      operationId: BLOCK_BEGIN_OPERATION,
      target: { kind: 'voxel', position },
      input: { position },
    });
    if (!result.ok) return { success: false as const, reason: result.message };
    const value = result.value;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !('requiredSeconds' in value) ||
      typeof value.requiredSeconds !== 'number'
    )
      throw new TypeError('Block begin receipt is invalid.');
    const commit = this.acknowledge(value);
    return { success: true as const, requiredSeconds: value.requiredSeconds, ...(commit ? { commit } : {}) };
  }
  cancelBreak(id: string) {
    const result = this.actorRequest(id, {
      operationId: BLOCK_CANCEL_OPERATION,
      target: { kind: 'entity', entityId: id },
    });
    return result.ok ? { success: true as const } : { success: false as const, reason: result.message };
  }
  placeVoxel(id: string, position: Position) {
    const result = this.actorRequest(id, {
      operationId: BLOCK_PLACE_OPERATION,
      target: { kind: 'voxel', position },
      input: { position },
    });
    if (!result.ok) return { success: false as const, reason: result.message };
    const commit = this.acknowledge(result.value);
    if (!commit) throw new TypeError('Block place receipt is invalid.');
    return { success: true as const, commit };
  }
  private invoke(binding: WorldModuleBinding, id: string, request: RegisteredOperationRequest) {
    return this.options
      .modules()
      .invoke(binding.authorizer, { principalId: binding.principalId, originalActorId: id }, request);
  }
  private cancelPending(id: string) {
    const authority = this.options.systemAuthority;
    const owner = this.options.composition.registrations.operations.find(
      ({ definition }) => definition.id === BLOCK_ADVANCE_OPERATION,
    );
    if (!authority || !owner) throw new Error('Block system authority is unavailable.');
    const execution = this.options.modules().bindSystem(authority.authorizer, {
      kind: 'system',
      moduleId: owner.moduleId,
      principalId: authority.principalId,
      systemId: BLOCK_SYSTEM,
    });
    try {
      const result = execution.invoke({
        operationId: BLOCK_ADVANCE_OPERATION,
        target: { kind: 'world' },
        input: { seconds: 0, cancelActorIds: [id] },
      });
      if (!result.ok) throw new Error(`Block cancellation failed: ${result.code}: ${result.message}`);
    } finally {
      execution.dispose();
    }
  }
  drain() {
    if (!this.enabled) return;
    for (const id of this.projections.actorIds()) {
      const actor = this.options.entities.playerStateAccess(id),
        action = actor.breakAction;
      if (!action || action.elapsedSeconds + Number.EPSILON < action.requiredSeconds) continue;
      const voxel = this.options.getVoxel(action.position);
      if (voxel === undefined) continue;
      const entity = this.options.entities.get(id)!;
      let binding: ReturnType<typeof this.origins.resolve> | undefined;
      if (
        action.origin &&
        actor.lifecycle === 'alive' &&
        voxel === action.voxel &&
        positionsInRange(entity.position, voxelCenter(action.position), 5)
      ) {
        try {
          binding = this.origins.resolve(action.origin, action.position);
        } catch (error) {
          if (!(error instanceof BlockOriginUnavailable)) throw error;
        }
      }
      if (binding) {
        const result = this.invoke(binding, id, {
          operationId: BLOCK_FINISH_OPERATION,
          target: { kind: 'voxel', position: action.position },
          input: { position: action.position },
        });
        if (result.ok) continue;
        if (!['RULE_REJECTED', 'WORLD_PERMISSION_DENIED', 'MODULE_PERMISSION_DENIED'].includes(result.code))
          throw new Error(`Block completion failed: ${result.code}: ${result.message}`);
      }
      this.cancelPending(id);
    }
  }
}
