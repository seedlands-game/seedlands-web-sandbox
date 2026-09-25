import type { FluidCell } from '../../fluid/fluid-cell';
import type { VoxelSemanticsDefinition } from '../../../world/voxel-semantics';
import type { EntityLifetimeReference } from '../ecs-entity-owner';
import { playerInteractionOrigin, positionsInRange, voxelCenter } from '../gameplay-geometry';
import { traceVoxelRay } from '../voxel-ray';
import type {
  ModDefinitionCatalog,
  ModItemDefinition,
  ModModule,
  ModRegistrationIdentity,
  ModulePermission,
  WorldComposition,
} from '../../composition/contracts';
import type { RegisteredOperationRequest, RegisteredOperationResult } from '../../composition/operation-contracts';
import type { WorldAuthorizationTarget } from '../../harness/world-authorization';

export const ITEM_INTERACTION_CAPABILITY = 'seedlands:item-interactions';

export type ItemInteractionTrigger = 'self' | 'voxel' | 'entity';
export type ItemInteractionTarget =
  | Readonly<{ kind: 'self' }>
  | Readonly<{
      kind: 'voxel';
      hit: readonly [number, number, number];
      adjacent: readonly [number, number, number];
    }>
  | Readonly<{ kind: 'entity'; reference: EntityLifetimeReference }>;
export type ItemInteractionExpectedSelectionV1 = Readonly<{
  inventoryRevision: number;
  modeRevision: number;
  creativeCatalogRevision: number;
  selectedSlot: number;
}>;
export type ItemInteractionDefinition = Readonly<{
  id: string;
  selector: Readonly<{ itemId: string }>;
  trigger: ItemInteractionTrigger;
  operationId: string;
  presentationKey: string;
  voxelHitPolicy?: 'fluid-source';
}>;
export type ResolvedItemInteraction = Readonly<{
  definition: ItemInteractionDefinition;
  moduleId: string;
  itemId: string;
}>;
export type ItemInteractionRegistryV1 = Readonly<{
  resolve(itemId: string, trigger: ItemInteractionTrigger): ResolvedItemInteraction | null;
  list(): readonly ResolvedItemInteraction[];
}>;
type ItemInteractionRuntimeOptions = Readonly<{
  actor(actorId: string): Readonly<{
    position: readonly [number, number, number];
    lifecycle: 'alive' | 'dead';
    mode: 'survival' | 'creative';
    inventoryRevision: number;
    modeRevision: number;
    creativeCatalogRevision: number;
    selectedSlot: number;
    survivalItemId: string | null;
    creativeItemId: string | null;
  }> | null;
  resolveEntity(
    reference: EntityLifetimeReference,
  ): Readonly<{ id: string; position: readonly [number, number, number] }> | null;
  resolveInteraction(itemId: string, trigger: ItemInteractionTrigger): ResolvedItemInteraction | null;
  invokeActor(request: RegisteredOperationRequest): RegisteredOperationResult;
  getVoxel(position: [number, number, number]): number | undefined;
  getVoxelSemantics(voxel: number): VoxelSemanticsDefinition | undefined;
  getFluidCell(position: [number, number, number]): FluidCell | null;
}>;

const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const PRESENTATION_KEY = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const FACE_INTERIOR_EPSILON = 1e-6;

const adjacentFacePoint = (
  hit: readonly [number, number, number],
  adjacent: readonly [number, number, number],
): [number, number, number] =>
  hit.map((coordinate, axis) => coordinate + 0.5 + (adjacent[axis] - coordinate) * (0.5 + FACE_INTERIOR_EPSILON)) as [
    number,
    number,
    number,
  ];

function hasExecutePermission(module: ReturnType<ModDefinitionCatalog['module']>, resource: string): boolean {
  return Boolean(
    module?.permissions.some(
      (permission) => permission.resource === resource && permission.operations.includes('execute'),
    ),
  );
}

function snapshotDefinition(raw: ItemInteractionDefinition): ItemInteractionDefinition {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Item interaction id is invalid.');
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  const required = ['id', 'selector', 'trigger', 'operationId', 'presentationKey'] as const;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.some((key) => typeof key !== 'string' || ![...required, 'voxelHitPolicy'].includes(key)) ||
    !required.every((key) => {
      const descriptor = descriptors[key];
      return descriptor?.enumerable === true && 'value' in descriptor;
    }) ||
    (descriptors.voxelHitPolicy !== undefined &&
      (!descriptors.voxelHitPolicy.enumerable || !('value' in descriptors.voxelHitPolicy)))
  )
    throw new TypeError('Item interaction definition fields are invalid.');
  const source = Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [
      key,
      (descriptor as PropertyDescriptor & { value: unknown }).value,
    ]),
  ) as Record<string, unknown>;
  if (typeof source.id !== 'string' || !NAMESPACE_ID.test(source.id))
    throw new TypeError('Item interaction id is invalid.');
  if (!source.selector || typeof source.selector !== 'object' || Array.isArray(source.selector))
    throw new TypeError('Item interaction selector is invalid: ' + source.id);
  const selectorDescriptors = Object.getOwnPropertyDescriptors(source.selector);
  const selectorKeys = Reflect.ownKeys(selectorDescriptors);
  const itemIdDescriptor = selectorDescriptors.itemId;
  if (
    selectorKeys.length !== 1 ||
    selectorKeys[0] !== 'itemId' ||
    itemIdDescriptor?.enumerable !== true ||
    !('value' in itemIdDescriptor) ||
    typeof itemIdDescriptor.value !== 'string' ||
    !NAMESPACE_ID.test(itemIdDescriptor.value)
  )
    throw new TypeError('Item interaction selector is invalid: ' + source.id);
  if (typeof source.trigger !== 'string' || !['self', 'voxel', 'entity'].includes(source.trigger))
    throw new TypeError('Item interaction trigger is invalid: ' + source.id);
  if (typeof source.operationId !== 'string' || !NAMESPACE_ID.test(source.operationId))
    throw new TypeError('Item interaction operation is invalid: ' + source.id);
  if (typeof source.presentationKey !== 'string' || !PRESENTATION_KEY.test(source.presentationKey))
    throw new TypeError('Item interaction presentation key is invalid: ' + source.id);
  if (source.voxelHitPolicy !== undefined && source.voxelHitPolicy !== 'fluid-source')
    throw new TypeError('Item interaction voxel hit policy is invalid: ' + source.id);
  if (source.voxelHitPolicy !== undefined && source.trigger !== 'voxel')
    throw new TypeError('Item interaction voxel hit policy requires a voxel trigger: ' + source.id);
  return Object.freeze({
    id: source.id,
    selector: Object.freeze({ itemId: itemIdDescriptor.value }),
    trigger: source.trigger as ItemInteractionTrigger,
    operationId: source.operationId,
    presentationKey: source.presentationKey,
    ...(source.voxelHitPolicy ? { voxelHitPolicy: source.voxelHitPolicy } : {}),
  });
}

export function isItemInteractionTarget(value: unknown): value is ItemInteractionTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  const only = (keys: readonly string[]) => Object.keys(source).every((key) => keys.includes(key));
  const position = (entry: unknown): entry is [number, number, number] =>
    Array.isArray(entry) &&
    entry.length === 3 &&
    Object.hasOwn(entry, 0) &&
    Object.hasOwn(entry, 1) &&
    Object.hasOwn(entry, 2) &&
    entry.every(Number.isSafeInteger);
  if (source.kind === 'self') return only(['kind']);
  if (source.kind === 'voxel') {
    const hit = source.hit;
    const adjacent = source.adjacent;
    return (
      only(['kind', 'hit', 'adjacent']) &&
      position(hit) &&
      position(adjacent) &&
      hit.reduce((sum, coordinate, axis) => sum + Math.abs(coordinate - adjacent[axis]), 0) === 1
    );
  }
  if (source.kind !== 'entity' || !only(['kind', 'reference'])) return false;
  const reference = source.reference;
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return false;
  const ref = reference as Record<string, unknown>;
  return (
    Object.keys(ref).every((key) => ['entityId', 'epoch', 'lifetime'].includes(key)) &&
    typeof ref.entityId === 'string' &&
    ref.entityId.length > 0 &&
    ref.entityId.length <= 256 &&
    typeof ref.epoch === 'number' &&
    Number.isSafeInteger(ref.epoch) &&
    ref.epoch > 0 &&
    typeof ref.lifetime === 'number' &&
    Number.isSafeInteger(ref.lifetime) &&
    ref.lifetime > 0
  );
}

export function cloneItemInteractionExpectedSelection(value: unknown): ItemInteractionExpectedSelectionV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Interaction expected selection is invalid.');
  const source = value as Record<string, unknown>;
  const keys = ['inventoryRevision', 'modeRevision', 'creativeCatalogRevision', 'selectedSlot'];
  if (Object.keys(source).length !== keys.length || !keys.every((key) => Object.hasOwn(source, key)))
    throw new TypeError('Interaction expected selection fields are invalid.');
  for (const key of keys)
    if (typeof source[key] !== 'number' || !Number.isSafeInteger(source[key]) || source[key] < 0)
      throw new TypeError(`Interaction expected selection ${key} is invalid.`);
  return Object.freeze({
    inventoryRevision: source.inventoryRevision as number,
    modeRevision: source.modeRevision as number,
    creativeCatalogRevision: source.creativeCatalogRevision as number,
    selectedSlot: source.selectedSlot as number,
  });
}

export function itemInteractionRegistryForComposition(
  composition?: WorldComposition,
): ItemInteractionRegistryV1 | null {
  return composition?.definitionMap.capabilities.some(({ id }) => id === ITEM_INTERACTION_CAPABILITY)
    ? composition.capability<ItemInteractionRegistryV1>(ITEM_INTERACTION_CAPABILITY)
    : null;
}

function createItemInteractionRegistry() {
  const registered = new Map<
    string,
    Readonly<{ identity: ModRegistrationIdentity; definition: ItemInteractionDefinition }>
  >();
  const selectors = new Set<string>();
  let resolved: readonly ResolvedItemInteraction[] | null = null;
  return Object.freeze({
    register(identity: ModRegistrationIdentity, raw: ItemInteractionDefinition) {
      if (resolved) throw new TypeError('Item interaction registry is frozen.');
      const definition = snapshotDefinition(raw);
      if (registered.has(definition.id)) throw new TypeError(`Duplicate item interaction: ${definition.id}`);
      const selector = `${definition.selector.itemId}:${definition.trigger}`;
      if (selectors.has(selector)) throw new TypeError(`Item interaction item/trigger conflict: ${selector}`);
      selectors.add(selector);
      registered.set(definition.id, Object.freeze({ identity: Object.freeze({ ...identity }), definition }));
    },
    freeze(definitions: ModDefinitionCatalog, items: readonly ModItemDefinition[]) {
      if (resolved) throw new TypeError('Item interaction registry is already frozen.');
      const byId = new Map(items.map((item) => [item.id, item]));
      const next: ResolvedItemInteraction[] = [];
      for (const { identity, definition } of registered.values()) {
        const item = byId.get(definition.selector.itemId);
        if (!item) throw new TypeError(`Item interaction references unknown item: ${definition.selector.itemId}`);
        if (
          definition.voxelHitPolicy === 'fluid-source' &&
          !item.capabilities?.some(
            (capability) => capability.type === 'fluid-container' && capability.fluid === 'empty',
          )
        )
          throw new TypeError(
            'Item interaction fluid-source policy requires an empty fluid-container item: ' +
              definition.selector.itemId,
          );
        const operation = definitions.operation(definition.operationId);
        if (!operation) throw new TypeError(`Item interaction operation is missing: ${definition.operationId}`);
        if (operation.executionKind !== 'actor')
          throw new TypeError(`Item interaction operation is not actor-executable: ${definition.operationId}`);
        if (!hasExecutePermission(definitions.module(operation.moduleId), operation.resource))
          throw new TypeError(`Item interaction operation owner has no execute permission: ${definition.operationId}`);
        if (!hasExecutePermission(definitions.module(identity.moduleId), operation.resource))
          throw new TypeError(`Item interaction provider has no execute permission: ${definition.operationId}`);
        next.push(
          Object.freeze({
            definition,
            moduleId: identity.moduleId,
            itemId: item.storageId ?? item.id,
          }),
        );
      }
      resolved = Object.freeze(next.sort((left, right) => left.definition.id.localeCompare(right.definition.id)));
    },
    capability(): ItemInteractionRegistryV1 {
      return Object.freeze({
        resolve(itemId, trigger) {
          if (!resolved) throw new TypeError('Item interaction registry is not frozen.');
          return resolved.find((entry) => entry.itemId === itemId && entry.definition.trigger === trigger) ?? null;
        },
        list() {
          if (!resolved) throw new TypeError('Item interaction registry is not frozen.');
          return resolved;
        },
      });
    },
  });
}

export function defineItemInteractionModule(
  input: Readonly<{
    moduleId: string;
    definitions: readonly ItemInteractionDefinition[];
    permissions?: readonly ModulePermission[];
  }>,
): ModModule {
  if (!NAMESPACE_ID.test(input.moduleId)) throw new TypeError('Item interaction module id is invalid.');
  if (!Array.isArray(input.definitions)) throw new TypeError('Item interaction definitions must be an array.');
  const definitions = Object.freeze(input.definitions.map(snapshotDefinition));
  return Object.freeze({
    descriptor: {
      id: input.moduleId,
      version: '1.0.0',
      provides: [{ id: ITEM_INTERACTION_CAPABILITY, version: '1.0.0' }],
      ...(input.permissions ? { permissions: input.permissions } : {}),
    },
    register(api) {
      const registry = createItemInteractionRegistry();
      for (const definition of definitions) registry.register(api.identity, definition);
      api.provideCapability(ITEM_INTERACTION_CAPABILITY, registry.capability());
      api.onDefinitionsReady((definitions) => registry.freeze(definitions, api.readContentDefinitions().items));
    },
  } satisfies ModModule);
}

export function dispatchItemInteraction(
  options: ItemInteractionRuntimeOptions,
  actorId: string,
  target: ItemInteractionTarget,
  expectedSelection: ItemInteractionExpectedSelectionV1,
) {
  const actor = options.actor(actorId);
  if (!actor) return { success: false as const, reason: 'player-dead' };
  if (actor.lifecycle !== 'alive') return { success: false as const, reason: 'player-dead' };
  if (
    actor.inventoryRevision !== expectedSelection.inventoryRevision ||
    actor.modeRevision !== expectedSelection.modeRevision ||
    actor.creativeCatalogRevision !== expectedSelection.creativeCatalogRevision ||
    actor.selectedSlot !== expectedSelection.selectedSlot
  )
    return { success: false as const, reason: 'stale-selection' };
  const selectedItemId = actor.mode === 'creative' ? actor.creativeItemId : actor.survivalItemId;
  if (!selectedItemId) return { success: false as const, reason: 'no-selected-item' };
  const binding = options.resolveInteraction(selectedItemId, target.kind);
  if (!binding) return { success: false as const, reason: 'item-no-interaction' };

  let operationTarget: WorldAuthorizationTarget;
  if (target.kind === 'self') operationTarget = { kind: 'entity', entityId: actorId };
  else if (target.kind === 'voxel') {
    const origin = playerInteractionOrigin(actor.position);
    if (target.hit.reduce((sum, coordinate, axis) => sum + Math.abs(coordinate - target.adjacent[axis]), 0) !== 1)
      return { success: false as const, reason: 'invalid-target' };
    if (
      !positionsInRange(origin, voxelCenter([...target.hit]), 5) ||
      !positionsInRange(origin, voxelCenter([...target.adjacent]), 5)
    )
      return { success: false as const, reason: 'out-of-range' };
    const hitVoxel = options.getVoxel([...target.hit]);
    const adjacentVoxel = options.getVoxel([...target.adjacent]);
    if (hitVoxel === undefined || adjacentVoxel === undefined)
      return { success: false as const, reason: 'chunk-unavailable' };
    const semantics = options.getVoxelSemantics(hitVoxel);
    if (!semantics) return { success: false as const, reason: 'invalid-target' };
    const fluid = binding.definition.voxelHitPolicy === 'fluid-source' ? options.getFluidCell([...target.hit]) : null;
    if (!semantics.targetable && !(fluid?.source === true && fluid.level === 8))
      return { success: false as const, reason: 'invalid-target' };
    const visibility = traceVoxelRay(
      adjacentFacePoint(target.hit, target.adjacent),
      origin,
      (x, y, z) => options.getVoxel([x, y, z]),
      (voxel) => options.getVoxelSemantics(voxel)?.solid ?? true,
    );
    if (visibility !== 'clear')
      return { success: false as const, reason: visibility === 'unavailable' ? 'chunk-unavailable' : 'blocked' };
    const adjacentVisibility = traceVoxelRay(
      voxelCenter([...target.adjacent]),
      origin,
      (x, y, z) => options.getVoxel([x, y, z]),
      (voxel) => options.getVoxelSemantics(voxel)?.solid ?? true,
    );
    if (adjacentVisibility !== 'clear')
      return {
        success: false as const,
        reason: adjacentVisibility === 'unavailable' ? 'chunk-unavailable' : 'blocked',
      };
    operationTarget = { kind: 'voxel', position: target.hit };
  } else {
    const resolved = options.resolveEntity(target.reference);
    if (!resolved) return { success: false as const, reason: 'stale-target-lifetime' };
    if (!positionsInRange(actor.position, resolved.position, 5))
      return { success: false as const, reason: 'out-of-range' };
    const visibility = traceVoxelRay(resolved.position, actor.position, (x, y, z) => options.getVoxel([x, y, z]));
    if (visibility !== 'clear')
      return { success: false as const, reason: visibility === 'unavailable' ? 'chunk-unavailable' : 'blocked' };
    operationTarget = { kind: 'entity', entityId: resolved.id };
  }
  const result = options.invokeActor({
    operationId: binding.definition.operationId,
    target: operationTarget,
    input: { version: 1, trigger: target.kind, target } as never,
  });
  const reason = (message: string, code: string) => {
    for (const value of ['target-occupied', 'not-fluid-source', 'inventory-full', 'world-not-changed'] as const)
      if (message.includes(value)) return value;
    if (code === 'STATE_CONFLICT' || message.includes('stale')) return 'interaction-stale' as const;
    return 'interaction-rejected' as const;
  };
  return result.ok
    ? {
        success: true as const,
        handled: true as const,
        bindingId: binding.definition.id,
        presentationKey: binding.definition.presentationKey,
        value: result.value,
      }
    : { success: false as const, reason: reason(result.message, result.code) };
}
