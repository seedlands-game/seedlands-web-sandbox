import type { ArtifactIntegrityReceipt, ModulePermission, VerifiedPackArtifact, WorldComposition } from './contracts';
import { assembleWorldPacks } from './assembly';

export type ProductPackAdmission = Readonly<{
  id: string;
  version: string;
  integrity: ArtifactIntegrityReceipt;
  permissions: readonly ModulePermission[];
}>;
export type ProductExtensionAdmission = ProductPackAdmission;

export type AssembleProductPackOptions = Readonly<{
  approvedPlaybook?: ProductPackAdmission;
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

/** Exact local product examples, with host grants independent of their permission requests. */
export function assembleProductPacks(
  artifacts: readonly VerifiedPackArtifact[],
  options: AssembleProductPackOptions = {},
): WorldComposition {
  const playbooks = artifacts.filter((artifact) => artifact.manifest.kind === 'playbook');
  if (playbooks.length !== 1) throw new TypeError('Product requires one locked Playbook.');
  const playbook = playbooks[0];
  const admission = options.approvedPlaybook;
  if (
    !admission ||
    admission.id !== playbook.manifest.id ||
    admission.version !== playbook.manifest.version ||
    integrityKey(admission.integrity) !== integrityKey(playbook.integrity)
  )
    throw new TypeError(`Product Playbook has not been exactly approved by the host: ${playbook.manifest.id}`);
  const approvedPermissions: Record<string, readonly ModulePermission[]> = {
    [playbook.manifest.id]: admission.permissions,
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
