import type { ModuleInvocationValue, WorldComposition } from '../../composition/contracts';
import type {
  ModStateAddress,
  ObservedModState,
  PreparedRegisteredCommit,
  RegisteredCommitContext,
  RegisteredStatePort,
} from '../../composition/operation-contracts';
import type { ItemDefinitionRegistry } from '../item-registry';
import {
  STRUCTURE_ACTOR_COMPONENT,
  STRUCTURE_VOXEL_COMPONENT,
  structureActorAddress,
  structureVoxelAddress,
  validateStructureActorProjectionV1,
  validateStructureVoxelProjectionV1,
  type StructureActorProjectionV1,
  type StructureVoxelProjectionV1,
} from './structure-actions-module';
import type { StructurePositionV1 } from './structure-definition';

const RECEIPT_LIMIT = 256;
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export type StructureStatePortOptions = Readonly<{
  composition: WorldComposition;
  items: ItemDefinitionRegistry;
  actor(actorId: string): StructureActorProjectionV1 | null;
  readCell(position: StructurePositionV1): Readonly<{ voxel: number; fluid: number }> | null;
  gameplayRevision(): number;
  worldRevision(): number;
  prepare(
    observed: readonly ObservedModState[],
    execution: RegisteredCommitContext,
    projections: StructureStateProjectionsV1,
  ): PreparedRegisteredCommit;
}>;

export type StructureStateProjectionsV1 = Readonly<{
  actor(actorId: string): StructureActorProjectionV1;
  voxel(position: StructurePositionV1): StructureVoxelProjectionV1;
  validateObserved(observed: readonly ObservedModState[]): void;
  state: RegisteredStatePort;
}>;

export function createStructureStatePort(options: StructureStatePortOptions): StructureStateProjectionsV1 {
  let sequence = 0;
  const receipts = new Map<number, Readonly<{ address: ModStateAddress; signature: string }>>();
  const actor = (actorId: string) => {
    const value = options.actor(actorId);
    if (!value) throw new Error('structure-actor-unavailable');
    return validateStructureActorProjectionV1(value, options.items);
  };
  const voxel = (position: StructurePositionV1) => {
    const cell = options.readCell(position);
    if (!cell) throw new Error('chunk-unavailable');
    return validateStructureVoxelProjectionV1({ version: 1, position, voxel: cell.voxel, fluid: cell.fluid });
  };
  const project = (address: ModStateAddress): ModuleInvocationValue => {
    if (address.partition !== undefined) throw new TypeError('Structure state is not partitioned.');
    if (address.componentId === STRUCTURE_ACTOR_COMPONENT && address.target.kind === 'entity')
      return actor(address.target.entityId) as ModuleInvocationValue;
    if (address.componentId === STRUCTURE_VOXEL_COMPONENT && address.target.kind === 'voxel')
      return voxel(address.target.position) as ModuleInvocationValue;
    throw new TypeError('Unsupported Structure projection address.');
  };
  const signature = (address: ModStateAddress, value = project(address)) =>
    JSON.stringify([options.gameplayRevision(), options.worldRevision(), address, value]);
  const validateObserved = (observed: readonly ObservedModState[]) => {
    const seen = new Set<string>();
    for (const entry of observed) {
      const key = JSON.stringify(entry.address);
      const receipt = receipts.get(entry.revision);
      if (
        seen.has(key) ||
        !receipt ||
        !same(receipt.address, entry.address) ||
        receipt.signature !== signature(entry.address)
      )
        throw new Error('Structure projection observation is stale.');
      seen.add(key);
    }
  };
  const state: RegisteredStatePort = Object.freeze({
    read(address) {
      const value = project(address);
      if (sequence >= Number.MAX_SAFE_INTEGER) throw new RangeError('Structure observation capacity exhausted.');
      const revision = ++sequence;
      receipts.set(revision, Object.freeze({ address, signature: signature(address, value) }));
      while (receipts.size > RECEIPT_LIMIT) receipts.delete(receipts.keys().next().value!);
      return Object.freeze({ revision, value });
    },
    commit: () => Object.freeze({ ok: false as const, reason: 'Structures require a prepared commit.' }),
    prepareCommit(observed, writes, execution) {
      if (writes.length)
        return Object.freeze({
          ok: false as const,
          code: 'STRUCTURE_WRITE_FORBIDDEN',
          reason: 'Structure operations return plans, not direct state writes.',
        });
      validateObserved(observed);
      const prepared = options.prepare(observed, execution, projections);
      if (!prepared.ok) return prepared;
      return Object.freeze({
        ...prepared,
        validate() {
          validateObserved(observed);
          prepared.validate();
        },
      });
    },
  });
  const projections: StructureStateProjectionsV1 = Object.freeze({ actor, voxel, validateObserved, state });
  return projections;
}

export const structureObservationAddresses = Object.freeze({
  actor: structureActorAddress,
  voxel: structureVoxelAddress,
});
