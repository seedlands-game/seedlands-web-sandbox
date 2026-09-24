const permission = (resource, operations) => Object.freeze({ resource, operations: Object.freeze(operations) });

const overworldPermissions = Object.freeze([
  permission('seedlands.station', ['read', 'execute']),
  permission('seedlands.station-actor', ['read', 'execute']),
  permission('seedlands.forage-clock', ['read', 'execute']),
  permission('seedlands.furnace-clock', ['read', 'execute']),
  permission('seedlands.inventory', ['read', 'write', 'execute']),
  permission('seedlands.feeding-actor', ['read', 'execute']),
  permission('seedlands.feeding-item', ['read', 'execute']),
  permission('seedlands.inventory-item', ['read', 'execute']),
  permission('seedlands.block-actor', ['read', 'execute']),
  permission('seedlands.block-voxel', ['read', 'execute']),
  permission('seedlands.block-clock', ['read', 'execute']),
  permission('seedlands.ruleset', ['read']),
  permission('seedlands.needs', ['read', 'write', 'execute']),
  permission('seedlands.combat', ['read', 'execute']),
  permission('seedlands.combat-clock', ['read', 'execute']),
  permission('seedlands.mode', ['read', 'write', 'execute']),
  permission('seedlands.media-playback', ['read', 'write', 'execute']),
]);

const alternativePermissions = Object.freeze([
  permission('seedlands.inventory', ['read', 'write', 'execute']),
  permission('seedlands.inventory-item', ['read', 'execute']),
  permission('seedlands.block-actor', ['read', 'execute']),
  permission('seedlands.block-voxel', ['read', 'execute']),
  permission('seedlands.block-clock', ['read', 'execute']),
  permission('seedlands.ruleset', ['read']),
  permission('seedlands.mode', ['read', 'write', 'execute']),
]);

const grants = Object.freeze({
  'seedlands:overworld': overworldPermissions,
  'seedlands:click-conversion': alternativePermissions,
  'seedlands:builder': alternativePermissions,
  'sample:modular-world': alternativePermissions,
});

export function permissionsForProductPlaybook(id) {
  const permissions = grants[id];
  if (!permissions) throw new TypeError(`No host permission grant is configured for Playbook: ${id}`);
  return permissions;
}
