import { describe, expect, it } from 'vitest';
import { definePack } from '@seedlands/stdlib/mod-api';
import {
  assembleProductPacks,
  type ArtifactIntegrityReceipt,
  type ProductExtensionAdmission,
  type VerifiedPackArtifact,
  OVERWORLD_PRODUCT_PERMISSIONS,
} from '@seedlands/stdlib/host';
import { pack as overworld } from '../../../../../../../playbooks/classic/src/pack';

const integrity = (manifest: string, entry: string): ArtifactIntegrityReceipt => ({
  algorithm: 'sha256',
  manifestDigest: manifest.repeat(64),
  entryDigest: entry.repeat(64),
  resources: [],
});
const artifact = (pack: ReturnType<typeof definePack>, receipt: ArtifactIntegrityReceipt): VerifiedPackArtifact => ({
  ...pack,
  integrity: receipt,
});

describe('product extension admission', () => {
  const base = artifact(overworld, {
    ...integrity('a', 'b'),
    resources: (overworld.manifest.resources ?? []).map((path) => ({ path, digest: 'f'.repeat(64) })),
  });
  const extensionDefinition = definePack({
    id: 'sample:camp-work',
    version: '1.0.0',
    kind: 'extension',
  });
  const extensionIntegrity = integrity('c', 'd');
  const extension = artifact(extensionDefinition, extensionIntegrity);
  const approvedPlaybook = {
    id: overworld.manifest.id,
    version: overworld.manifest.version,
    integrity: base.integrity,
    permissions: OVERWORLD_PRODUCT_PERMISSIONS,
  };
  const admission: ProductExtensionAdmission = {
    id: extensionDefinition.manifest.id,
    version: extensionDefinition.manifest.version,
    integrity: extensionIntegrity,
    permissions: [],
  };

  it('keeps the product closed to extra Packs by default', () => {
    expect(() => assembleProductPacks([base, extension], { approvedPlaybook })).toThrow(/exactly approved/i);
  });

  it('admits an extension only with an exact host-frozen identity and integrity receipt', () => {
    const composition = assembleProductPacks([base, extension], { approvedPlaybook, approvedExtensions: [admission] });
    expect(composition.packOrder).toContain('sample:camp-work');
    expect(composition.moduleBindings).not.toHaveProperty('sample:camp-work');

    expect(() =>
      assembleProductPacks([base, extension], {
        approvedPlaybook,
        approvedExtensions: [{ ...admission, integrity: { ...extensionIntegrity, entryDigest: 'e'.repeat(64) } }],
      }),
    ).toThrow(/exactly approved/i);
  });

  it('rejects stale or duplicate admissions even when no artifact consumes them', () => {
    expect(() => assembleProductPacks([base], { approvedPlaybook, approvedExtensions: [admission] })).toThrow(
      /artifact is missing/i,
    );
    expect(() =>
      assembleProductPacks([base, extension], { approvedPlaybook, approvedExtensions: [admission, admission] }),
    ).toThrow(/duplicate/i);
  });
});
