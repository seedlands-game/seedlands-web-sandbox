import { createContentItemIdentityResolver } from '../../composition/content-item-identity';
import type { WorldComposition } from '../../composition/contracts';
import type { WorldCommitResult } from '../../game-server-types';
import type { ExpectedWorldVoxelEdit, PreparedWorldEditBatch } from '../../world-transaction-commit';
import type { VoxelGeometryRegistryV1 } from '../../../world/voxel-geometry';
import type { EntityStore } from '../entity-store';
import { gameplayContentFromComposition } from './content-capabilities';
import {
  STRUCTURE_ACTIONS_CAPABILITY,
  type StructureActionPolicyV1,
  type StructureActorProjectionV1,
} from './structure-actions-module';
import { STRUCTURE_DEFINITIONS_CAPABILITY, type StructureDefinitionRegistryV1 } from './structure-definition-module';
import {
  prepareStructureHostCommit,
  type PreparedStructureDependentRemovalV1,
  type PreparedStructureParticipant,
} from './structure-host-commit';
import { createStructureStatePort } from './structure-state-port';
import type { StructurePositionV1 } from './structure-definition';
import { VOXEL_GEOMETRY_CAPABILITY } from './voxel-geometry-module';

const RECEIPT_LIMIT = 4_096;

export type RegisteredStructureRuntimeOptions = Readonly<{
  composition: WorldComposition;
  entities: EntityStore;
  readCell(position: StructurePositionV1): Readonly<{ voxel: number; fluid: number }> | null;
  prepareVoxelEdits(actorId: string, edits: readonly ExpectedWorldVoxelEdit[]): PreparedWorldEditBatch;
  gameplayRevision(): number;
  worldRevision(): number;
  prepareGameplayChange(
    inventoryChanged: boolean,
    precedingWorldCommit: WorldCommitResult,
  ): PreparedStructureParticipant & Readonly<{ revision: number }>;
  maxReceipts?: number;
  prepareCancellation(actorId: string): PreparedStructureParticipant;
  prepareDependentRemoval(position: StructurePositionV1): PreparedStructureDependentRemovalV1;
}>;

/** Registered Structure owner. Durable state remains the canonical voxel footprint. */
export class RegisteredStructureRuntime {
  readonly state;
  readonly registry: StructureDefinitionRegistryV1;
  private receipts: readonly WorldCommitResult[] = [];
  private readonly maxReceipts: number;

  constructor(private readonly options: RegisteredStructureRuntimeOptions) {
    this.maxReceipts = options.maxReceipts ?? RECEIPT_LIMIT;
    if (!Number.isSafeInteger(this.maxReceipts) || this.maxReceipts < 1 || this.maxReceipts > RECEIPT_LIMIT)
      throw new RangeError('Structure commit receipt capacity is invalid.');
    const content = gameplayContentFromComposition(options.composition);
    this.registry = options.composition.capability(STRUCTURE_DEFINITIONS_CAPABILITY);
    const geometry = options.composition.capability<VoxelGeometryRegistryV1>(VOXEL_GEOMETRY_CAPABILITY);
    const policy =
      options.composition.capability<Readonly<{ policy: StructureActionPolicyV1 }>>(
        STRUCTURE_ACTIONS_CAPABILITY,
      ).policy;
    const identity = createContentItemIdentityResolver(options.composition.definitionMap);
    const projections = createStructureStatePort({
      composition: options.composition,
      items: content.items,
      actor: (actorId) => this.actor(actorId),
      readCell: options.readCell,
      gameplayRevision: options.gameplayRevision,
      worldRevision: options.worldRevision,
      prepare: (observed, execution) =>
        prepareStructureHostCommit(
          {
            composition: options.composition,
            registry: this.registry,
            identity,
            semantics: content.voxelSemantics,
            geometry,
            policy,
            entities: options.entities,
            readCell: options.readCell,
            prepareVoxelEdits: options.prepareVoxelEdits,
            prepareCancellation: options.prepareCancellation,
            prepareDependentRemoval: options.prepareDependentRemoval,
            prepareReceipt: (commit) => this.prepareReceipt(commit),
            prepareGameplayChange: options.prepareGameplayChange,
          },
          projections,
          observed,
          execution,
        ),
    });
    this.state = projections.state;
  }

  takeCommits(): readonly WorldCommitResult[] {
    const commits = this.receipts;
    this.receipts = [];
    return commits;
  }

  acknowledge(worldRevision: number): WorldCommitResult | undefined {
    const commit = this.receipts.find((entry) => entry.worldRevision === worldRevision);
    if (commit) this.receipts = this.receipts.filter((entry) => entry !== commit);
    return commit;
  }

  private actor(actorId: string): StructureActorProjectionV1 | null {
    const entity = this.options.entities.get(actorId);
    if (entity?.type !== 'player') return null;
    const actor = this.options.entities.playerStateAccess(actorId);
    return Object.freeze({
      version: 1 as const,
      reference: this.options.entities.createReference(actorId)!,
      position: Object.freeze([...entity.position]) as readonly [number, number, number],
      lifecycle: actor.lifecycle,
      mode: Object.freeze({ value: actor.mode, revision: actor.modeRevision }),
      inventoryRevision: actor.inventoryRevision,
      slots: Object.freeze(actor.inventory.snapshot()),
      selectedSlot: actor.selectedSlot,
      creativeCatalog: Object.freeze({
        revision: actor.creativeCatalog.revision,
        selectedSlot: actor.creativeCatalog.selectedSlot,
        hotbar: Object.freeze([...actor.creativeCatalog.hotbar]),
      }),
    });
  }

  private prepareReceipt(commit: WorldCommitResult): PreparedStructureParticipant {
    if (this.receipts.length >= this.maxReceipts) throw new RangeError('Structure commit receipt capacity exhausted.');
    const previous = this.receipts;
    const next = Object.freeze([...previous, commit]);
    let validated = false;
    return Object.freeze({
      validate: () => {
        validated = false;
        if (this.receipts !== previous) throw new Error('Structure commit receipt frontier is stale.');
        validated = true;
      },
      apply: () => {
        if (!validated) throw new Error('Structure receipt requires validation.');
        this.receipts = next;
      },
    });
  }
}
