import type { ActorProfileInput } from '../gameplay/actor-profile';
import { isActorArchetype } from '../gameplay/ecs-entity-owner';
import type { ModItemAmount, ModItemDefinition, ModRecipeDefinition, ModVoxelDefinition } from './contracts';
import { createVoxelSemanticsRegistry } from '../../world/voxel-semantics';

const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const assertId = (id: string, kind: string) => {
  if (!NAMESPACE_ID.test(id)) throw new TypeError(`${kind} id must be namespace-qualified: ${id}`);
};

const freezeItemAmount = (amount: ModItemAmount, label: string): ModItemAmount => {
  if (!NAMESPACE_ID.test(amount.itemId)) throw new TypeError(`${label} item id is invalid: ${amount.itemId}`);
  if (!Number.isSafeInteger(amount.count) || amount.count <= 0) throw new TypeError(`${label} count must be positive.`);
  return Object.freeze({
    itemId: amount.itemId,
    count: amount.count,
    ...(amount.instance !== undefined ? { instance: Object.freeze({ ...amount.instance }) } : {}),
  });
};

export function createContentRegistration() {
  const items = new Map<string, ModItemDefinition>();
  const recipes = new Map<string, ModRecipeDefinition>();
  const voxels = new Map<string, ModVoxelDefinition>();
  const actorProfiles = new Map<string, ActorProfileInput>();
  return {
    items,
    recipes,
    voxels,
    actorProfiles,
    facade(assertRegistrationOpen: () => void) {
      return {
        registerItem(definition: ModItemDefinition): void {
          assertRegistrationOpen();
          assertId(definition.id, 'Item');
          if (!definition.name.trim()) throw new TypeError(`Item name is required: ${definition.id}`);
          if (!Number.isSafeInteger(definition.stackLimit) || definition.stackLimit <= 0)
            throw new TypeError(`Item stack limit is invalid: ${definition.id}`);
          if (items.has(definition.id)) throw new TypeError(`Duplicate item definition: ${definition.id}`);
          const storageId = definition.storageId ?? definition.id;
          if (
            !/^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._/-]*)?$/.test(storageId) ||
            [...items.values()].some((item) => (item.storageId ?? item.id) === storageId)
          )
            throw new TypeError(`Invalid or duplicate item storage ID: ${storageId}`);
          items.set(
            definition.id,
            Object.freeze({
              ...definition,
              ...(definition.durability ? { durability: Object.freeze({ ...definition.durability }) } : {}),
              ...(definition.capabilities
                ? {
                    capabilities: Object.freeze(definition.capabilities.map((value) => Object.freeze({ ...value }))),
                  }
                : {}),
            }),
          );
        },
        registerRecipe(definition: ModRecipeDefinition): void {
          assertRegistrationOpen();
          assertId(definition.id, 'Recipe');
          if (recipes.has(definition.id)) throw new TypeError(`Duplicate recipe definition: ${definition.id}`);
          if (definition.inputs.length === 0 || definition.outputs.length === 0)
            throw new TypeError(`Recipe inputs and outputs are required: ${definition.id}`);
          const inputs = Object.freeze(definition.inputs.map((entry) => freezeItemAmount(entry, definition.id)));
          const outputs = Object.freeze(definition.outputs.map((entry) => freezeItemAmount(entry, definition.id)));
          for (const amount of [...inputs, ...outputs])
            if (!items.has(amount.itemId)) throw new TypeError(`Recipe references unknown item: ${amount.itemId}`);
          const storageId = definition.storageId ?? definition.id;
          if (
            !/^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._/-]*)?$/.test(storageId) ||
            [...recipes.values()].some((recipe) => (recipe.storageId ?? recipe.id) === storageId)
          )
            throw new TypeError(`Invalid or duplicate recipe storage ID: ${storageId}`);
          recipes.set(definition.id, Object.freeze({ ...definition, inputs, outputs }));
        },
        registerVoxel(definition: ModVoxelDefinition): void {
          assertRegistrationOpen();
          if (voxels.has(definition.id)) throw new TypeError(`Duplicate voxel definition: ${definition.id}`);
          // Validate the full candidate set so ID/storage collisions cannot be
          // hidden until a later composition consumer asks for semantics.
          createVoxelSemanticsRegistry([...voxels.values(), definition]);
          voxels.set(definition.id, definition);
        },
        registerActorProfile(definition: ActorProfileInput): void {
          assertRegistrationOpen();
          if (!isActorArchetype(definition.archetype) || actorProfiles.has(definition.archetype))
            throw new TypeError(`Duplicate or invalid actor profile: ${String(definition.archetype)}`);
          actorProfiles.set(definition.archetype, definition);
        },
      };
    },
  };
}
