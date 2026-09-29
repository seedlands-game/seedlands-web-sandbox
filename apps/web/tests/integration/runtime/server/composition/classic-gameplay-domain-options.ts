import {
  assembleOverworldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { defineBlockActionsModule, definePack, type ModModule } from '@seedlands/stdlib/mod-api';
import type { GameplayCallbacks } from '@seedlands/stdlib/server/gameplay/gameplay-runtime';
import { pack } from '../../../../../../../playbooks/classic/src/pack';

type Profile = 'content' | 'inventory-actions' | 'block-rules';
const ROOT_MODULES: Readonly<Record<Profile, readonly string[]>> = Object.freeze({
  content: ['seedlands:overworld-content'],
  'inventory-actions': ['seedlands:inventory-actions-module'],
  'block-rules': ['seedlands:overworld-block-rules'],
});
const EXCLUDED_STRUCTURE_MODULES = new Set(['seedlands:overworld-structures', 'seedlands:overworld-structure-actions']);

export function classicGameplayDomainModules(
  roots: readonly string[],
  replacements: readonly ModModule[] = [],
): readonly ModModule[] {
  const replacementsById = new Map(replacements.map((module) => [module.descriptor.id, module]));
  const available = [
    ...pack.modules.map((module) => replacementsById.get(module.descriptor.id) ?? module),
    ...replacements.filter(
      (module) => !pack.modules.some((candidate) => candidate.descriptor.id === module.descriptor.id),
    ),
  ];
  const providers = new Map<string, string>();
  for (const module of available)
    for (const capability of module.descriptor.provides ?? []) providers.set(capability.id, module.descriptor.id);
  const selected = new Set<string>();
  const include = (moduleId: string): void => {
    if (selected.has(moduleId)) return;
    const module = available.find((candidate) => candidate.descriptor.id === moduleId);
    if (!module) throw new Error(`Classic gameplay test module is missing: ${moduleId}`);
    selected.add(moduleId);
    for (const requirement of module.descriptor.requires ?? []) {
      const provider = providers.get(requirement.id);
      if (!provider) throw new Error(`Classic gameplay test capability is missing: ${requirement.id}`);
      include(provider);
    }
  };
  roots.forEach(include);
  for (const moduleId of EXCLUDED_STRUCTURE_MODULES)
    if (selected.has(moduleId))
      throw new Error(`Classic gameplay domain fixture cannot install registered Structure: ${moduleId}`);
  return Object.freeze(available.filter((module) => selected.has(module.descriptor.id)));
}

/** Real Classic content without registered action modules outside these direct domain tests. */
export function classicGameplayDomainOptions(
  profile: Profile = 'content',
): Pick<GameplayCallbacks, 'composition' | 'moduleActorAuthority' | 'moduleSystemAuthority'> {
  const modules = classicGameplayDomainModules(
    ROOT_MODULES[profile],
    profile === 'block-rules' ? [defineBlockActionsModule()] : [],
  );
  const local = definePack({
    id: pack.manifest.id,
    version: pack.manifest.version,
    kind: pack.manifest.kind,
    entry: pack.manifest.entry,
    modules,
  });
  const composition = assembleOverworldPacks([
    {
      ...local,
      integrity: {
        algorithm: 'sha256',
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: [],
      },
    },
  ]);
  return Object.freeze({
    composition,
    moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
    moduleSystemAuthority: createGameplaySystemAuthority(composition),
  });
}
