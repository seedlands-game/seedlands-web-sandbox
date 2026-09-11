import type { KernelValue } from '../registry/contracts';

export const KERNEL_CHUNK_SIZE = 32;
export const KERNEL_CHUNK_VOXEL_COUNT = KERNEL_CHUNK_SIZE ** 3;

export type KernelChunkCoordinate = Readonly<{ x: number; y: number; z: number }>;

export type KernelWorldgenProviderIdentity = Readonly<{
  id: string;
  implementationVersion: string;
  configurationIdentity: string;
  supportedGeneratorVersions: readonly number[];
  artifactIdentity: string;
}>;

export type KernelWorldgenGenerateInput = Readonly<{
  seed: number;
  generatorVersion: number;
  coordinate: KernelChunkCoordinate;
  epoch: number;
  revision: number;
}>;

export type KernelWorldgenSampleInput = Readonly<{
  seed: number;
  generatorVersion: number;
  x: number;
  y: number;
  z: number;
}>;

export type KernelGeneratedChunk = Readonly<{
  coordinate: KernelChunkCoordinate;
  provider: KernelWorldgenProviderIdentity;
  generatorVersion: number;
  epoch: number;
  revision: number;
  voxels: Uint16Array;
  metadata?: KernelValue;
}>;

export type KernelWorldgenProvider = Readonly<{
  identity: KernelWorldgenProviderIdentity;
  generate(input: KernelWorldgenGenerateInput): KernelGeneratedChunk;
  sampleVoxel(input: KernelWorldgenSampleInput): number;
}>;

export type KernelWorldgenProviderRegistry = Readonly<{
  resolve(identity: KernelWorldgenProviderIdentity, generatorVersion: number): KernelWorldgenProvider;
}>;

const assertIdentityFields = (identity: KernelWorldgenProviderIdentity) => {
  if (
    !identity ||
    !identity.id?.trim() ||
    !identity.implementationVersion?.trim() ||
    !identity.configurationIdentity?.trim() ||
    !identity.artifactIdentity?.trim()
  )
    throw new TypeError('World-generation provider identity is incomplete.');
  if (
    !Array.isArray(identity.supportedGeneratorVersions) ||
    identity.supportedGeneratorVersions.length === 0 ||
    identity.supportedGeneratorVersions.some((version) => !Number.isSafeInteger(version) || version < 0) ||
    new Set(identity.supportedGeneratorVersions).size !== identity.supportedGeneratorVersions.length
  )
    throw new TypeError('World-generation provider versions are invalid.');
};

export function freezeWorldgenProviderIdentity(
  identity: KernelWorldgenProviderIdentity,
): KernelWorldgenProviderIdentity {
  assertIdentityFields(identity);
  return Object.freeze({
    ...identity,
    supportedGeneratorVersions: Object.freeze([...identity.supportedGeneratorVersions].sort((a, b) => a - b)),
  });
}

export function worldgenProviderIdentityKey(identity: KernelWorldgenProviderIdentity): string {
  const frozen = freezeWorldgenProviderIdentity(identity);
  return JSON.stringify({
    id: frozen.id,
    implementationVersion: frozen.implementationVersion,
    configurationIdentity: frozen.configurationIdentity,
    supportedGeneratorVersions: frozen.supportedGeneratorVersions,
    artifactIdentity: frozen.artifactIdentity,
  });
}

export function freezeWorldgenProvider(provider: KernelWorldgenProvider): KernelWorldgenProvider {
  if (typeof provider?.generate !== 'function' || typeof provider?.sampleVoxel !== 'function')
    throw new TypeError('World-generation provider executable ports are incomplete.');
  return Object.freeze({
    identity: freezeWorldgenProviderIdentity(provider.identity),
    generate: provider.generate,
    sampleVoxel: provider.sampleVoxel,
  });
}

export function requireWorldgenProvider(provider: KernelWorldgenProvider | undefined): KernelWorldgenProvider {
  if (!provider) throw new Error('This Kernel world has no world-generation provider.');
  return provider;
}

export function assertWorldgenProviderIdentity(
  expected: KernelWorldgenProviderIdentity,
  candidate: KernelWorldgenProviderIdentity,
  generatorVersion: number,
): void {
  assertIdentityFields(expected);
  assertIdentityFields(candidate);
  if (
    expected.id !== candidate.id ||
    expected.implementationVersion !== candidate.implementationVersion ||
    expected.configurationIdentity !== candidate.configurationIdentity ||
    expected.artifactIdentity !== candidate.artifactIdentity ||
    expected.supportedGeneratorVersions.length !== candidate.supportedGeneratorVersions.length ||
    expected.supportedGeneratorVersions.some(
      (version, index) => version !== candidate.supportedGeneratorVersions[index],
    ) ||
    !expected.supportedGeneratorVersions.includes(generatorVersion)
  )
    throw new Error('World-generation provider identity does not match the active Kernel world.');
}

export function createWorldgenProviderRegistry(
  providers: readonly KernelWorldgenProvider[],
): KernelWorldgenProviderRegistry {
  const byId = new Map<string, KernelWorldgenProvider>();
  for (const candidate of providers) {
    const provider = freezeWorldgenProvider(candidate);
    if (byId.has(provider.identity.id))
      throw new TypeError(`World-generation provider id is duplicated: ${provider.identity.id}.`);
    byId.set(provider.identity.id, provider);
  }
  return Object.freeze({
    resolve(identity: KernelWorldgenProviderIdentity, generatorVersion: number) {
      const provider = byId.get(identity.id);
      if (!provider) throw new Error(`No local executable world-generation provider is registered for ${identity.id}.`);
      assertWorldgenProviderIdentity(provider.identity, identity, generatorVersion);
      return provider;
    },
  });
}

export function assertGeneratedChunk(
  expected: Readonly<{
    provider: KernelWorldgenProviderIdentity;
    generatorVersion: number;
    epoch: number;
    revision: number;
    coordinate: KernelChunkCoordinate;
  }>,
  candidate: KernelGeneratedChunk,
): void {
  assertWorldgenProviderIdentity(expected.provider, candidate.provider, expected.generatorVersion);
  if (
    candidate.generatorVersion !== expected.generatorVersion ||
    candidate.epoch !== expected.epoch ||
    candidate.revision !== expected.revision ||
    candidate.coordinate.x !== expected.coordinate.x ||
    candidate.coordinate.y !== expected.coordinate.y ||
    candidate.coordinate.z !== expected.coordinate.z
  )
    throw new Error('Generated chunk identity does not match the active Kernel world request.');
  if (!(candidate.voxels instanceof Uint16Array) || candidate.voxels.length !== KERNEL_CHUNK_VOXEL_COUNT)
    throw new Error('Generated chunk voxel artifact is invalid.');
}

export function sampleWorldgenVoxel(provider: KernelWorldgenProvider, input: KernelWorldgenSampleInput): number {
  if (!provider.identity.supportedGeneratorVersions.includes(input.generatorVersion))
    throw new Error('World-generation provider does not support the requested generator version.');
  if (![input.seed, input.x, input.y, input.z].every(Number.isSafeInteger))
    throw new TypeError('World-generation voxel sample coordinates are invalid.');
  const voxel = provider.sampleVoxel(input);
  if (!Number.isSafeInteger(voxel) || voxel < 0 || voxel > 0xffff)
    throw new Error('World-generation provider returned an invalid voxel sample.');
  return voxel;
}
