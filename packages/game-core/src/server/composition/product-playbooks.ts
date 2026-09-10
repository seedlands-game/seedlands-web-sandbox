import type { ArtifactIntegrityReceipt, ModulePermission, VerifiedPackArtifact, WorldComposition } from './contracts';
import { assembleWorldPacks } from './assembly';
import { OVERWORLD_PRODUCT_PERMISSIONS } from './gameplay-composition';

export const ALTERNATIVE_PRODUCT_PERMISSIONS: readonly ModulePermission[] = Object.freeze([
  { resource: 'seedlands.inventory', operations: ['read', 'write', 'execute'] },
  { resource: 'seedlands.inventory-item', operations: ['read', 'execute'] },
  { resource: 'seedlands.block-actor', operations: ['read', 'execute'] },
  { resource: 'seedlands.block-voxel', operations: ['read', 'execute'] },
  { resource: 'seedlands.block-clock', operations: ['read', 'execute'] },
  { resource: 'seedlands.ruleset', operations: ['read'] },
  { resource: 'seedlands.mode', operations: ['read', 'write', 'execute'] },
]);

export type ProductExtensionAdmission = Readonly<{
  id: string;
  version: string;
  integrity: ArtifactIntegrityReceipt;
  permissions: readonly ModulePermission[];
}>;

export type AssembleProductPackOptions = Readonly<{
  approvedExtensions?: readonly ProductExtensionAdmission[];
}>;

const integrityKey = (integrity: ArtifactIntegrityReceipt): string =>
  JSON.stringify({
    algorithm: integrity.algorithm,
    manifestDigest: integrity.manifestDigest,
    entryDigest: integrity.entryDigest,
    resources: [...integrity.resources]
      .map((resource) => ({ path: resource.path, digest: resource.digest }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  });

const productPermissions = (playbookId: string): readonly ModulePermission[] => {
  if (playbookId === 'seedlands:overworld') return OVERWORLD_PRODUCT_PERMISSIONS;
  if (playbookId === 'seedlands:click-conversion' || playbookId === 'seedlands:builder')
    return ALTERNATIVE_PRODUCT_PERMISSIONS;
  throw new TypeError('Product Playbook has not been approved by the host.');
};

/** Exact local product examples, with host grants independent of their permission requests. */
export function assembleProductPacks(
  artifacts: readonly VerifiedPackArtifact[],
  options: AssembleProductPackOptions = {},
): WorldComposition {
  const playbooks = artifacts.filter((artifact) => artifact.manifest.kind === 'playbook');
  if (playbooks.length !== 1) throw new TypeError('Product requires one locked Playbook.');
  const playbookId = playbooks[0].manifest.id;
  const approvedPermissions: Record<string, readonly ModulePermission[]> = {
    [playbookId]: productPermissions(playbookId),
  };
  const admissions = new Map<string, ProductExtensionAdmission>();
  for (const admission of options.approvedExtensions ?? []) {
    if (admissions.has(admission.id)) throw new TypeError(`Duplicate product extension admission: ${admission.id}`);
    admissions.set(admission.id, admission);
  }
  const used = new Set<string>();
  for (const artifact of artifacts) {
    if (artifact === playbooks[0]) continue;
    const admission = admissions.get(artifact.manifest.id);
    if (
      !admission ||
      artifact.manifest.kind !== 'extension' ||
      admission.version !== artifact.manifest.version ||
      integrityKey(admission.integrity) !== integrityKey(artifact.integrity)
    )
      throw new TypeError(`Product extension has not been exactly approved by the host: ${artifact.manifest.id}`);
    used.add(admission.id);
    approvedPermissions[admission.id] = admission.permissions;
  }
  for (const id of admissions.keys())
    if (!used.has(id)) throw new TypeError(`Approved product extension artifact is missing: ${id}`);
  return assembleWorldPacks(artifacts, {
    approvedPermissions,
  });
}
