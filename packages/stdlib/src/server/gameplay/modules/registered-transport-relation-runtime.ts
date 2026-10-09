import type { RegisteredStatePort, ModStateAddress } from '../../composition/operation-contracts';
import type { ModuleInvocationValue } from '../../composition/contracts';
import { assertActorResourceExecution } from '../../composition/secondary-resource-authorization';
import type { RegisteredTransportRuntime } from './registered-transport-runtime';
import {
  TRANSPORT_INTERACTION_CAPABILITY,
  TRANSPORT_RESOURCE,
  type FrozenTransportInteractionConfig,
} from './transport-interaction-config';
import {
  TRANSPORT_RELATION_CAPABILITY,
  TRANSPORT_RELATION_COMPONENT,
  TRANSPORT_RELATION_SITE_COMPONENT,
  transportRelationAddress,
  transportRelationSiteAddress,
  readTransportRelationInput,
  buildTransportRelationInteraction,
  type TransportRelationConfig,
  type TransportRelationActor,
} from './transport-relation-interaction';
import { projectTransportActor } from '../transport-actor-projection';
import { projectTransportStates } from '../transport-projection';
import { projectTransportRelationSite } from '../transport-relation-geometry';
import { playerInteractionOrigin, positionsInRange } from '../gameplay-geometry';
import { traceVoxelRay } from '../voxel-ray';
import { loadedTransportBodyRejection } from '../transport-deployment-geometry';
import { bodyConfigFor } from '../../../physics/body-registry';

type Options = ConstructorParameters<typeof RegisteredTransportRuntime>[0];
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** The registered module proposes a relation; its host publishes both canonical entities atomically. */
export class RegisteredTransportRelationRuntime {
  readonly state: RegisteredStatePort;
  private readonly config: FrozenTransportInteractionConfig;
  private readonly relation: TransportRelationConfig;
  private readonly receipts = new Map<number, Readonly<{ address: ModStateAddress; signature: string }>>();
  private sequence = 0;
  constructor(private readonly options: Options) {
    this.config = options.composition.capability(TRANSPORT_INTERACTION_CAPABILITY);
    this.relation = options.composition.capability(TRANSPORT_RELATION_CAPABILITY);
    const project = (address: ModStateAddress): ModuleInvocationValue => {
      if (
        ![TRANSPORT_RELATION_COMPONENT, TRANSPORT_RELATION_SITE_COMPONENT].includes(address.componentId) ||
        address.target.kind !== 'entity' ||
        address.partition !== undefined
      )
        throw new TypeError('Transport relation address is invalid.');
      return (
        address.componentId === TRANSPORT_RELATION_COMPONENT
          ? this.actor(address.target.entityId)
          : this.site(address.target.entityId)
      ) as ModuleInvocationValue;
    };
    const signature = (address: ModStateAddress, value = project(address)) =>
      JSON.stringify([options.revision(), address, value]);
    const observedCurrent = (observed: readonly Readonly<{ address: ModStateAddress; revision: number }>[]) => {
      const keys = new Set<string>();
      for (const entry of observed) {
        const receipt = this.receipts.get(entry.revision);
        const key = JSON.stringify(entry.address);
        if (
          keys.has(key) ||
          !receipt ||
          !same(receipt.address, entry.address) ||
          receipt.signature !== signature(entry.address)
        )
          throw new Error('transport-observation-stale');
        keys.add(key);
      }
    };
    this.state = Object.freeze({
      read: (address) => {
        const value = project(address);
        if (this.sequence >= Number.MAX_SAFE_INTEGER)
          throw new RangeError('Transport relation observation capacity exhausted.');
        const revision = ++this.sequence;
        this.receipts.set(revision, Object.freeze({ address, signature: signature(address, value) }));
        while (this.receipts.size > 256) this.receipts.delete(this.receipts.keys().next().value!);
        return Object.freeze({ value, revision });
      },
      commit: () => ({ ok: false, reason: 'Transport relation requires a prepared commit.' }),
      prepareCommit: (observed, writes, execution) => {
        const context = execution.context;
        if (
          context.kind !== 'actor' ||
          context.target.kind !== 'entity' ||
          execution.operationId !== this.relation.operationId ||
          execution.resource !== TRANSPORT_RESOURCE
        )
          throw new TypeError('Transport relation requires its registered actor operation.');
        const input = readTransportRelationInput(execution.effectiveInput);
        const actorId = context.originalActorId;
        const actor = this.actor(actorId);
        const target = input.target ?? actor.mounted;
        if (!target) throw new Error('not-mounted');
        if (context.target.entityId !== (input.kind === 'mount' ? target.entityId : actorId))
          throw new Error('transport-target-invalid');
        const address = transportRelationAddress(actorId);
        const siteAddress = transportRelationSiteAddress(target.entityId);
        if (
          observed.length !== 2 ||
          writes.length !== 1 ||
          !same(writes[0]!.address, address) ||
          !observed.some((entry) => same(entry.address, address)) ||
          !observed.some((entry) => same(entry.address, siteAddress))
        )
          throw new Error('transport-observation-stale');
        observedCurrent(observed);
        const candidate = buildTransportRelationInteraction(actor, this.site(target.entityId), input);
        if (!same(candidate, execution.candidateValue) || !same(candidate, writes[0]!.value))
          throw new Error('transport-candidate-stale');
        const authorize = () => {
          assertActorResourceExecution(options.composition, execution.authorizer, context, TRANSPORT_RESOURCE);
          options.assertCanChange();
          const rejected = loadedTransportBodyRejection(
            { ...options, config: this.config },
            bodyConfigFor('player').localAabb,
            candidate.position,
            [actorId, target.entityId],
          );
          if (rejected) throw new Error(rejected);
          if (input.kind === 'mount') this.assertReach(actorId, target.entityId);
        };
        authorize();
        const entity = options.entities.resolveReference(actor.reference)!;
        const transport = options.entities.transportComponentSnapshot(target.entityId);
        const rider = candidate.transport.rider;
        const participant = options.entities.prepareMutation({
          actors: [
            {
              reference: actor.reference,
              health: entity.health!,
              components: options.entities.actorComponentSnapshot(actorId),
              position: candidate.position,
              physicsVelocity: [0, 0, 0],
            },
          ],
          transports: [
            {
              reference: candidate.transport.reference,
              snapshot: {
                ...transport,
                revision: transport.revision + 1,
                rider: rider ? { entityId: rider.entityId, lifetime: rider.lifetime } : null,
              },
            },
          ],
        });
        let validated = false,
          used = false;
        const validate = () => {
          validated = false;
          if (used) throw new Error('Transport relation was already applied.');
          observedCurrent(observed);
          authorize();
          participant.validate();
          validated = true;
        };
        return Object.freeze({
          ok: true,
          revision: options.revision() + 1,
          value: candidate as ModuleInvocationValue,
          validate,
          apply() {
            if (!validated || used) throw new Error('Transport relation has not been validated.');
            validate();
            used = true;
            participant.apply();
            options.changed(false);
          },
        });
      },
    } satisfies RegisteredStatePort);
  }
  private actor(id: string): TransportRelationActor {
    return Object.freeze({
      ...projectTransportActor(this.options.entities, id),
      mounted:
        projectTransportStates(this.options.entities).find((state) => state.rider?.entityId === id)?.reference ?? null,
    });
  }
  private site(id: string) {
    return projectTransportRelationSite({ ...this.options, config: this.config }, id);
  }
  private assertReach(actorId: string, targetId: string) {
    const origin = playerInteractionOrigin(this.actor(actorId).position);
    const target = this.options.entities.get(targetId);
    if (!target || !positionsInRange(origin, target.position, 5)) throw new Error('transport-target-out-of-range');
    const status = traceVoxelRay(
      target.position,
      origin,
      (x, y, z) => this.options.callbacks.getLoadedVoxel?.([x, y, z]),
      (voxel) => this.options.content.voxelSemantics.get(voxel)?.solid ?? true,
    );
    if (status !== 'clear')
      throw new Error(status === 'unavailable' ? 'chunk-unavailable' : 'transport-target-blocked');
  }
}
