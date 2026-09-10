import type { VerifiedPackArtifact, WorldComposition } from './contracts';
import { assembleWorldPacks } from './assembly';
import { assembleOverworldPacks } from './gameplay-composition';

/** Exact local product examples, with host grants independent of their permission requests. */
export function assembleProductPacks(artifacts: readonly VerifiedPackArtifact[]): WorldComposition {
  if (artifacts.length !== 1) throw new TypeError('Product requires one locked Playbook.');
  const id = artifacts[0].manifest.id;
  if (id === 'seedlands:overworld') return assembleOverworldPacks(artifacts);
  if (id !== 'seedlands:click-conversion' && id !== 'seedlands:builder')
    throw new TypeError('Product Playbook has not been approved by the host.');
  return assembleWorldPacks(artifacts, {
    approvedPermissions: {
      [id]: [
        { resource: 'seedlands.inventory', operations: ['read', 'write', 'execute'] },
        { resource: 'seedlands.inventory-item', operations: ['read', 'execute'] },
        { resource: 'seedlands.block-actor', operations: ['read', 'execute'] },
        { resource: 'seedlands.block-voxel', operations: ['read', 'execute'] },
        { resource: 'seedlands.block-clock', operations: ['read', 'execute'] },
        { resource: 'seedlands.ruleset', operations: ['read'] },
        { resource: 'seedlands.mode', operations: ['read', 'write', 'execute'] },
      ],
    },
  });
}
