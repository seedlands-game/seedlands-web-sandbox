import type { KernelStateOwner } from '@seedlands/kernel/execution';
import type { WorldComposition, ModuleInvocationValue } from '../../composition/contracts';
import type { RegisteredStatePort } from '../../composition/operation-contracts';
import type { EntityStore } from '../entity-store';
import type { PreparedEntityMutationInput } from '../prepared-entity-mutation-types';
import type { GameplayCallbacks } from '../gameplay-runtime-contracts';
import type { AuthorityPhysicsFrame, AuthorityPhysicsUpdate } from '../../authority/authority-physics-frame';
import {
  TRANSPORT_INTERACTION_CAPABILITY,
  TRANSPORT_RESOURCE,
  type FrozenTransportInteractionConfig,
} from './transport-interaction-config';
import {
  TRANSPORT_MOTION_CAPABILITY,
  transportMotionAddress,
  buildTransportMotionPublication,
  type TransportMotionConfig,
  type TransportMotionProjection,
} from './transport-motion-module';
import { deriveMountedSeatConstraintV1 } from './transport-motion-state';
import { projectSurfaceMotion } from '../transport-motion-geometry';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type Options = Readonly<{
  composition: WorldComposition;
  entities: EntityStore;
  callbacks: GameplayCallbacks;
  kernelState: KernelStateOwner;
}>;

/** One short-lived physics frame participates in the existing ECS frontier; no transport state is retained here. */
export class RegisteredTransportMotionRuntime {
  readonly state: RegisteredStatePort;
  readonly config: TransportMotionConfig;
  private readonly transport: FrozenTransportInteractionConfig;
  private frame: AuthorityPhysicsFrame | null = null;
  private frameId = 0;
  private baseline = '';
  private published: readonly AuthorityPhysicsUpdate[] | null = null;
  constructor(private readonly options: Options) {
    this.config = options.composition.capability(TRANSPORT_MOTION_CAPABILITY);
    this.transport = options.composition.capability(TRANSPORT_INTERACTION_CAPABILITY);
    const address = transportMotionAddress();
    const assertAddress = (candidate: typeof address) => {
      if (!same(candidate, address)) throw new TypeError('Transport motion frame address is invalid.');
    };
    this.state = Object.freeze<RegisteredStatePort>({
      read: (requested) => {
        assertAddress(requested as typeof address);
        this.assertFresh();
        return { revision: this.frameId, value: this.project() as ModuleInvocationValue };
      },
      commit: () => ({ ok: false, reason: 'Transport motion requires the physics prepared frontier.' }),
      prepareCommit: (observed, writes, execution) => {
        const frame = this.requireFrame();
        this.assertFresh();
        if (
          execution.context.kind !== 'system' ||
          execution.context.target.kind !== 'world' ||
          execution.context.systemId !== this.config.systemId ||
          execution.context.provenance.moduleId !== this.config.moduleId ||
          execution.operationId !== this.config.operationId ||
          execution.resource !== TRANSPORT_RESOURCE ||
          execution.effectiveInput !== undefined ||
          observed.length !== 1 ||
          writes.length !== 1 ||
          observed[0]!.revision !== this.frameId ||
          !same(observed[0]!.address, address) ||
          !same(writes[0]!.address, address)
        )
          throw new Error('transport-motion-observation-stale');
        const candidate = buildTransportMotionPublication(this.transport, this.project());
        if (!same(candidate, execution.candidateValue) || !same(candidate, writes[0]!.value))
          throw new Error('transport-motion-candidate-stale');
        const signature = this.signature();
        const corrections = this.corrections(candidate, frame);
        const corrected = new Map(corrections.map((update) => [update.id, update]));
        const replacements = new Map(
          candidate.entries.flatMap(({ state }) => {
            const current = options.entities.transportComponentSnapshot(state.reference.entityId);
            const next = { ...current, yaw: state.pose.yaw, fuel: state.fuel, routeCursor: state.routeCursor };
            return same(current, next)
              ? []
              : [
                  [
                    state.reference.entityId,
                    {
                      reference: state.reference,
                      snapshot: { ...next, revision: current.revision + 1 },
                      position: state.pose.position,
                      physicsVelocity: state.velocity,
                    },
                  ] as const,
                ];
          }),
        );
        const segments: PreparedEntityMutationInput[] = [];
        for (let offset = 0; offset < frame.updates.length; offset += 128) {
          const chunk = frame.updates.slice(offset, offset + 128);
          segments.push({
            dynamics: chunk
              .filter(({ id }) => !replacements.has(id))
              .map((entry) => {
                const update = corrected.get(entry.id) ?? entry;
                const reference = options.entities.createReference(entry.id);
                if (!reference) throw new Error('transport-motion-entity-stale');
                return { reference, position: update.update.position, physicsVelocity: update.update.physicsVelocity };
              }),
            transports: chunk.flatMap(({ id }) => (replacements.has(id) ? [replacements.get(id)!] : [])),
          });
        }
        const participant =
          segments.length === 1
            ? options.entities.prepareMutation(segments[0]!)
            : options.entities.prepareMutationSeries(segments);
        const assertCurrent = () => {
          if (
            this.frame !== frame ||
            this.signature() !== signature ||
            !same(buildTransportMotionPublication(this.transport, this.project()), candidate)
          )
            throw new Error('transport-motion-frame-stale');
          options.kernelState.assertGameplayBatchCapacity(options.kernelState.epoch, frame.updates.length);
        };
        assertCurrent();
        let validated = false,
          applied = false;
        return {
          ok: true,
          revision: options.kernelState.gameplayRevision + frame.updates.length,
          value: candidate as ModuleInvocationValue,
          validate: () => {
            assertCurrent();
            participant.validate();
            validated = true;
          },
          apply: () => {
            if (!validated || applied) throw new Error('Transport motion prepared frame is not applicable.');
            assertCurrent();
            participant.validate();
            participant.apply();
            options.kernelState.commitGameplayBatch(options.kernelState.epoch, frame.updates.length);
            this.published = corrections;
            applied = true;
          },
        };
      },
    });
  }

  begin(frame: AuthorityPhysicsFrame): boolean {
    if (this.frame) throw new Error('Transport physics frames cannot nest.');
    if (
      !Number.isSafeInteger(frame.physicsTick) ||
      frame.physicsTick < 1 ||
      !Number.isFinite(frame.seconds) ||
      frame.seconds <= 0 ||
      frame.seconds > 1 ||
      !frame.updates.length ||
      frame.updates.length > 128 * 192 ||
      new Set(frame.updates.map(({ id }) => id)).size !== frame.updates.length
    )
      throw new RangeError('Transport physics frame is invalid.');
    if (this.frameId >= Number.MAX_SAFE_INTEGER)
      throw new RangeError('Transport physics observation capacity exhausted.');
    this.frameId++;
    this.frame = frame;
    this.published = null;
    this.baseline = this.signature();
    return this.project().entries.length > 0;
  }
  end() {
    const result = this.published;
    this.frame = null;
    this.published = null;
    return result;
  }
  currentFallback(frame: AuthorityPhysicsFrame, holdOnly = false): AuthorityPhysicsUpdate[] {
    const seats = new Map(
      this.options.entities.query({ type: 'transport' }).flatMap((entity) => {
        const state = this.options.entities.transportState(this.options.entities.createReference(entity.id)!)!;
        const seat = deriveMountedSeatConstraintV1(this.transport.definitions.require(state.definitionId), state);
        return seat
          ? [
              [
                seat.rider.entityId,
                {
                  position: [...seat.pose.position] as [number, number, number],
                  physicsVelocity: [...state.velocity] as [number, number, number],
                },
              ] as const,
            ]
          : [];
      }),
    );
    return frame.updates.flatMap(({ id }) => {
      const entity = this.options.entities.get(id);
      return entity && (!holdOnly || entity.type === 'transport' || seats.has(id))
        ? [
            {
              id,
              update: seats.get(id) ?? {
                position: [...entity.position] as [number, number, number],
                physicsVelocity: [...(entity.physicsVelocity ?? [0, 0, 0])] as [number, number, number],
              },
            },
          ]
        : [];
    });
  }
  private requireFrame() {
    if (!this.frame) throw new Error('Transport physics frame is inactive.');
    return this.frame;
  }
  isFresh() {
    return !!this.frame && this.signature() === this.baseline;
  }
  private assertFresh() {
    if (!this.isFresh()) throw new Error('transport-motion-frame-stale');
  }
  private signature() {
    const frame = this.requireFrame();
    return JSON.stringify([
      this.frameId,
      frame.epoch,
      frame.physicsTick,
      frame.acknowledgedSequence,
      this.options.kernelState.gameplayRevision,
      this.options.kernelState.worldRevision,
      frame.updates.map(({ id }) => this.options.entities.get(id)),
      this.options.entities
        .query({ type: 'transport' })
        .map((entity) => [entity, this.options.entities.transportComponentSnapshot(entity.id)]),
    ]);
  }
  private project(): TransportMotionProjection {
    const frame = this.requireFrame();
    const entries = this.options.entities.query({ type: 'transport' }).flatMap((entity) => {
      const state = this.options.entities.transportState(this.options.entities.createReference(entity.id)!)!;
      const policy = this.config.policies.find((entry) => entry.definitionId === state.definitionId);
      if (!policy) return [];
      const definition = this.transport.definitions.require(state.definitionId);
      return [
        {
          state,
          candidate: projectSurfaceMotion({
            state,
            policy,
            policies: this.config.policies,
            definition,
            frame,
            config: this.transport,
            entities: this.options.entities,
            callbacks: this.options.callbacks,
          }),
        },
      ];
    });
    // First-pass paths are safe against stationary carriers. The second pass may only stop
    // those paths, so removing another carrier's motion cannot invalidate that safety.
    const tentative = buildTransportMotionPublication(this.transport, { version: 1, frameId: this.frameId, entries });
    const corrections = new Map(this.corrections(tentative, frame).map((entry) => [entry.id, entry]));
    const relativeFrame = { ...frame, updates: frame.updates.map((entry) => corrections.get(entry.id) ?? entry) };
    return {
      version: 1,
      frameId: this.frameId,
      entries: entries.map((entry) => {
        if (entry.candidate.traveledDistance === 0) return entry;
        const candidate = projectSurfaceMotion({
          state: entry.state,
          policy: this.config.policies.find((policy) => policy.definitionId === entry.state.definitionId)!,
          policies: this.config.policies,
          definition: this.transport.definitions.require(entry.state.definitionId),
          frame: relativeFrame,
          config: this.transport,
          entities: this.options.entities,
          callbacks: this.options.callbacks,
        });
        return candidate.stopReason ? { ...entry, candidate } : entry;
      }),
    };
  }
  private corrections(
    candidate: ReturnType<typeof buildTransportMotionPublication>,
    frame: AuthorityPhysicsFrame,
  ): AuthorityPhysicsUpdate[] {
    return candidate.entries.flatMap(({ state, seat }) => {
      const result: AuthorityPhysicsUpdate[] = [
        {
          id: state.reference.entityId,
          update: { position: [...state.pose.position], physicsVelocity: [...state.velocity] },
        },
      ];
      if (seat) {
        const old = this.options.entities.transportState(state.reference)!;
        const previous = deriveMountedSeatConstraintV1(this.transport.definitions.require(state.definitionId), old)!;
        result.push({
          id: seat.rider.entityId,
          update: {
            position: [...seat.pose.position],
            physicsVelocity: seat.pose.position.map(
              (value, axis) =>
                state.velocity[axis]! +
                (value - state.pose.position[axis]! - (previous.pose.position[axis]! - old.pose.position[axis]!)) /
                  frame.seconds,
            ) as [number, number, number],
          },
        });
      }
      return result;
    });
  }
}
