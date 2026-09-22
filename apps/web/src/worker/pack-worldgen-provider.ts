import { assembleProductPacks, worldgenProviderForComposition } from '@seedlands/stdlib/host';
import { loadBrowserProductAssembly } from './pack-loader';

/** Loads the executable worldgen port from the same verified Pack lock used by Authority. */
export async function loadBrowserPackWorldgenProvider() {
  const product = await loadBrowserProductAssembly(new URL(`${import.meta.env.BASE_URL}packs/`, location.origin));
  return worldgenProviderForComposition(
    assembleProductPacks(product.artifacts, {
      approvedPlaybook: product.approvedPlaybook,
      approvedExtensions: product.approvedExtensions,
    }),
  );
}
