import { vi } from 'vitest';
import type { ModuleInvocationValue } from '../../src/server/composition/contracts';
import { createRegisteredOperationRuntime } from '../../src/server/composition/registered-operations';
import { GameServer } from '../../src/server/game-server';
import { EntityStore } from '../../src/server/gameplay/entity-store';
import { gameplayContentFromComposition } from '../../src/server/gameplay/modules/content-capabilities';
import {
  STRUCTURE_BREAK_OPERATION,
  STRUCTURE_PLACE_OPERATION,
  STRUCTURE_RESOURCE,
  STRUCTURE_TOGGLE_OPERATION,
} from '../../src/server/gameplay/modules/structure-actions-module';
import type { StructurePositionV1 } from '../../src/server/gameplay/modules/structure-definition';
import { RegisteredStructureRuntime } from '../../src/server/gameplay/modules/registered-structure-runtime';
import { WorldResourceAuthorizer } from '../../src/server/harness/world-authorization';
import { Voxel } from '../../src/world/voxel';
import { testCorePlatform } from '../support/core-platform';
import { testWorldgenExecutableProvider } from '../support/worldgen';
import { createStructureTestComposition } from './structure-runtime-test-composition';

export type StructureRuntimeFixtureOptions = Readonly<{
  mode?: 'survival' | 'creative';
  maxReceipts?: number;
  failRemoval?: boolean;
  failCancellation?: boolean;
  removalFacts?: readonly (readonly ModuleInvocationValue[])[];
  failRemovalPrepareAt?: number;
  failWorldValidateOnce?: boolean;
  failGameplayValidateOnce?: boolean;
  failDeliveryPrepareOnce?: boolean;
  failDeliveryValidateOnce?: boolean;
  unavailablePositions?: ReadonlySet<string>;
  cellOverrides?: ReadonlyMap<string, Readonly<{ voxel: number; fluid: number }>>;
  afterFactDeliveryPrepared?(): void;
  beforeWorldPrepare?(context: Readonly<{ server: GameServer; entities: EntityStore }>): void;
}>;

export function createStructureRuntimeFixture(options: StructureRuntimeFixtureOptions = {}) {
  const { assembled, actions } = createStructureTestComposition();
  const content = gameplayContentFromComposition(assembled);
  const server = new GameServer({
    seedText: 'b2-structure',
    platform: testCorePlatform,
    worldgenProvider: testWorldgenExecutableProvider,
    composition: assembled,
  });
  server.edit(1, 30, 0, Voxel.Stone);
  server.edit(1, 31, 0, Voxel.Air);
  server.edit(1, 32, 0, Voxel.Air);
  const entities = new EntityStore(content.items);
  entities.spawn({ id: 'alice', type: 'player', position: [1.5, 31, 3.5] });
  const actor = entities.playerStateAccess('alice');
  if (options.mode === 'creative') {
    actor.replaceModeComponents({
      mode: { version: 1, value: 'creative', revision: 1 },
      creativeCatalog: {
        version: 1,
        revision: 1,
        selectedSlot: 0,
        hotbar: ['gate', ...Array.from({ length: 7 }, () => null)],
      },
      flight: { version: 1, enabled: false, revision: 0 },
    });
  } else actor.inventory.add({ itemId: 'gate', count: 2 });
  let gameplayRevision = 0;
  let removalApplyCount = 0;
  let cancellationApplyCount = 0;
  let deliveredFactBatches: readonly Readonly<{
    facts: readonly ModuleInvocationValue[];
    worldRevision: number;
    gameplayRevision: number;
  }>[] = [];
  let failWorldValidate = options.failWorldValidateOnce === true;
  let failGameplayValidate = options.failGameplayValidateOnce === true;
  let failDeliveryPrepare = options.failDeliveryPrepareOnce === true;
  let failDeliveryValidate = options.failDeliveryValidateOnce === true;
  const runtimeHolder: { current?: RegisteredStructureRuntime } = {};
  const removalPrepare = vi.fn((_position: StructurePositionV1) => {
    const ordinal = removalPrepare.mock.calls.length;
    if (options.failRemovalPrepareAt === ordinal) throw new Error('dependent-removal-prepare-failure');
    let validated = false;
    return {
      removed: true,
      ejectedItem: null,
      facts: options.removalFacts?.[(ordinal - 1) % (options.removalFacts.length || 1)] ?? [],
      validate() {
        if (options.failRemoval && ordinal === 2) throw new Error('dependent-removal-failure');
        validated = true;
      },
      apply() {
        if (!validated) throw new Error('dependent removal requires validation');
        removalApplyCount += 1;
      },
    };
  });
  const runtime = new RegisteredStructureRuntime({
    composition: assembled,
    entities,
    readCell(position) {
      const key = position.join(',');
      if (options.unavailablePositions?.has(key)) return null;
      const overridden = options.cellOverrides?.get(key);
      if (overridden) return overridden;
      const cell = server.peekLoadedVoxel(...position);
      if (!cell) return null;
      const fluid = server.getFluidCell(...position);
      return { voxel: cell.voxel, fluid: fluid ? fluid.level | (fluid.source ? 0x80 : 0) : 0 };
    },
    prepareVoxelEdits: (actorId, edits) => {
      options.beforeWorldPrepare?.({ server, entities });
      const prepared = server.prepareVoxelEdits(actorId, edits);
      return {
        ...prepared,
        validate() {
          if (failWorldValidate) {
            failWorldValidate = false;
            throw new Error('world-validation-failure');
          }
          prepared.validate();
        },
      };
    },
    gameplayRevision: () => gameplayRevision,
    worldRevision: () => server.worldRevision,
    prepareGameplayChange: (_inventoryChanged, precedingWorldCommit) => {
      const previous = gameplayRevision;
      if (precedingWorldCommit.worldRevision !== server.worldRevision + 1)
        throw new Error('prepared world/gameplay revision mismatch');
      if (previous >= Number.MAX_SAFE_INTEGER) throw new RangeError('gameplay revision exhausted');
      let validated = false;
      return {
        revision: previous + 1,
        validate() {
          if (failGameplayValidate) {
            failGameplayValidate = false;
            throw new Error('gameplay-validation-failure');
          }
          if (gameplayRevision !== previous) throw new Error('gameplay revision stale');
          validated = true;
        },
        apply() {
          if (!validated) throw new Error('gameplay revision requires validation');
          gameplayRevision = previous + 1;
        },
      };
    },
    prepareCancellation: () => {
      let validated = false;
      return {
        validate() {
          if (options.failCancellation) throw new Error('cancellation-failure');
          validated = true;
        },
        apply() {
          if (!validated) throw new Error('cancellation requires validation');
          cancellationApplyCount += 1;
        },
      };
    },
    prepareDependentRemoval: removalPrepare,
    prepareFactDelivery(facts, precedingWorldCommit, nextGameplayRevision) {
      if (failDeliveryPrepare && facts.length > 0) {
        failDeliveryPrepare = false;
        throw new RangeError('fact-delivery-capacity');
      }
      const batch = Object.freeze({
        facts,
        worldRevision: precedingWorldCommit.worldRevision,
        gameplayRevision: nextGameplayRevision,
      });
      const previous = deliveredFactBatches;
      const next = Object.freeze([...previous, batch]);
      options.afterFactDeliveryPrepared?.();
      let validated = false;
      return {
        validate() {
          if (failDeliveryValidate) {
            failDeliveryValidate = false;
            throw new Error('fact-delivery-validation-failure');
          }
          if (deliveredFactBatches !== previous) throw new Error('fact-delivery-frontier-stale');
          validated = true;
        },
        apply() {
          if (!validated) throw new Error('fact delivery requires validation');
          if (server.worldRevision !== precedingWorldCommit.worldRevision) throw new Error('fact-before-world');
          if (gameplayRevision !== nextGameplayRevision) throw new Error('fact-before-gameplay');
          if (!runtimeHolder.current?.hasCommit(precedingWorldCommit.worldRevision))
            throw new Error('fact-before-receipt');
          if (facts.length > 0) {
            if (server.getVoxel(1, 31, 0) !== Voxel.Air || server.getVoxel(1, 32, 0) !== Voxel.Air)
              throw new Error('fact-before-canonical');
            if (entities.query({ type: 'world-item' }).length !== 1) throw new Error('fact-before-ecs');
          }
          deliveredFactBatches = next;
        },
      };
    },
    ...(options.maxReceipts ? { maxReceipts: options.maxReceipts } : {}),
  });
  runtimeHolder.current = runtime;
  const authorizer = new WorldResourceAuthorizer(
    {
      principals: [{ id: 'human', boundEntityId: 'alice' }],
      rules: [
        {
          effect: 'allow',
          principal: { ids: ['human'] },
          resources: [STRUCTURE_RESOURCE],
          operations: ['read', 'execute'],
          scope: 'any',
        },
      ],
    },
    assembled.resources,
  );
  const operations = createRegisteredOperationRuntime({
    composition: assembled,
    authorizer,
    clone: structuredClone,
    state: runtime.state,
  });
  const execution = operations.bind({
    moduleId: actions.descriptor.id,
    principalId: 'human',
    originalActorId: 'alice',
  });
  const invoke = (kind: 'place' | 'toggle' | 'break', hit: StructurePositionV1, adjacent: StructurePositionV1) =>
    execution.invoke({
      operationId:
        kind === 'place'
          ? STRUCTURE_PLACE_OPERATION
          : kind === 'toggle'
            ? STRUCTURE_TOGGLE_OPERATION
            : STRUCTURE_BREAK_OPERATION,
      target: { kind: 'voxel', position: kind === 'place' ? adjacent : hit },
      input: { hit, adjacent },
    });
  return {
    server,
    entities,
    actor,
    runtime,
    invoke,
    gameplayRevision: () => gameplayRevision,
    removalPrepare,
    removalApplyCount: () => removalApplyCount,
    cancellationApplyCount: () => cancellationApplyCount,
    factBatches: () => deliveredFactBatches,
    takeFactBatches: () => {
      const batches = deliveredFactBatches;
      deliveredFactBatches = [];
      return batches;
    },
  };
}

export const placeStructure = (
  world: ReturnType<typeof createStructureRuntimeFixture>,
  hit: StructurePositionV1 = [1, 30, 0],
  adjacent: StructurePositionV1 = [1, 31, 0],
) => world.invoke('place', hit, adjacent);
