import type { ModModuleDescriptor, PackDefinition, PackDefinitionInput, PackManifest } from './contracts';

const freezeArray = <Value>(values: readonly Value[]): readonly Value[] => Object.freeze([...values]);
const freezePermission = (permission: NonNullable<ModModuleDescriptor['permissions']>[number]) =>
  Object.freeze({ resource: permission.resource, operations: Object.freeze([...permission.operations]) });

export const normalizeModuleDescriptor = (descriptor: ModModuleDescriptor): ModModuleDescriptor =>
  Object.freeze({
    id: descriptor.id,
    version: descriptor.version,
    ...(descriptor.provides
      ? { provides: Object.freeze(descriptor.provides.map((entry) => Object.freeze({ ...entry }))) }
      : {}),
    ...(descriptor.requires
      ? { requires: Object.freeze(descriptor.requires.map((entry) => Object.freeze({ ...entry }))) }
      : {}),
    ...(descriptor.replaces
      ? { replaces: Object.freeze(descriptor.replaces.map((entry) => Object.freeze({ ...entry }))) }
      : {}),
    ...(descriptor.resources
      ? {
          resources: Object.freeze(
            descriptor.resources.map((entry) =>
              Object.freeze({ id: entry.id, operations: Object.freeze([...entry.operations]) }),
            ),
          ),
        }
      : {}),
    ...(descriptor.permissions ? { permissions: Object.freeze(descriptor.permissions.map(freezePermission)) } : {}),
  });

export function definePackDefinition(input: PackDefinitionInput): PackDefinition {
  const modules = freezeArray(input.modules ?? []);
  const manifest: PackManifest = Object.freeze({
    schemaVersion: 1,
    id: input.id,
    version: input.version,
    kind: input.kind,
    entry: input.entry ?? `./${input.id.replace(':', '-')}.mjs`,
    modules: Object.freeze(modules.map((entry) => entry.descriptor)),
    ...(input.dependencies ? { dependencies: freezeArray(input.dependencies) } : {}),
    ...(input.resources ? { resources: freezeArray(input.resources) } : {}),
    ...(input.presentation ? { presentation: Object.freeze({ ...input.presentation }) } : {}),
    ...(input.providerSelections ? { providerSelections: freezeArray(input.providerSelections) } : {}),
  });
  return Object.freeze({ manifest, modules });
}
