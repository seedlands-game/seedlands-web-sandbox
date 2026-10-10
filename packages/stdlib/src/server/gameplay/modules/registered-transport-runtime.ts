import type { WorldComposition, ModuleInvocationValue } from '../../composition/contracts';
import type { RegisteredStatePort, ModStateAddress } from '../../composition/operation-contracts';
import { assertActorResourceExecution } from '../../composition/secondary-resource-authorization';
import type { EntityStore } from '../entity-store';
import type { GameplayContent } from '../gameplay-content';
import type { GameplayCallbacks } from '../gameplay-runtime-contracts';
import { projectTransportDeploymentSite } from '../transport-deployment-geometry';
import { playerInteractionOrigin, positionsInRange, voxelAdjacentFacePoint, voxelCenter } from '../gameplay-geometry';
import { traceVoxelRay } from '../voxel-ray';
import {
  TRANSPORT_RESOURCE,
  TRANSPORT_DEPLOYMENT_COMPONENT,
  TRANSPORT_INTERACTION_CAPABILITY,
  type FrozenTransportInteractionConfig,
} from './transport-interaction-config';
import { transportActorAddress, transportSiteAddress } from './transport-interaction-module';
import { buildTransportDeploymentCandidate, type TransportDeploymentActorV1 } from './transport-deployment-model';
import { projectTransportActor } from '../transport-actor-projection';

type Options = Readonly<{
  composition: WorldComposition;
  entities: EntityStore;
  content: GameplayContent;
  callbacks: GameplayCallbacks;
  revision(): number;
  assertCanChange(): void;
  changed(inventory?: boolean): void;
}>;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** The registered operation sees projections; only this host publishes an EntityStore participant. */
export class RegisteredTransportRuntime {
  readonly state: RegisteredStatePort;
  readonly config: FrozenTransportInteractionConfig;
  private receiptSequence = 0;
  private readonly receipts = new Map<number, Readonly<{ address: ModStateAddress; signature: string }>>();
  constructor(private readonly options: Options) {
    this.config = options.composition.capability(TRANSPORT_INTERACTION_CAPABILITY);
    const project = (address: ModStateAddress): ModuleInvocationValue => {
      if (address.componentId !== TRANSPORT_DEPLOYMENT_COMPONENT || address.partition !== undefined)
        throw new TypeError('Transport deployment address is invalid.');
      return (
        address.target.kind === 'entity'
          ? this.actor(address.target.entityId)
          : address.target.kind === 'voxel'
            ? this.site(address.target.position)
            : (() => {
                throw new TypeError('Transport deployment target is invalid.');
              })()
      ) as ModuleInvocationValue;
    };
    const signature = (address: ModStateAddress, value = project(address)) =>
      JSON.stringify([options.revision(), address, value]);
    const validateObserved = (observed: readonly Readonly<{ address: ModStateAddress; revision: number }>[]) => {
      const seen = new Set<string>();
      for (const entry of observed) {
        const receipt = this.receipts.get(entry.revision);
        const key = JSON.stringify(entry.address);
        if (
          seen.has(key) ||
          !receipt ||
          !same(receipt.address, entry.address) ||
          receipt.signature !== signature(entry.address)
        )
          throw new Error('transport-observation-stale');
        seen.add(key);
      }
    };
    this.state = Object.freeze({
      read: (address) => {
        const value = project(address);
        if (this.receiptSequence >= Number.MAX_SAFE_INTEGER)
          throw new RangeError('Transport observation capacity exhausted.');
        const revision = ++this.receiptSequence;
        this.receipts.set(revision, Object.freeze({ address, signature: signature(address, value) }));
        while (this.receipts.size > 256) this.receipts.delete(this.receipts.keys().next().value!);
        return Object.freeze({ revision, value });
      },
      commit: () => ({ ok: false, reason: 'Transport deployment requires a prepared commit.' }),
      prepareCommit: (observed, writes, execution) => {
        const context = execution.context;
        if (
          context.kind !== 'actor' ||
          context.target.kind !== 'voxel' ||
          execution.operationId !== this.config.operationId ||
          execution.resource !== TRANSPORT_RESOURCE
        )
          throw new TypeError('Transport deployment requires its registered actor operation.');
        const actorId = context.originalActorId;
        const actorAddress = transportActorAddress(actorId);
        const siteAddress = transportSiteAddress(context.target.position);
        if (
          observed.length !== 2 ||
          writes.length !== 1 ||
          !same(writes[0]!.address, actorAddress) ||
          !observed.some((entry) => same(entry.address, actorAddress)) ||
          !observed.some((entry) => same(entry.address, siteAddress))
        )
          throw new Error('transport-observation-stale');
        validateObserved(observed);
        const actor = this.actor(actorId);
        const candidate = buildTransportDeploymentCandidate(
          this.config,
          actor,
          this.site(context.target.position),
          execution.effectiveInput,
        );
        if (!same(candidate, execution.candidateValue) || !same(writes[0]!.value, candidate))
          throw new Error('transport-candidate-stale');
        const assertAuthorized = () => {
          assertActorResourceExecution(options.composition, execution.authorizer, context, TRANSPORT_RESOURCE);
          assertActorResourceExecution(options.composition, execution.authorizer, context, 'seedlands.inventory');
          options.assertCanChange();
          this.assertTarget(actorId, candidate.target);
        };
        assertAuthorized();
        const entity = options.entities.resolveReference(actor.reference)!;
        const components = options.entities.actorComponentSnapshot(actorId);
        const inventory = [...components.inventory];
        if (actor.mode === 'survival') {
          const stack = inventory[actor.selectedSlot];
          if (!stack || stack.itemId !== candidate.itemId || stack.count < 1)
            throw new Error('transport-selection-stale');
          inventory[actor.selectedSlot] = stack.count === 1 ? null : { ...stack, count: stack.count - 1 };
        }
        const definition = this.config.definitions.require(candidate.deployment.definitionId);
        const participant = options.entities.prepareMutation({
          actors: [{ reference: actor.reference, health: entity.health!, components: { ...components, inventory } }],
          transportSpawns: [
            {
              position: candidate.deployment.position,
              physicsVelocity: [0, 0, 0],
              transport: {
                definitionId: definition.id,
                yaw: candidate.deployment.yaw,
                routeCursor: candidate.deployment.routeCursor,
                rider: null,
                fuel: definition.fuelCapacity === null ? null : 0,
                inventory: Array.from({ length: definition.inventoryCapacity ?? 0 }, () => null),
              },
            },
          ],
        });
        let used = false,
          validated = false;
        const validate = () => {
          validated = false;
          if (used) throw new Error('Transport deployment was already applied.');
          validateObserved(observed);
          assertAuthorized();
          participant.validate();
          validated = true;
        };
        return Object.freeze({
          ok: true,
          revision: options.revision() + 1,
          value: candidate as ModuleInvocationValue,
          validate,
          apply() {
            if (!validated || used) throw new Error('Transport deployment has not been validated.');
            validate();
            used = true;
            participant.apply();
            options.changed(actor.mode === 'survival');
          },
        });
      },
    } satisfies RegisteredStatePort);
  }

  private actor(id: string): TransportDeploymentActorV1 {
    return projectTransportActor(this.options.entities, id);
  }

  private site(position: readonly [number, number, number]) {
    return projectTransportDeploymentSite({ ...this.options, config: this.config }, position);
  }

  private assertTarget(
    actorId: string,
    target: Readonly<{ hit: readonly [number, number, number]; adjacent: readonly [number, number, number] }>,
  ) {
    const actor = this.actor(actorId);
    const origin = playerInteractionOrigin(actor.position);
    if (
      !positionsInRange(origin, voxelCenter([...target.hit]), 5) ||
      !positionsInRange(origin, voxelCenter([...target.adjacent]), 5)
    )
      throw new Error('transport-target-out-of-range');
    const get = (x: number, y: number, z: number) => this.options.callbacks.getLoadedVoxel?.([x, y, z]);
    const solid = (voxel: number) => this.options.content.voxelSemantics.get(voxel)?.solid ?? true;
    const hit = get(...target.hit),
      adjacent = get(...target.adjacent);
    if (hit === undefined || adjacent === undefined) throw new Error('chunk-unavailable');
    if (!this.options.content.voxelSemantics.get(hit)?.targetable) throw new Error('transport-target-invalid');
    for (const end of [voxelAdjacentFacePoint(target.hit, target.adjacent), voxelCenter([...target.adjacent])]) {
      const status = traceVoxelRay(end, origin, get, solid);
      if (status !== 'clear')
        throw new Error(status === 'unavailable' ? 'chunk-unavailable' : 'transport-target-blocked');
    }
  }
}
