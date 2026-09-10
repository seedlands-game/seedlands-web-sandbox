import {
  FURNACE_WORLD_COMPONENT,
  FURNACE_RESOURCE,
  FURNACE_PARTITIONS,
  FURNACE_ADVANCE_OPERATION,
  FURNACE_SYSTEM,
  furnaceWorldAddress,
  validateFurnacePartition,
  furnaceSeconds,
  buildFurnaceWorldCandidate,
} from './furnace-world-model';
import type { ModModule } from '../../composition/contracts';
import type { GameplayContent } from '../gameplay-content';
import {
  STATION_ACTOR_COMPONENT,
  STATION_INSTANCE_COMPONENT,
  STATION_ACTOR_RESOURCE,
  STATION_RESOURCE,
  STATION_TRANSFER_OPERATION,
  STATION_CRAFT_OPERATION,
  stationActorAddress,
  stationInstanceAddress,
  validateStationActor,
  validateStationProjection,
  buildStationActionCandidate,
} from './station-action-model';
import { buildInventoryPointerCandidate } from './inventory-pointer-model';

export function defineStationActionsModule(): ModModule {
  return Object.freeze({
    descriptor: {
      id: 'seedlands:station-actions-module',
      version: '1.0.0',
      requires: [{ id: 'seedlands:gameplay-content', version: '1.0.0' }],
      provides: [{ id: 'seedlands:station-actions', version: '1.0.0' }],
      resources: [STATION_RESOURCE, STATION_ACTOR_RESOURCE, FURNACE_RESOURCE].map((id) => ({
        id,
        operations: ['read', 'execute'] as const,
      })),
      permissions: [STATION_RESOURCE, STATION_ACTOR_RESOURCE, FURNACE_RESOURCE].map((resource) => ({
        resource,
        operations: ['read', 'execute'] as const,
      })),
    },
    register(api) {
      const provider = api.requireCapability<Readonly<{ resolve(): GameplayContent }>>('seedlands:gameplay-content');
      const content = () => {
        const value = provider.resolve();
        if (!value.stations) throw new TypeError('Station actions require explicit station content.');
        return value;
      };
      api.onDefinitionsReady(content);
      api.registerState({
        id: FURNACE_WORLD_COMPONENT,
        version: '1.0.0',
        resource: FURNACE_RESOURCE,
        partitions: FURNACE_PARTITIONS,
        validate(raw) {
          try {
            validateFurnacePartition(raw, content());
            return true;
          } catch {
            return false;
          }
        },
      });
      api.registerOperation({
        id: FURNACE_ADVANCE_OPERATION,
        executionKind: 'system',
        resource: FURNACE_RESOURCE,
        run(context, input, state) {
          if (context.kind !== 'system' || context.target.kind !== 'world')
            throw new TypeError('Furnace advance requires world system execution.');
          const seconds = furnaceSeconds(input),
            entries = [];
          for (let partition = 0; partition < FURNACE_PARTITIONS; partition++) {
            const projection = validateFurnacePartition(state.read(furnaceWorldAddress(partition)), content());
            if (projection.partition !== partition) throw new TypeError('Furnace partition address mismatch.');
            entries.push(...projection.entries);
          }
          return buildFurnaceWorldCandidate(entries, seconds, content());
        },
      });
      api.registerSystem({ id: FURNACE_SYSTEM, operationId: FURNACE_ADVANCE_OPERATION, cadence: 'every-advance' });
      api.provideCapability(
        'seedlands:station-actions',
        Object.freeze({
          transferOperationId: STATION_TRANSFER_OPERATION,
          craftOperationId: STATION_CRAFT_OPERATION,
          actorComponentId: STATION_ACTOR_COMPONENT,
          stationComponentId: STATION_INSTANCE_COMPONENT,
        }),
      );
      api.registerState({
        id: STATION_ACTOR_COMPONENT,
        version: '1.0.0',
        resource: STATION_ACTOR_RESOURCE,
        validate(raw) {
          try {
            validateStationActor(raw, content());
            return true;
          } catch {
            return false;
          }
        },
      });
      api.registerState({
        id: STATION_INSTANCE_COMPONENT,
        version: '1.0.0',
        resource: STATION_RESOURCE,
        validate(raw) {
          try {
            validateStationProjection(raw, content());
            return true;
          } catch {
            return false;
          }
        },
      });
      for (const [kind, id] of [
        ['transfer', STATION_TRANSFER_OPERATION],
        ['craft', STATION_CRAFT_OPERATION],
      ] as const)
        api.registerOperation({
          id,
          resource: STATION_RESOURCE,
          run(context, input, state) {
            if (context.kind !== 'actor' || context.target.kind !== 'entity')
              throw new TypeError('Station interaction requires an actor and station entity.');
            const actor = state.read(stationActorAddress(context.originalActorId));
            const station = state.read(stationInstanceAddress(context.target.entityId));
            const pointer =
              input !== null && typeof input === 'object' && !Array.isArray(input) && Object.hasOwn(input, 'command');
            const candidate = pointer
              ? buildInventoryPointerCandidate(content(), { actor: actor as never, station: station as never, input })
              : buildStationActionCandidate(content(), { kind, actor, station, input });
            if (pointer && (candidate as { result: { kind: string } }).result.kind !== 'pointer')
              throw new TypeError('Station pointer candidate kind is invalid.');
            if (pointer && ((input as { command: { kind: string } }).command.kind === 'craft') !== (kind === 'craft'))
              throw new TypeError('Station pointer operation kind is invalid.');
            if (
              candidate.actorReference.entityId !== context.originalActorId ||
              candidate.stationReference?.entityId !== context.target.entityId
            )
              throw new TypeError('Station projection identity mismatch.');
            return candidate;
          },
        });
    },
  } satisfies ModModule);
}
