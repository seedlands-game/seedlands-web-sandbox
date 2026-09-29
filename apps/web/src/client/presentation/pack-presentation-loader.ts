export type PackPresentationVoxel = Readonly<{ id: string; texture: string; material: string }>;
export type PackPresentationItem = Readonly<{ id: string; model: string; icon: string; material?: string }>;
export type PackPresentationActor = Readonly<{ id: string; model: string; texture: string }>;
export type PackPresentationMaterial = Readonly<{
  id: string;
  faceMaterial: number;
  texture: string;
  renderMode: 'opaque' | 'cutout' | 'transparent';
}>;
export type PackPresentationCatalog = Readonly<{
  voxels: Readonly<Record<string, PackPresentationVoxel>>;
  items: Readonly<Record<string, PackPresentationItem>>;
  actors: Readonly<Record<string, PackPresentationActor>>;
  materials: Readonly<Record<string, PackPresentationMaterial>>;
  assetUrls: Readonly<Record<string, string>>;
  dispose(): void;
}>;

type FileLock = Readonly<{ path: string; sha256: string }>;
type ResourceLock = FileLock & Readonly<{ size: number; contentType: string }>;
const MAX_PACKS = 16;
const MAX_ENTRIES = 512;
const MAX_RESOURCE_LOCKS = 128;
const MAX_BYTES = 1_048_576;
const MAX_RESOURCE_LOCK_BYTES = 32 * 1024 * 1024;
const path = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^(?:\.\/)?[a-zA-Z0-9_-][a-zA-Z0-9._/-]*$/.test(value) &&
  !value.split('/').some((part) => part === '..' || part === '');
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const assetReference = (value: string) =>
  value.startsWith('builtin:') ? /^[a-z0-9][a-z0-9._:/-]{0,191}$/.test(value.slice('builtin:'.length)) : path(value);
const hash = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
const mediaType = (resourcePath: string) =>
  resourcePath.endsWith('.svg')
    ? 'image/svg+xml'
    : resourcePath.endsWith('.png')
      ? 'image/png'
      : resourcePath.endsWith('.webp')
        ? 'image/webp'
        : resourcePath.endsWith('.glb')
          ? 'model/gltf-binary'
          : 'application/octet-stream';

async function read(url: URL): Promise<Uint8Array> {
  if (url.origin !== location.origin) throw new TypeError('Pack presentation must use the product origin.');
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Pack asset failed: ${url.pathname}: ${response.status}`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES)
    throw new RangeError('Pack presentation exceeds its byte limit.');
  if (!response.body) throw new Error(`Pack asset body missing: ${url.pathname}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) throw new RangeError('Pack presentation exceeds its byte limit.');
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
}

const lockedFileFields = (value: unknown): FileLock => {
  if (!object(value) || !path(value.path) || !digest(value.sha256))
    throw new TypeError('Pack presentation file lock is invalid.');
  return { path: value.path.replace(/^\.\//, ''), sha256: value.sha256.toLowerCase() };
};

function fileLock(value: unknown): FileLock {
  if (!object(value) || !exactKeys(value, ['path', 'sha256']))
    throw new TypeError('Pack presentation file lock is invalid.');
  return lockedFileFields(value);
}

const lockedContentType = (resourcePath: string) =>
  resourcePath.toLowerCase().endsWith('.mp3')
    ? 'audio/mpeg'
    : resourcePath.toLowerCase().endsWith('.json')
      ? 'application/json'
      : 'application/octet-stream';

function resourceLock(value: unknown): ResourceLock {
  if (!object(value) || !exactKeys(value, ['path', 'sha256', 'size', 'contentType']))
    throw new TypeError('Pack presentation resource lock is invalid.');
  const file = lockedFileFields(value);
  if (
    !Number.isSafeInteger(value.size) ||
    (value.size as number) <= 0 ||
    (value.size as number) > MAX_RESOURCE_LOCK_BYTES ||
    typeof value.contentType !== 'string' ||
    value.contentType !== lockedContentType(file.path)
  )
    throw new TypeError('Pack presentation resource lock metadata is invalid.');
  return { ...file, size: value.size as number, contentType: value.contentType };
}

const verifyResource = async (resource: ResourceLock, packDirectory: URL): Promise<Uint8Array> => {
  const bytes = await read(new URL(resource.path, packDirectory));
  if (bytes.byteLength !== resource.size) throw new TypeError('Pack size mismatch: ' + resource.path);
  if ((await hash(bytes)) !== resource.sha256) throw new TypeError('Pack digest mismatch: ' + resource.path);
  return bytes;
};

function catalogEntry<T extends Record<string, unknown>>(
  values: unknown,
  keys: readonly string[],
  map: Record<string, T>,
  label: string,
): void {
  if (!Array.isArray(values) || values.length > MAX_ENTRIES)
    throw new TypeError(`Pack presentation ${label} is invalid.`);
  for (const value of values) {
    if (!object(value) || !exactKeys(value, keys) || !id(value.id) || Object.hasOwn(map, value.id))
      throw new TypeError(`Pack presentation ${label} is invalid.`);
    for (const key of keys)
      if (key !== 'id' && typeof value[key] !== 'string') throw new TypeError(`Pack presentation ${label} is invalid.`);
    map[value.id] = Object.freeze({ ...value }) as T;
  }
}

function parsePresentation(value: unknown): PackPresentationCatalog {
  if (
    !object(value) ||
    !exactKeys(value, ['schemaVersion', 'voxels', 'items', 'actors', 'materials']) ||
    value.schemaVersion !== 1
  )
    throw new TypeError('Pack presentation schema is invalid.');
  const voxels: Record<string, PackPresentationVoxel> = {};
  const items: Record<string, PackPresentationItem> = {};
  const actors: Record<string, PackPresentationActor> = {};
  const materials: Record<string, PackPresentationMaterial> = {};
  catalogEntry(value.voxels, ['id', 'texture', 'material'], voxels, 'voxels');
  if (!Array.isArray(value.items) || value.items.length > MAX_ENTRIES)
    throw new TypeError('Pack presentation items is invalid.');
  for (const item of value.items) {
    if (
      !object(item) ||
      !exactKeys(item, item.material === undefined ? ['id', 'model', 'icon'] : ['id', 'model', 'icon', 'material']) ||
      !id(item.id) ||
      typeof item.model !== 'string' ||
      typeof item.icon !== 'string' ||
      (item.material !== undefined && typeof item.material !== 'string') ||
      Object.hasOwn(items, item.id)
    )
      throw new TypeError('Pack presentation items is invalid.');
    items[item.id] = Object.freeze({ ...item }) as PackPresentationItem;
  }
  catalogEntry(value.actors, ['id', 'model', 'texture'], actors, 'actors');
  if (!Array.isArray(value.materials) || value.materials.length > MAX_ENTRIES)
    throw new TypeError('Pack presentation materials is invalid.');
  for (const material of value.materials) {
    if (
      !object(material) ||
      !exactKeys(material, ['id', 'faceMaterial', 'texture', 'renderMode']) ||
      !id(material.id) ||
      typeof material.texture !== 'string' ||
      typeof material.renderMode !== 'string' ||
      Object.hasOwn(materials, material.id)
    )
      throw new TypeError('Pack presentation materials is invalid.');
    materials[material.id] = Object.freeze({ ...material }) as PackPresentationMaterial;
  }
  const materialSlots = new Set<number>();
  if (!Object.values(materials).every((entry) => ['opaque', 'cutout', 'transparent'].includes(entry.renderMode)))
    throw new TypeError('Pack presentation materials are invalid.');
  for (const material of Object.values(materials)) {
    if (!Number.isSafeInteger(material.faceMaterial) || material.faceMaterial < 1 || material.faceMaterial > 92)
      throw new TypeError('Pack presentation face material is invalid.');
    if (materialSlots.has(material.faceMaterial)) throw new TypeError('Pack presentation face material is duplicated.');
    materialSlots.add(material.faceMaterial);
  }
  for (const entry of Object.values(voxels))
    if (!materials[entry.material] || materials[entry.material].texture !== entry.texture)
      throw new TypeError('Pack presentation voxel material binding is unresolved.');
  for (const entry of Object.values(items))
    if (entry.material !== undefined && !materials[entry.material])
      throw new TypeError('Pack presentation material binding is unresolved.');
  for (const reference of referencedAssets({ voxels, items, actors, materials, assetUrls: {}, dispose() {} }))
    if (!assetReference(reference)) throw new TypeError(`Pack presentation asset reference is invalid: ${reference}`);
  return Object.freeze({
    voxels: Object.freeze(voxels),
    items: Object.freeze(items),
    actors: Object.freeze(actors),
    materials: Object.freeze(materials),
    assetUrls: Object.freeze({}),
    dispose() {},
  });
}

const referencedAssets = (catalog: PackPresentationCatalog) =>
  new Set(
    [
      ...Object.values(catalog.voxels).map((entry) => entry.texture),
      ...Object.values(catalog.items).flatMap((entry) => [entry.model, entry.icon]),
      ...Object.values(catalog.actors).flatMap((entry) => [entry.model, entry.texture]),
      ...Object.values(catalog.materials).map((entry) => entry.texture),
    ].filter((reference) => !reference.startsWith('builtin:')),
  );

/** Loads only presentation JSON declared by the verified Pack lock; gameplay entry modules are never imported. */
export async function loadBrowserPackPresentationCatalog(packDirectory: URL): Promise<PackPresentationCatalog> {
  if (packDirectory.origin !== location.origin) throw new TypeError('Pack directory must use the product origin.');
  const lockValue: unknown = JSON.parse(decode(await read(new URL('packs.lock.json', packDirectory))));
  if (
    !object(lockValue) ||
    lockValue.schemaVersion !== 1 ||
    !Array.isArray(lockValue.packs) ||
    lockValue.packs.length > MAX_PACKS
  )
    throw new TypeError('Pack lock schema is invalid.');
  const merged: PackPresentationCatalog = {
    voxels: {},
    items: {},
    actors: {},
    materials: {},
    assetUrls: {},
    dispose() {},
  };
  const createdAssetUrls: string[] = [];
  try {
    for (const pack of lockValue.packs) {
      if (
        !object(pack) ||
        !exactKeys(pack, ['id', 'version', 'manifest', 'entry', 'resources']) ||
        !lockValue.packs.length ||
        !Array.isArray(pack.resources) ||
        pack.resources.length > MAX_RESOURCE_LOCKS
      )
        throw new TypeError('Pack lock entry is invalid.');
      const manifestLock = fileLock(pack.manifest);
      fileLock(pack.entry);
      const resourceLocks = pack.resources.map(resourceLock);
      const resourcesByPath = new Map(resourceLocks.map((resource) => [resource.path, resource] as const));
      if (resourcesByPath.size !== resourceLocks.length) throw new TypeError('Pack resource lock path is duplicated.');
      const manifestBytes = await read(new URL(manifestLock.path, packDirectory));
      if ((await hash(manifestBytes)) !== manifestLock.sha256)
        throw new TypeError(`Pack digest mismatch: ${manifestLock.path}`);
      const manifest: unknown = JSON.parse(decode(manifestBytes));
      if (
        !object(manifest) ||
        manifest.schemaVersion !== 1 ||
        !object(manifest.presentation) ||
        !exactKeys(manifest.presentation, ['path']) ||
        !path(manifest.presentation.path)
      )
        continue;
      const presentationPath = manifest.presentation.path.replace(/^\.\//, '');
      const resource = resourcesByPath.get(presentationPath);
      if (!resource) throw new TypeError('Pack presentation resource is not locked.');
      const bytes = await verifyResource(resource, packDirectory);
      const parsed = parsePresentation(JSON.parse(decode(bytes)));
      for (const reference of referencedAssets(parsed))
        if (!path(reference) || !resourcesByPath.has(reference.replace(/^\.\//, '')))
          throw new TypeError(`Pack presentation asset is not locked: ${reference}`);
      for (const reference of referencedAssets(parsed)) {
        if (Object.hasOwn(merged.assetUrls, reference)) continue;
        const locked = resourcesByPath.get(reference.replace(/^\.\//, ''))!;
        const assetBytes = await verifyResource(locked, packDirectory);
        const objectUrl = URL.createObjectURL(new Blob([assetBytes.slice().buffer], { type: mediaType(locked.path) }));
        createdAssetUrls.push(objectUrl);
        (merged.assetUrls as Record<string, string>)[reference] = objectUrl;
      }
      for (const category of ['voxels', 'items', 'actors', 'materials'] as const) {
        for (const [key, entry] of Object.entries(parsed[category])) {
          if (Object.hasOwn(merged[category], key))
            throw new TypeError(`Duplicate Pack presentation ${category}: ${key}`);
          (merged[category] as Record<string, unknown>)[key] = entry;
        }
      }
    }
  } catch (error) {
    createdAssetUrls.forEach(URL.revokeObjectURL);
    throw error;
  }
  const assetUrls = Object.freeze(merged.assetUrls);
  let disposed = false;
  return Object.freeze({
    voxels: Object.freeze(merged.voxels),
    items: Object.freeze(merged.items),
    actors: Object.freeze(merged.actors),
    materials: Object.freeze(merged.materials),
    assetUrls,
    dispose() {
      if (disposed) return;
      disposed = true;
      Object.values(assetUrls).forEach(URL.revokeObjectURL);
    },
  });
}
