import type { KernelWorldgenProviderIdentity } from '../../../../../../packages/kernel/src/spatial/provider';

export const testWorldgenProvider = {
  id: 'test:worldgen',
  implementationVersion: '1.0.0',
  configurationIdentity: 'test',
  supportedGeneratorVersions: [2, 3, 4],
  artifactIdentity: 'test:fixture@1',
} as const satisfies KernelWorldgenProviderIdentity;
