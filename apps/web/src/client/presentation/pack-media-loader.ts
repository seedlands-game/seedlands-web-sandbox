const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const PATH_SEGMENT = /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/;
const ALLOWED_AUDIO_TYPES = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/aac']);
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const MAX_INDEX_ENTRIES = 128;
export const MAX_PACK_MEDIA_BYTES = 8 * 1024 * 1024;

export type PackMediaResourceReferenceV1 = Readonly<{ packId: string; path: string }>;
export type PackMediaResourceIndexEntry = Readonly<{
  packId: string;
  path: string;
  digest: string;
  url: string;
  size: number;
  contentType: string;
}>;
export type PackMediaFetchResponse = Readonly<{
  ok: boolean;
  status: number;
  contentType: string | null;
  contentLength: number | null;
  bytes(maxBytes: number): Promise<ArrayBuffer>;
  release(): void;
}>;
export type PackMediaFetchPort = (url: URL, signal: AbortSignal) => Promise<PackMediaFetchResponse>;
export type PackMediaSha256Port = (bytes: ArrayBuffer) => Promise<string>;
export type PackMediaResourceLease = Readonly<{
  readonly bytes: ArrayBuffer;
  release(): void;
}>;
export type PackMediaLockV1 = Readonly<{
  schemaVersion: 1;
  packs: readonly Readonly<{
    id: string;
    resources: readonly Readonly<{
      path: string;
      sha256: string;
      size: number;
      contentType: string;
    }>[];
  }>[];
}>;

export type PackMediaLoaderErrorCode =
  | 'invalid-reference'
  | 'resource-not-indexed'
  | 'request-failed'
  | 'content-type-mismatch'
  | 'size-mismatch'
  | 'digest-mismatch'
  | 'stale-request'
  | 'disposed';

export class PackMediaLoaderError extends Error {
  constructor(readonly code: PackMediaLoaderErrorCode) {
    super(code);
    this.name = 'PackMediaLoaderError';
  }
}

const canonicalPath = (value: unknown, label: string): string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value.startsWith('./') ||
    value.split('/').some((part) => !PATH_SEGMENT.test(part))
  )
    throw new TypeError(`${label} is invalid.`);
  return value;
};

const packId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length > 128 || !NAMESPACE_ID.test(value))
    throw new TypeError(`${label} is invalid.`);
  return value;
};

const contentType = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new TypeError(`${label} is invalid.`);
  const normalized = value.split(';', 1)[0]!.trim().toLowerCase();
  if (!ALLOWED_AUDIO_TYPES.has(normalized)) throw new TypeError(`${label} is not an allowed audio type.`);
  return normalized;
};

const keyFor = (reference: PackMediaResourceReferenceV1): string => JSON.stringify([reference.packId, reference.path]);
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const lockFile = (raw: unknown): void => {
  if (
    !object(raw) ||
    !exactKeys(raw, ['path', 'sha256']) ||
    typeof raw.path !== 'string' ||
    typeof raw.sha256 !== 'string' ||
    !SHA256.test(raw.sha256)
  )
    throw new TypeError('Pack media artifact lock is invalid.');
  canonicalPath(raw.path, 'Pack media artifact path');
};

export function packMediaIndexFromLock(raw: unknown, lockUrl: URL): readonly PackMediaResourceIndexEntry[] {
  if (lockUrl.origin !== location.origin) throw new TypeError('Pack media lock must use the product origin.');
  if (
    !object(raw) ||
    !exactKeys(raw, ['schemaVersion', 'packs']) ||
    raw.schemaVersion !== 1 ||
    !Array.isArray(raw.packs) ||
    !raw.packs.length ||
    raw.packs.length > 16
  )
    throw new TypeError('Pack media lock is invalid.');
  const entries: PackMediaResourceIndexEntry[] = [];
  for (const pack of raw.packs) {
    if (
      !object(pack) ||
      !exactKeys(pack, ['id', 'version', 'manifest', 'entry', 'resources']) ||
      typeof pack.id !== 'string' ||
      typeof pack.version !== 'string' ||
      !Array.isArray(pack.resources) ||
      pack.resources.length > 128
    )
      throw new TypeError('Pack media lock entry is invalid.');
    lockFile(pack.manifest);
    lockFile(pack.entry);
    const id = packId(pack.id, 'Pack media resource pack id');
    for (const resource of pack.resources) {
      if (
        !object(resource) ||
        Object.keys(resource).length !== 4 ||
        !['path', 'sha256', 'size', 'contentType'].every((key) => Object.hasOwn(resource, key))
      )
        throw new TypeError('Pack media resource lock is invalid.');
      const path = canonicalPath(resource.path, 'Pack media resource path');
      if (typeof resource.sha256 !== 'string' || !SHA256.test(resource.sha256))
        throw new TypeError('Pack media resource digest is invalid.');
      if (!Number.isSafeInteger(resource.size) || (resource.size as number) <= 0)
        throw new TypeError('Pack media resource size is invalid.');
      if (typeof resource.contentType !== 'string' || !MIME_TYPE.test(resource.contentType))
        throw new TypeError('Pack media resource content type is invalid.');
      const type = resource.contentType.toLowerCase();
      if (!ALLOWED_AUDIO_TYPES.has(type)) continue;
      if ((resource.size as number) > MAX_PACK_MEDIA_BYTES)
        throw new RangeError('Pack media resource size is invalid.');
      const url = new URL(path, lockUrl);
      if (url.origin !== lockUrl.origin || !url.pathname.startsWith(new URL('.', lockUrl).pathname))
        throw new TypeError('Pack media resource URL escapes the Pack directory.');
      entries.push(
        Object.freeze({
          packId: id,
          path,
          digest: resource.sha256.toLowerCase(),
          url: url.href,
          size: resource.size as number,
          contentType: type,
        }),
      );
    }
  }
  return Object.freeze(entries);
}

const readLock = async (url: URL): Promise<unknown> => {
  const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new PackMediaLoaderError('request-failed');
  if (!response.body) throw new PackMediaLoaderError('request-failed');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 262_144) throw new PackMediaLoaderError('request-failed');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new PackMediaLoaderError('request-failed');
  }
};

const fetchMedia: PackMediaFetchPort = async (url, signal) => {
  const response = await fetch(url, { signal, cache: 'no-store', credentials: 'same-origin' });
  const reader = response.body?.getReader() ?? null;
  return {
    ok: response.ok,
    status: response.status,
    contentType: response.headers.get('content-type'),
    contentLength: (() => {
      const value = response.headers.get('content-length');
      return value === null ? null : Number(value);
    })(),
    async bytes(maxBytes) {
      if (!reader) throw new PackMediaLoaderError('request-failed');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) throw new PackMediaLoaderError('size-mismatch');
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes.buffer;
    },
    release() {
      void reader?.cancel().catch(() => undefined);
      reader?.releaseLock();
    },
  };
};

const digestBytes: PackMediaSha256Port = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

export async function createBrowserPackMediaLoader(packDirectory: URL): Promise<PackMediaLoader> {
  const lockUrl = new URL('packs.lock.json', packDirectory);
  const entries = packMediaIndexFromLock(await readLock(lockUrl), lockUrl);
  return new PackMediaLoader(entries, packDirectory.origin, fetchMedia, digestBytes);
}

const releaseResponse = (response: PackMediaFetchResponse | null): void => {
  if (!response) return;
  try {
    response.release();
  } catch {
    // Cleanup cannot change whether verified bytes are accepted.
  }
};

type LeaseControl = { release(): void };

export class PackMediaLoader {
  private readonly entries: ReadonlyMap<string, PackMediaResourceIndexEntry>;
  private readonly leases = new Set<LeaseControl>();
  private readonly pending = new Set<AbortController>();
  private generation = 0;
  private disposed = false;

  constructor(
    entries: readonly PackMediaResourceIndexEntry[],
    private readonly origin: string,
    private readonly fetchBytes: PackMediaFetchPort,
    private readonly sha256: PackMediaSha256Port,
  ) {
    if (!Array.isArray(entries) || entries.length > MAX_INDEX_ENTRIES)
      throw new TypeError('Pack media resource index is invalid.');
    const expectedOrigin = new URL(this.origin).origin;
    if (expectedOrigin !== this.origin) throw new TypeError('Pack media origin must be canonical.');
    const indexed = new Map<string, PackMediaResourceIndexEntry>();
    for (const raw of entries) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new TypeError('Pack media resource index entry is invalid.');
      const keys = ['packId', 'path', 'digest', 'url', 'size', 'contentType'];
      if (Object.keys(raw).length !== keys.length || keys.some((key) => !Object.hasOwn(raw, key)))
        throw new TypeError('Pack media resource index entry has an invalid shape.');
      const id = packId(raw.packId, 'Pack media resource pack id');
      const path = canonicalPath(raw.path, 'Pack media resource path');
      if (!SHA256.test(raw.digest)) throw new TypeError('Pack media resource digest is invalid.');
      if (!Number.isSafeInteger(raw.size) || raw.size <= 0 || raw.size > MAX_PACK_MEDIA_BYTES)
        throw new RangeError('Pack media resource size is invalid.');
      const type = contentType(raw.contentType, 'Pack media resource content type');
      const url = new URL(raw.url, this.origin);
      if (url.origin !== this.origin) throw new TypeError('Pack media resource URL must use the product origin.');
      const entry = Object.freeze({
        packId: id,
        path,
        digest: raw.digest.toLowerCase(),
        url: url.href,
        size: raw.size,
        contentType: type,
      });
      const key = keyFor(entry);
      if (indexed.has(key)) throw new TypeError(`Duplicate Pack media resource: ${id}/${path}`);
      indexed.set(key, entry);
    }
    this.entries = indexed;
  }

  async resolve(reference: PackMediaResourceReferenceV1): Promise<PackMediaResourceLease> {
    if (this.disposed) throw new PackMediaLoaderError('disposed');
    const entry = this.entryFor(reference);

    const generation = this.generation;
    const controller = new AbortController();
    this.pending.add(controller);
    let response: PackMediaFetchResponse | null = null;
    try {
      try {
        response = await this.fetchBytes(new URL(entry.url), controller.signal);
      } catch {
        this.assertCurrent(generation);
        throw new PackMediaLoaderError('request-failed');
      }
      this.assertCurrent(generation);
      if (!response.ok) throw new PackMediaLoaderError('request-failed');
      let responseType: string;
      try {
        responseType = contentType(response.contentType, 'Pack media response content type');
      } catch {
        throw new PackMediaLoaderError('content-type-mismatch');
      }
      if (responseType !== entry.contentType) throw new PackMediaLoaderError('content-type-mismatch');
      if (
        response.contentLength !== null &&
        (!Number.isSafeInteger(response.contentLength) ||
          response.contentLength !== entry.size ||
          response.contentLength > MAX_PACK_MEDIA_BYTES)
      )
        throw new PackMediaLoaderError('size-mismatch');
      const source = await response.bytes(MAX_PACK_MEDIA_BYTES);
      this.assertCurrent(generation);
      if (
        !(source instanceof ArrayBuffer) ||
        source.byteLength !== entry.size ||
        source.byteLength > MAX_PACK_MEDIA_BYTES
      )
        throw new PackMediaLoaderError('size-mismatch');
      const owned = source.slice(0);
      const actual = await this.sha256(owned);
      this.assertCurrent(generation);
      if (!SHA256.test(actual) || actual.toLowerCase() !== entry.digest)
        throw new PackMediaLoaderError('digest-mismatch');
      return this.createLease(owned);
    } finally {
      releaseResponse(response);
      this.pending.delete(controller);
    }
  }

  validate(reference: PackMediaResourceReferenceV1): void {
    if (this.disposed) throw new PackMediaLoaderError('disposed');
    this.entryFor(reference);
  }

  private entryFor(reference: PackMediaResourceReferenceV1): PackMediaResourceIndexEntry {
    let normalized: PackMediaResourceReferenceV1;
    try {
      normalized = Object.freeze({
        packId: packId(reference?.packId, 'Media resource pack id'),
        path: canonicalPath(reference?.path, 'Media resource path'),
      });
    } catch {
      throw new PackMediaLoaderError('invalid-reference');
    }
    const entry = this.entries.get(keyFor(normalized));
    if (!entry) throw new PackMediaLoaderError('resource-not-indexed');
    return entry;
  }

  abort(): void {
    if (this.disposed) return;
    this.abortPending();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortPending();
    for (const lease of [...this.leases]) lease.release();
    this.leases.clear();
  }

  private createLease(bytes: ArrayBuffer): PackMediaResourceLease {
    let held: ArrayBuffer | null = bytes;
    const control: LeaseControl = {
      release: () => {
        if (!held) return;
        held = null;
        this.leases.delete(control);
      },
    };
    const lease = Object.freeze({
      get bytes() {
        if (!held) throw new PackMediaLoaderError('disposed');
        return held;
      },
      release: control.release,
    });
    this.leases.add(control);
    return lease;
  }

  private abortPending(): void {
    this.generation += 1;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
  }

  private assertCurrent(generation: number): void {
    if (this.disposed) throw new PackMediaLoaderError('disposed');
    if (generation !== this.generation) throw new PackMediaLoaderError('stale-request');
  }
}
