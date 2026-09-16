import type { ModulePermission, WorldComposition, VerifiedPackArtifact } from './contracts';
import { assembleWorldPacks } from './assembly';
import { resolveGameplayContent, type GameplayContent } from '../gameplay/gameplay-content';
import type { MeleeDefinition } from '../gameplay/combat-runtime';
import { createCompositionCheckpointGuard } from './checkpoint-identity';
import type { CompositionCheckpointIdentity } from './checkpoint-identity';
import { gameplayContentFromComposition } from '../gameplay/modules/content-capabilities';
import { BLOCK_RULES_CAPABILITY } from '../gameplay/modules/block-action-model';
import type { BlockRulesCapabilityV1 } from '../gameplay/modules/block-rules-module';
import { createVoxelGameplayRegistry } from '../gameplay/voxel-gameplay';

const contentByComposition = new WeakMap<WorldComposition, GameplayContent>();

export const gameplayContentForComposition = (composition: WorldComposition): GameplayContent => {
  const existing = contentByComposition.get(composition);
  if (existing) return existing;
  const base = gameplayContentFromComposition(composition);
  const blockRules = composition.definitionMap.capabilities.some(({ id }) => id === BLOCK_RULES_CAPABILITY)
    ? composition.capability<BlockRulesCapabilityV1>(BLOCK_RULES_CAPABILITY)
    : null;
  const content = Object.freeze({
    ...base,
    voxelGameplay: createVoxelGameplayRegistry(blockRules?.definitions),
  });
  contentByComposition.set(composition, content);
  return content;
};

/** Product-approved grants are host policy, never copied from a Pack permission request. */
export const OVERWORLD_PRODUCT_PERMISSIONS: readonly ModulePermission[] = Object.freeze([
  { resource: 'seedlands.station', operations: ['read', 'execute'] },
  { resource: 'seedlands.station-actor', operations: ['read', 'execute'] },
  { resource: 'seedlands.forage-clock', operations: ['read', 'execute'] },
  { resource: 'seedlands.furnace-clock', operations: ['read', 'execute'] },
  { resource: 'seedlands.inventory', operations: ['read', 'write', 'execute'] },
  { resource: 'seedlands.feeding-actor', operations: ['read', 'execute'] },
  { resource: 'seedlands.feeding-item', operations: ['read', 'execute'] },
  { resource: 'seedlands.inventory-item', operations: ['read', 'execute'] },
  { resource: 'seedlands.block-actor', operations: ['read', 'execute'] },
  { resource: 'seedlands.block-voxel', operations: ['read', 'execute'] },
  { resource: 'seedlands.block-clock', operations: ['read', 'execute'] },
  { resource: 'seedlands.ruleset', operations: ['read'] },
  { resource: 'seedlands.needs', operations: ['read', 'write', 'execute'] },
  { resource: 'seedlands.combat', operations: ['read', 'execute'] },
  { resource: 'seedlands.combat-clock', operations: ['read', 'execute'] },
  { resource: 'seedlands.mode', operations: ['read', 'write', 'execute'] },
]);

export function assembleOverworldPacks(artifacts: readonly VerifiedPackArtifact[]): WorldComposition {
  if (artifacts.length !== 1 || artifacts[0].manifest.id !== 'seedlands:overworld')
    throw new TypeError('Default product expects the locked Overworld Playbook.');
  return assembleWorldPacks(artifacts, {
    approvedPermissions: {
      'seedlands:overworld': OVERWORLD_PRODUCT_PERMISSIONS,
    },
  });
}

export function resolveGameplayComposition(
  input: Readonly<{
    composition?: WorldComposition;
    content?: GameplayContent;
    meleeDefinitions?: readonly MeleeDefinition[];
    legacyCompositionIdentity?: CompositionCheckpointIdentity;
  }>,
) {
  if (input.composition && (input.content || input.meleeDefinitions))
    throw new TypeError('Composition owns gameplay content; parallel content inputs are forbidden.');
  return {
    guard: input.composition
      ? createCompositionCheckpointGuard(input.composition, input.legacyCompositionIdentity)
      : null,
    content: input.composition
      ? gameplayContentForComposition(input.composition)
      : resolveGameplayContent(input.content, input.meleeDefinitions),
  };
}
