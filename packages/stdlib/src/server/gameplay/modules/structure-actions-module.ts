import type { ModModule, ModuleInvocationValue } from '../../composition/contracts';
import type { ModStateAddress } from '../../composition/operation-contracts';
import {
  createContentItemIdentityResolver,
  type ContentItemIdentityResolver,
} from '../../composition/content-item-identity';
import type { EntityLifetimeReference } from '../../simulation/action-identity';
import type { VoxelGeometryRegistryV1 } from '../../../world/voxel-geometry';
import type { VoxelSemanticsRegistry } from '../../../world/voxel-semantics';
import type { InventorySlot } from '../inventory';
import type { ItemDefinitionRegistry } from '../item-registry';
import { playerOccupiesVoxelShape } from '../player-occupancy';
import { ITEMS_CAPABILITY, VOXEL_SEMANTICS_CAPABILITY } from './content-capabilities';
import type { StructureDefinitionV1, StructurePositionV1 } from './structure-definition';
import { STRUCTURE_DEFINITIONS_CAPABILITY, type StructureDefinitionRegistryV1 } from './structure-definition-module';
import {
  buildStructureBreakCandidateV1,
  buildStructurePlaceCandidateV1,
  buildStructureToggleCandidateV1,
  type StructureOperationPlanV1,
} from './structure-operation-model';
import { resolveStructurePlacementIntentV1 } from './structure-target-dispatch';
import { VOXEL_GEOMETRY_CAPABILITY } from './voxel-geometry-module';

export const STRUCTURE_ACTIONS_CAPABILITY = 'seedlands:structure-actions';
export const STRUCTURE_ACTOR_COMPONENT = 'seedlands:structure-actor';
export const STRUCTURE_VOXEL_COMPONENT = 'seedlands:structure-voxel';
export const STRUCTURE_RESOURCE = 'seedlands.structure';
export const STRUCTURE_PLACE_OPERATION = 'seedlands:structure-place';
export const STRUCTURE_TOGGLE_OPERATION = 'seedlands:structure-toggle';
export const STRUCTURE_BREAK_OPERATION = 'seedlands:structure-break';

const MAX_WORLD_COORDINATE = 30_000_000;
const MAX_IDENTITY_LENGTH = 256;

export type StructureActorProjectionV1 = Readonly<{
  version: 1;
  reference: EntityLifetimeReference;
  position: readonly [number, number, number];
  lifecycle: 'alive' | 'dead';
  mode: Readonly<{ value: 'survival' | 'creative'; revision: number }>;
  inventoryRevision: number;
  slots: readonly InventorySlot[];
  selectedSlot: number;
  creativeCatalog: Readonly<{ revision: number; selectedSlot: number; hotbar: readonly (string | null)[] }>;
}>;
export type StructureVoxelProjectionV1 = Readonly<{
  version: 1;
  position: StructurePositionV1;
  voxel: number;
  fluid: number;
}>;
export type StructureActionPolicyV1 = Readonly<{
  placementState(definition: StructureDefinitionV1, bearing: 'north' | 'east' | 'south' | 'west'): string;
  toggleTransitionId(definition: StructureDefinitionV1): string;
  isReplaceable(voxel: number): boolean;
  breakToolWear?(definition: StructureDefinitionV1, selected: InventorySlot): 0 | 1;
}>;
export type StructureActionEnvironmentV1 = Readonly<{
  registry: StructureDefinitionRegistryV1;
  identity: ContentItemIdentityResolver;
  semantics: VoxelSemanticsRegistry;
  geometry: VoxelGeometryRegistryV1;
  policy: StructureActionPolicyV1;
}>;
export type StructureActionTargetV1 = Readonly<{
  hit: StructurePositionV1;
  adjacent: StructurePositionV1;
}>;

const record = (raw: unknown, keys: readonly string[], label: string): Record<string, unknown> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError(`${label} is invalid.`);
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).length !== keys.length) throw new TypeError(`${label} fields are invalid.`);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError(`${label} fields are invalid.`);
  }
  return raw as Record<string, unknown>;
};
const position = (raw: unknown, label: string): StructurePositionV1 => {
  if (
    !Array.isArray(raw) ||
    raw.length !== 3 ||
    Reflect.ownKeys(raw).length !== 4 ||
    raw.some((value) => !Number.isSafeInteger(value) || Math.abs(value) > MAX_WORLD_COORDINATE)
  )
    throw new TypeError(`${label} is invalid.`);
  return Object.freeze([raw[0], raw[1], raw[2]]) as StructurePositionV1;
};
const actorPosition = (raw: unknown): readonly [number, number, number] => {
  if (
    !Array.isArray(raw) ||
    raw.length !== 3 ||
    Reflect.ownKeys(raw).length !== 4 ||
    raw.some((value) => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_WORLD_COORDINATE)
  )
    throw new TypeError('Structure actor position is invalid.');
  return Object.freeze([raw[0], raw[1], raw[2]]) as readonly [number, number, number];
};
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const identity = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTITY_LENGTH && value.trim() === value;

export function validateStructureActorProjectionV1(
  raw: unknown,
  items: ItemDefinitionRegistry,
): StructureActorProjectionV1 {
  const value = record(
    raw,
    [
      'version',
      'reference',
      'position',
      'lifecycle',
      'mode',
      'inventoryRevision',
      'slots',
      'selectedSlot',
      'creativeCatalog',
    ],
    'Structure actor projection',
  );
  const reference = record(value.reference, ['entityId', 'epoch', 'lifetime'], 'Structure actor reference');
  const mode = record(value.mode, ['value', 'revision'], 'Structure actor mode');
  const catalog = record(value.creativeCatalog, ['revision', 'selectedSlot', 'hotbar'], 'Structure creative catalog');
  if (
    value.version !== 1 ||
    !identity(reference.entityId) ||
    !revision(reference.epoch) ||
    reference.epoch === 0 ||
    !revision(reference.lifetime) ||
    reference.lifetime === 0 ||
    (value.lifecycle !== 'alive' && value.lifecycle !== 'dead') ||
    (mode.value !== 'survival' && mode.value !== 'creative') ||
    !revision(mode.revision) ||
    !revision(value.inventoryRevision) ||
    !Array.isArray(value.slots) ||
    value.slots.length < 1 ||
    value.slots.length > 64 ||
    !Number.isSafeInteger(value.selectedSlot) ||
    (value.selectedSlot as number) < 0 ||
    (value.selectedSlot as number) >= value.slots.length ||
    !revision(catalog.revision) ||
    !Array.isArray(catalog.hotbar) ||
    catalog.hotbar.length < 1 ||
    catalog.hotbar.length > 9 ||
    !Number.isSafeInteger(catalog.selectedSlot) ||
    (catalog.selectedSlot as number) < 0 ||
    (catalog.selectedSlot as number) >= catalog.hotbar.length
  )
    throw new TypeError('Structure actor projection is invalid.');
  const slots = Object.freeze(
    value.slots.map((slot) => (slot === null ? null : Object.freeze(items.normalizeStack(slot)))),
  );
  const hotbar = Object.freeze(
    catalog.hotbar.map((itemId) => {
      if (itemId !== null && (!identity(itemId) || !items.has(itemId)))
        throw new TypeError('Structure creative catalog item is invalid.');
      return itemId as string | null;
    }),
  );
  return Object.freeze({
    version: 1,
    reference: Object.freeze({
      entityId: reference.entityId,
      epoch: reference.epoch as number,
      lifetime: reference.lifetime as number,
    }),
    position: actorPosition(value.position),
    lifecycle: value.lifecycle,
    mode: Object.freeze({ value: mode.value, revision: mode.revision as number }),
    inventoryRevision: value.inventoryRevision as number,
    slots,
    selectedSlot: value.selectedSlot as number,
    creativeCatalog: Object.freeze({
      revision: catalog.revision as number,
      selectedSlot: catalog.selectedSlot as number,
      hotbar,
    }),
  } as StructureActorProjectionV1);
}

export function validateStructureVoxelProjectionV1(raw: unknown): StructureVoxelProjectionV1 {
  const value = record(raw, ['version', 'position', 'voxel', 'fluid'], 'Structure voxel projection');
  if (
    value.version !== 1 ||
    !Number.isSafeInteger(value.voxel) ||
    (value.voxel as number) < 0 ||
    (value.voxel as number) > 65_535 ||
    !Number.isSafeInteger(value.fluid) ||
    (value.fluid as number) < 0 ||
    (value.fluid as number) > 255
  )
    throw new TypeError('Structure voxel projection is invalid.');
  return Object.freeze({
    version: 1,
    position: position(value.position, 'Structure voxel position'),
    voxel: value.voxel as number,
    fluid: value.fluid as number,
  });
}

export const structureActorAddress = (entityId: string): ModStateAddress =>
  Object.freeze({ componentId: STRUCTURE_ACTOR_COMPONENT, target: Object.freeze({ kind: 'entity', entityId }) });
export const structureVoxelAddress = (at: StructurePositionV1): ModStateAddress =>
  Object.freeze({ componentId: STRUCTURE_VOXEL_COMPONENT, target: Object.freeze({ kind: 'voxel', position: at }) });

export function validateStructureActionTargetV1(raw: ModuleInvocationValue | undefined): StructureActionTargetV1 {
  const value = record(raw, ['hit', 'adjacent'], 'Structure action input');
  const hit = position(value.hit, 'Structure hit');
  const adjacent = position(value.adjacent, 'Structure adjacent');
  if (hit.reduce((sum, coordinate, axis) => sum + Math.abs(coordinate - adjacent[axis]!), 0) !== 1)
    throw new TypeError('Structure hit and adjacent cells must be orthogonally adjacent.');
  return Object.freeze({ hit, adjacent });
}

const selectedStorageId = (actor: StructureActorProjectionV1): string | null =>
  actor.mode.value === 'creative'
    ? (actor.creativeCatalog.hotbar[actor.creativeCatalog.selectedSlot] ?? null)
    : (actor.slots[actor.selectedSlot]?.itemId ?? null);

export function buildRegisteredStructureCandidateV1(
  environment: StructureActionEnvironmentV1,
  input: Readonly<{
    kind: StructureOperationPlanV1['kind'];
    actor: StructureActorProjectionV1;
    target: StructurePositionV1;
    action: StructureActionTargetV1;
    read(position: StructurePositionV1): number | undefined;
  }>,
): StructureOperationPlanV1 {
  if (input.actor.lifecycle !== 'alive') throw new Error('structure-actor-unavailable');
  const actor = { actorId: input.actor.reference.entityId, mode: input.actor.mode.value };
  const collides = (at: StructurePositionV1, voxel: number) =>
    playerOccupiesVoxelShape(input.actor.position, at, voxel, environment.geometry);
  if (input.kind === 'place') {
    if (!input.target.every((value, axis) => value === input.action.adjacent[axis]))
      throw new TypeError('Structure place target must be the adjacent cell.');
    const storageId = selectedStorageId(input.actor);
    const resolved = resolveStructurePlacementIntentV1(
      environment.registry,
      environment.identity,
      storageId,
      input.action.hit,
      input.action.adjacent,
      input.actor.position,
    );
    if (resolved.status !== 'resolved') throw new Error(`structure-${resolved.status}`);
    const stateId = environment.policy.placementState(resolved.definition, resolved.bearing);
    return buildStructurePlaceCandidateV1(environment.registry, {
      actor: { ...actor, selectedItemDefinitionId: resolved.definition.placementItemId },
      root: resolved.root,
      stateId,
      read: input.read,
      isReplaceable: environment.policy.isReplaceable,
      isSolid: (voxel) => environment.semantics.get(voxel)?.solid === true,
      collides,
    });
  }
  if (!input.target.every((value, axis) => value === input.action.hit[axis]))
    throw new TypeError('Structure target must be the hit cell.');
  return input.kind === 'toggle'
    ? buildStructureToggleCandidateV1(environment.registry, {
        actor,
        hit: input.action.hit,
        transitionId: environment.policy.toggleTransitionId(
          environment.registry.require(
            environment.registry.resolveTarget(input.action.hit, input.read)?.definitionId ??
              (() => {
                throw new Error('structure-malformed');
              })(),
          ),
        ),
        read: input.read,
        collides,
      })
    : buildStructureBreakCandidateV1(environment.registry, { actor, hit: input.action.hit, read: input.read });
}

export function defineStructureActionsModuleV1(
  options: Readonly<{ moduleId: string; policy: StructureActionPolicyV1 }>,
): ModModule {
  return Object.freeze({
    descriptor: Object.freeze({
      id: options.moduleId,
      version: '1.0.0',
      requires: Object.freeze([
        { id: STRUCTURE_DEFINITIONS_CAPABILITY, version: '1.0.0' },
        { id: ITEMS_CAPABILITY, version: '1.0.0' },
        { id: VOXEL_SEMANTICS_CAPABILITY, version: '1.0.0' },
        { id: VOXEL_GEOMETRY_CAPABILITY, version: '1.0.0' },
      ]),
      provides: Object.freeze([{ id: STRUCTURE_ACTIONS_CAPABILITY, version: '1.0.0' }]),
      resources: Object.freeze([{ id: STRUCTURE_RESOURCE, operations: ['read', 'execute'] as const }]),
      permissions: Object.freeze([{ resource: STRUCTURE_RESOURCE, operations: ['read', 'execute'] as const }]),
    }),
    register(api) {
      const registry = api.requireCapability<StructureDefinitionRegistryV1>(STRUCTURE_DEFINITIONS_CAPABILITY);
      const items = api.requireCapability<ItemDefinitionRegistry>(ITEMS_CAPABILITY);
      const semantics = api.requireCapability<VoxelSemanticsRegistry>(VOXEL_SEMANTICS_CAPABILITY);
      const geometry = api.requireCapability<VoxelGeometryRegistryV1>(VOXEL_GEOMETRY_CAPABILITY);
      let identityResolver: ContentItemIdentityResolver | undefined;
      api.onDefinitionsReady(() => {
        identityResolver = createContentItemIdentityResolver({
          items: api.readContentDefinitions().items.map(({ id, storageId }) => ({ id, storageId: storageId ?? id })),
        });
      });
      const environment = (): StructureActionEnvironmentV1 => {
        if (!identityResolver) throw new Error('Structure item identities are unavailable.');
        return { registry, identity: identityResolver, semantics, geometry, policy: options.policy };
      };
      api.provideCapability(STRUCTURE_ACTIONS_CAPABILITY, Object.freeze({ policy: options.policy }));
      api.registerState({
        id: STRUCTURE_ACTOR_COMPONENT,
        version: '1.0.0',
        resource: STRUCTURE_RESOURCE,
        validate(value) {
          try {
            validateStructureActorProjectionV1(value, items);
            return true;
          } catch {
            return false;
          }
        },
      });
      api.registerState({
        id: STRUCTURE_VOXEL_COMPONENT,
        version: '1.0.0',
        resource: STRUCTURE_RESOURCE,
        validate(value) {
          try {
            validateStructureVoxelProjectionV1(value);
            return true;
          } catch {
            return false;
          }
        },
      });
      for (const [id, kind] of [
        [STRUCTURE_PLACE_OPERATION, 'place'],
        [STRUCTURE_TOGGLE_OPERATION, 'toggle'],
        [STRUCTURE_BREAK_OPERATION, 'break'],
      ] as const)
        api.registerOperation({
          id,
          resource: STRUCTURE_RESOURCE,
          run(context, raw, state) {
            if (context.kind !== 'actor' || context.target.kind !== 'voxel')
              throw new TypeError('Structure operation requires an actor voxel target.');
            const actor = validateStructureActorProjectionV1(
              state.read(structureActorAddress(context.originalActorId)),
              items,
            );
            if (actor.reference.entityId !== context.originalActorId)
              throw new TypeError('Structure actor projection does not match the bound actor.');
            const action = validateStructureActionTargetV1(raw);
            return buildRegisteredStructureCandidateV1(environment(), {
              kind,
              actor,
              target: position(context.target.position, 'Structure authorization target'),
              action,
              read: (at) => validateStructureVoxelProjectionV1(state.read(structureVoxelAddress(at))).voxel,
            });
          },
        });
    },
  } satisfies ModModule);
}
