import type { PackManifest, ModModule } from '@seedlands/stdlib/mod-api';
import type { ProductExtensionAdmission, VerifiedPackArtifact } from '@seedlands/stdlib/server/composition/host-api';

type FileLock = Readonly<{ path: string; sha256: string }>;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const fileLock = (value: unknown): FileLock => {
  if (
    !object(value) ||
    typeof value.path !== 'string' ||
    typeof value.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(value.sha256) ||
    !/^(?:\.\/)?[a-zA-Z0-9_-][a-zA-Z0-9._/-]*$/.test(value.path) ||
    value.path.split('/').some((part) => part === '..' || part === '')
  )
    throw new TypeError('Invalid Pack file lock.');
  return { path: value.path, sha256: value.sha256.toLowerCase() };
};
const hash = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
const decode = (bytes: Uint8Array<ArrayBuffer>) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const read = async (url: URL, limit: number) => {
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Pack asset failed: ${url.pathname}: ${response.status}`);
  if (!response.body) throw new Error(`Pack asset body missing: ${url.pathname}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new RangeError('Pack asset exceeds its byte limit.');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value);
const artifactPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(?:\.\/)?[a-zA-Z0-9_-][a-zA-Z0-9._/-]*$/.test(value) &&
  !value.split('/').some((part) => part === '..' || part === '');
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const operations = new Set(['read', 'execute', 'write', 'control', 'export', 'restore']);

/** Reads host-owned extension grants independently of Pack-authored permission requests. */
export async function loadBrowserHostAdmissions(url: URL): Promise<readonly ProductExtensionAdmission[]> {
  if (url.origin !== location.origin) throw new TypeError('Pack host admission must use the product origin.');
  const source: unknown = JSON.parse(decode(await read(url, 262_144)));
  if (!object(source) || !exactKeys(source, ['schemaVersion', 'extensions']) || source.schemaVersion !== 1)
    throw new TypeError('Pack host admission schema is invalid.');
  if (!Array.isArray(source.extensions) || source.extensions.length > 15)
    throw new TypeError('Pack host admission extension list is invalid.');
  const seen = new Set<string>();
  const admissions: ProductExtensionAdmission[] = [];
  for (const entry of source.extensions) {
    if (
      !object(entry) ||
      !exactKeys(entry, ['id', 'version', 'integrity', 'permissions']) ||
      !identifier(entry.id) ||
      !identifier(entry.version) ||
      !object(entry.integrity) ||
      !exactKeys(entry.integrity, ['algorithm', 'manifestDigest', 'entryDigest', 'resources']) ||
      entry.integrity.algorithm !== 'sha256' ||
      !digest(entry.integrity.manifestDigest) ||
      !digest(entry.integrity.entryDigest) ||
      !Array.isArray(entry.integrity.resources) ||
      entry.integrity.resources.length > 128 ||
      !Array.isArray(entry.permissions) ||
      entry.permissions.length > 128 ||
      seen.has(entry.id)
    )
      throw new TypeError('Pack host admission entry is invalid.');
    const resources = entry.integrity.resources.map((resource) => {
      if (
        !object(resource) ||
        !exactKeys(resource, ['path', 'digest']) ||
        !artifactPath(resource.path) ||
        !digest(resource.digest)
      )
        throw new TypeError('Pack host admission resource is invalid.');
      return Object.freeze({ path: resource.path, digest: resource.digest.toLowerCase() });
    });
    if (new Set(resources.map((resource) => resource.path)).size !== resources.length)
      throw new TypeError('Pack host admission resource is duplicated.');
    const permissions = entry.permissions.map((permission) => {
      if (
        !object(permission) ||
        !exactKeys(permission, ['resource', 'operations']) ||
        !identifier(permission.resource) ||
        !Array.isArray(permission.operations) ||
        !permission.operations.length ||
        permission.operations.length > operations.size ||
        !permission.operations.every((operation) => typeof operation === 'string' && operations.has(operation)) ||
        new Set(permission.operations).size !== permission.operations.length
      )
        throw new TypeError('Pack host admission permission is invalid.');
      return Object.freeze({
        resource: permission.resource,
        operations: Object.freeze([
          ...permission.operations,
        ]) as ProductExtensionAdmission['permissions'][number]['operations'],
      });
    });
    seen.add(entry.id);
    admissions.push(
      Object.freeze({
        id: entry.id,
        version: entry.version,
        integrity: Object.freeze({
          algorithm: 'sha256' as const,
          manifestDigest: entry.integrity.manifestDigest.toLowerCase(),
          entryDigest: entry.integrity.entryDigest.toLowerCase(),
          resources: Object.freeze(resources),
        }),
        permissions: Object.freeze(permissions),
      }),
    );
  }
  return Object.freeze(admissions);
}

/** Loads the locally built, closed ESM artifacts; all locked bytes are checked before any module import. */
const sameIntegrity = (
  left: VerifiedPackArtifact['integrity'],
  right: ProductExtensionAdmission['integrity'],
): boolean =>
  left.algorithm === right.algorithm &&
  left.manifestDigest === right.manifestDigest &&
  left.entryDigest === right.entryDigest &&
  JSON.stringify([...left.resources].sort((a, b) => a.path.localeCompare(b.path))) ===
    JSON.stringify([...right.resources].sort((a, b) => a.path.localeCompare(b.path)));

export async function loadBrowserPackArtifacts(
  lockUrl: URL,
  approvedExtensions: readonly ProductExtensionAdmission[],
): Promise<readonly VerifiedPackArtifact[]> {
  if (lockUrl.origin !== location.origin) throw new TypeError('Pack lock must use the product origin.');
  const lock: unknown = JSON.parse(decode(await read(lockUrl, 262_144)));
  if (
    !object(lock) ||
    lock.schemaVersion !== 1 ||
    !Array.isArray(lock.packs) ||
    !lock.packs.length ||
    lock.packs.length > 16
  )
    throw new TypeError('Pack lock schema is invalid.');
  const verified = async (file: FileLock) => {
    const bytes = await read(new URL(file.path, lockUrl), 8_388_608);
    if ((await hash(bytes)) !== file.sha256) throw new TypeError(`Pack digest mismatch: ${file.path}`);
    return bytes;
  };
  const staged = [];
  for (const raw of lock.packs) {
    if (!object(raw) || !Array.isArray(raw.resources) || raw.resources.length > 128)
      throw new TypeError('Pack lock entry is invalid.');
    const manifestFile = fileLock(raw.manifest),
      entryFile = fileLock(raw.entry);
    const manifest: unknown = JSON.parse(decode(await verified(manifestFile)));
    if (
      !object(manifest) ||
      manifest.schemaVersion !== 1 ||
      manifest.id !== raw.id ||
      manifest.version !== raw.version ||
      manifest.entry !== entryFile.path ||
      !Array.isArray(manifest.modules)
    )
      throw new TypeError('Pack manifest and lock disagree.');
    const resourceLocks = raw.resources.map(fileLock);
    const expected = manifest.resources ?? [];
    if (
      !Array.isArray(expected) ||
      JSON.stringify([...expected].sort()) !== JSON.stringify(resourceLocks.map((file) => file.path).sort()) ||
      new Set(expected).size !== expected.length
    )
      throw new TypeError('Pack resource lock does not match manifest.');
    const bytes = await verified(entryFile);
    for (const file of resourceLocks) await verified(file);
    staged.push({
      manifest: manifest as PackManifest,
      bytes,
      integrity: {
        algorithm: 'sha256' as const,
        manifestDigest: manifestFile.sha256,
        entryDigest: entryFile.sha256,
        resources: resourceLocks.map((file) => ({ path: file.path, digest: file.sha256 })),
      },
    });
  }
  const artifacts: VerifiedPackArtifact[] = [];
  for (const entry of staged) {
    if (
      entry.manifest.kind === 'extension' &&
      !approvedExtensions.some(
        (admission) =>
          admission.id === entry.manifest.id &&
          admission.version === entry.manifest.version &&
          sameIntegrity(entry.integrity, admission.integrity),
      )
    )
      throw new TypeError(`Pack extension is not host-approved: ${entry.manifest.id}.`);
    const url = URL.createObjectURL(new Blob([entry.bytes], { type: 'text/javascript' }));
    try {
      const namespace: unknown = await import(/* @vite-ignore */ url);
      if (
        !object(namespace) ||
        !object(namespace.pack) ||
        !Array.isArray(namespace.pack.modules) ||
        !namespace.pack.modules.every(
          (module: unknown) => object(module) && object(module.descriptor) && typeof module.register === 'function',
        )
      )
        throw new TypeError('Pack entry must export module definitions.');
      artifacts.push(
        Object.freeze({
          manifest: entry.manifest,
          modules: Object.freeze(namespace.pack.modules as ModModule[]),
          integrity: entry.integrity,
        }),
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return Object.freeze(artifacts);
}

export async function loadBrowserProductAssembly(packDirectory: URL): Promise<
  Readonly<{
    artifacts: readonly VerifiedPackArtifact[];
    approvedExtensions: readonly ProductExtensionAdmission[];
  }>
> {
  if (packDirectory.origin !== location.origin) throw new TypeError('Pack directory must use the product origin.');
  const approvedExtensions = await loadBrowserHostAdmissions(new URL('host-admissions.json', packDirectory));
  const artifacts = await loadBrowserPackArtifacts(new URL('packs.lock.json', packDirectory), approvedExtensions);
  return Object.freeze({ artifacts, approvedExtensions });
}
