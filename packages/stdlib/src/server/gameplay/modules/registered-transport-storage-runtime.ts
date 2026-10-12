import type { ModuleInvocationValue } from '../../composition/contracts';
import type { ModStateAddress, RegisteredStatePort } from '../../composition/operation-contracts';
import { assertActorResourceExecution } from '../../composition/secondary-resource-authorization';
import type { AutonomyRuntime } from '../../simulation/autonomy-runtime';
import { transportStorageAccess } from '../transport-storage-access';
import { cloneItemStack } from '../item-instance';
import type { RegisteredTransportRuntime } from './registered-transport-runtime';
import {
  TRANSPORT_INTERACTION_CAPABILITY,
  TRANSPORT_RESOURCE,
  type FrozenTransportInteractionConfig,
} from './transport-interaction-config';
import {
  buildTransportStorageCandidateV1,
  readTransportStorageInputV1,
  type TransportStorageActorV1,
} from './transport-storage-model';
import {
  TRANSPORT_STORAGE_CAPABILITY,
  TRANSPORT_STORAGE_ACTOR_COMPONENT,
  TRANSPORT_STORAGE_SITE_COMPONENT,
  transportStorageActorAddress,
  transportStorageSiteAddress,
  type TransportStorageConfigV1,
} from './transport-storage-module';

type Options = ConstructorParameters<typeof RegisteredTransportRuntime>[0] &
  Readonly<{ simulation(): AutonomyRuntime }>;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** One prepared ECS participant publishes actor inventory and current carrier component together. */
export class RegisteredTransportStorageRuntime {
  readonly state: RegisteredStatePort;
  private readonly transport: FrozenTransportInteractionConfig;
  private readonly storage: TransportStorageConfigV1;
  private readonly receipts = new Map<number, Readonly<{ address: ModStateAddress; signature: string }>>();
  private sequence = 0;
  constructor(private readonly options: Options) {
    this.transport = options.composition.capability(TRANSPORT_INTERACTION_CAPABILITY);
    this.storage = options.composition.capability(TRANSPORT_STORAGE_CAPABILITY);
    for (const binding of this.storage.fuels) options.content.items.require(binding.itemId);
    const project = (address: ModStateAddress): ModuleInvocationValue => {
      if (address.target.kind !== 'entity' || address.partition !== undefined)
        throw new TypeError('Transport storage address is invalid.');
      if (address.componentId === TRANSPORT_STORAGE_ACTOR_COMPONENT)
        return this.actor(address.target.entityId) as ModuleInvocationValue;
      if (address.componentId === TRANSPORT_STORAGE_SITE_COMPONENT)
        return this.site(address.target.entityId) as ModuleInvocationValue;
      throw new TypeError('Transport storage component is invalid.');
    };
    const signature = (address: ModStateAddress, value = project(address)) =>
      JSON.stringify([options.revision(), address, value]);
    const observedCurrent = (observed: readonly Readonly<{ address: ModStateAddress; revision: number }>[]) => {
      const keys = new Set<string>();
      for (const entry of observed) {
        const key = JSON.stringify(entry.address),
          receipt = this.receipts.get(entry.revision);
        if (
          keys.has(key) ||
          !receipt ||
          !same(receipt.address, entry.address) ||
          receipt.signature !== signature(entry.address)
        )
          throw new Error('transport-storage-observation-stale');
        keys.add(key);
      }
    };
    this.state = Object.freeze({
      read: (address) => {
        const value = project(address);
        if (this.sequence >= Number.MAX_SAFE_INTEGER)
          throw new RangeError('Transport storage observation capacity exhausted.');
        const revision = ++this.sequence;
        this.receipts.set(revision, Object.freeze({ address, signature: signature(address, value) }));
        while (this.receipts.size > 256) this.receipts.delete(this.receipts.keys().next().value!);
        return Object.freeze({ value, revision });
      },
      commit: () => ({ ok: false, reason: 'Transport storage requires a prepared commit.' }),
      prepareCommit: (observed, writes, execution) => {
        const context = execution.context;
        if (
          context.kind !== 'actor' ||
          context.target.kind !== 'entity' ||
          execution.operationId !== this.storage.operationId ||
          execution.resource !== TRANSPORT_RESOURCE
        )
          throw new TypeError('Transport storage requires its registered actor operation.');
        const input = readTransportStorageInputV1(execution.effectiveInput);
        const actorId = context.originalActorId,
          targetId = context.target.entityId;
        if (input.actor.entityId !== actorId || input.transport.entityId !== targetId)
          throw new Error('transport-storage-target-invalid');
        const actorAddress = transportStorageActorAddress(actorId),
          siteAddress = transportStorageSiteAddress(targetId);
        if (
          observed.length !== 2 ||
          writes.length !== 1 ||
          !same(writes[0]!.address, actorAddress) ||
          !observed.some((entry) => same(entry.address, actorAddress)) ||
          !observed.some((entry) => same(entry.address, siteAddress))
        )
          throw new Error('transport-storage-observation-stale');
        observedCurrent(observed);
        const actor = this.actor(actorId);
        const candidate = buildTransportStorageCandidateV1(
          { definitions: this.transport.definitions, items: options.content.items, fuels: this.storage.fuels },
          actor,
          this.site(targetId),
          input,
        );
        if (!same(candidate, execution.candidateValue) || !same(candidate, writes[0]!.value))
          throw new Error('transport-storage-candidate-stale');
        const authorize = () => {
          assertActorResourceExecution(options.composition, execution.authorizer, context, TRANSPORT_RESOURCE);
          assertActorResourceExecution(options.composition, execution.authorizer, context, 'seedlands.inventory');
          options.assertCanChange();
          this.assertReach(actorId, targetId);
        };
        authorize();
        const entity = options.entities.resolveReference(actor.reference)!;
        const components = options.entities.actorComponentSnapshot(actorId);
        const changedTool = !same(
          components.inventory[components.equipment.selectedSlot],
          candidate.slots[components.equipment.selectedSlot],
        );
        const cancellation = changedTool
          ? options.simulation().prepareCancellation([actorId], 'slot-changed')
          : undefined;
        const participant = options.entities.prepareMutation({
          actors: [
            {
              reference: candidate.actor,
              health: entity.health!,
              components: {
                ...components,
                inventory: [...candidate.slots],
                inventoryRevision: candidate.inventoryRevision,
                ...(changedTool && components.player ? { player: { ...components.player, breakAction: null } } : {}),
              },
            },
          ],
          transports: [{ reference: candidate.transport, snapshot: candidate.component }],
        });
        let validated = false,
          used = false;
        const validate = () => {
          validated = false;
          if (used) throw new Error('Transport storage was already applied.');
          observedCurrent(observed);
          authorize();
          participant.validate();
          cancellation?.validate();
          validated = true;
        };
        return Object.freeze({
          ok: true,
          revision: options.revision() + 1,
          value: candidate as ModuleInvocationValue,
          validate,
          apply() {
            if (!validated || used) throw new Error('Transport storage has not been validated.');
            validate();
            used = true;
            participant.apply();
            cancellation?.apply();
            options.changed(true);
          },
        });
      },
    } satisfies RegisteredStatePort);
  }
  private actor(id: string): TransportStorageActorV1 & Readonly<{ position: readonly [number, number, number] }> {
    const entity = this.options.entities.get(id),
      reference = this.options.entities.createReference(id);
    if (entity?.type !== 'player' || !reference) throw new Error('transport-storage-actor-unavailable');
    const components = this.options.entities.actorComponentSnapshot(id);
    return Object.freeze({
      reference: Object.freeze({ ...reference }),
      position: Object.freeze([...entity.position]) as typeof entity.position,
      alive: entity.health! > 0 && components.lifecycle === 'alive',
      cursorBusy: !!components.inventoryCursor?.stack,
      inventoryRevision: components.inventoryRevision ?? 0,
      slots: Object.freeze(components.inventory.map((slot) => slot && Object.freeze(cloneItemStack(slot)))),
    });
  }
  private site(id: string) {
    const reference = this.options.entities.createReference(id),
      entity = reference && this.options.entities.resolveReference(reference);
    if (!reference || entity?.type !== 'transport') throw new Error('transport-storage-carrier-unavailable');
    return Object.freeze({
      reference: Object.freeze({ ...reference }),
      position: Object.freeze([...entity.position]) as typeof entity.position,
      component: this.options.entities.transportComponentSnapshot(id),
    });
  }
  private assertReach(actorId: string, targetId: string) {
    const target = this.options.entities.get(targetId);
    if (!target) throw new Error('transport-storage-carrier-unavailable');
    const status = transportStorageAccess(
      this.options.content,
      this.options.callbacks.getLoadedVoxel,
      this.actor(actorId).position,
      target.position,
    );
    if (status !== 'clear') throw new Error(status === 'chunk-unavailable' ? status : `transport-storage-${status}`);
  }
}
