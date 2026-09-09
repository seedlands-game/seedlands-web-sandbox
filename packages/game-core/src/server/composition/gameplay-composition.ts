import type { WorldComposition, VerifiedPackArtifact } from './contracts';
import { assembleWorldPacks } from './assembly';
import { resolveGameplayContent, type GameplayContent } from '../gameplay/gameplay-content';
import type { MeleeDefinition } from '../gameplay/combat-runtime';
import { createCompositionCheckpointGuard } from './checkpoint-identity';

export const gameplayContentForComposition = (composition: WorldComposition): GameplayContent =>
  composition.capability<Readonly<{ resolve(): GameplayContent }>>('seedlands:gameplay-content').resolve();

/** Product-approved grants are host policy, never copied from a Pack permission request. */
export function assembleOverworldPacks(artifacts: readonly VerifiedPackArtifact[]): WorldComposition {
  if (artifacts.length !== 1 || artifacts[0].manifest.id !== 'seedlands:overworld')
    throw new TypeError('Default product expects the locked Overworld Playbook.');
  return assembleWorldPacks(artifacts, {
    approvedPermissions: {
      'seedlands:overworld': [
        { resource: 'seedlands.inventory', operations: ['read', 'write', 'execute'] },
        { resource: 'seedlands.inventory-item', operations: ['read', 'execute'] },
        { resource: 'seedlands.ruleset', operations: ['read'] },
        { resource: 'seedlands.needs', operations: ['read', 'write', 'execute'] },
        { resource: 'seedlands.combat', operations: ['read', 'execute'] },
        { resource: 'seedlands.combat-clock', operations: ['read', 'execute'] },
        { resource: 'seedlands.mode', operations: ['read', 'write', 'execute'] },
      ],
    },
  });
}

export function resolveGameplayComposition(
  input: Readonly<{
    composition?: WorldComposition;
    content?: GameplayContent;
    meleeDefinitions?: readonly MeleeDefinition[];
    allowLegacyCompositionMigration?: boolean;
  }>,
) {
  if (input.composition && (input.content || input.meleeDefinitions))
    throw new TypeError('Composition owns gameplay content; parallel content inputs are forbidden.');
  return {
    guard: input.composition
      ? createCompositionCheckpointGuard(input.composition, input.allowLegacyCompositionMigration)
      : null,
    content: input.composition
      ? gameplayContentForComposition(input.composition)
      : resolveGameplayContent(input.content, input.meleeDefinitions),
  };
}
