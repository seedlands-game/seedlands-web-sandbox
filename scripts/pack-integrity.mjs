#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SHA256 = /^[a-f0-9]{64}$/i;
const NAMESPACE_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const RESOURCE_ID = /^[a-z0-9][a-z0-9._:-]*$/;
const EXACT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const OPERATIONS = new Set(['read', 'execute', 'write', 'control', 'export', 'restore']);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const snapshotJson = (value, label) => {
  let budget = 65_536;
  const seen = new Set();
  const copy = (entry, depth) => {
    if (--budget < 0 || depth > 32) throw new TypeError(`${label} exceeds its data limit.`);
    if (entry === null || typeof entry === 'boolean') return entry;
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw new TypeError(`${label} contains a non-finite number.`);
      return entry;
    }
    if (typeof entry === 'string') {
      budget -= entry.length;
      if (budget < 0) throw new TypeError(`${label} exceeds its data limit.`);
      return entry;
    }
    if (!entry || typeof entry !== 'object') throw new TypeError(`${label} must be JSON-compatible data.`);
    if (seen.has(entry)) throw new TypeError(`${label} must not contain cycles or shared object aliases.`);
    seen.add(entry);
    const prototype = Object.getPrototypeOf(entry);
    if (prototype !== Object.prototype && prototype !== null && !Array.isArray(entry))
      throw new TypeError(`${label} contains a non-data object.`);
    const keys = Object.keys(entry);
    if (Array.isArray(entry)) {
      if (keys.length !== entry.length || Reflect.ownKeys(entry).length !== keys.length + 1)
        throw new TypeError(`${label} arrays must be dense plain data.`);
      return Object.freeze(entry.map((item) => copy(item, depth + 1)));
    }
    if (Reflect.ownKeys(entry).length !== keys.length)
      throw new TypeError(`${label} must only contain enumerable string keys.`);
    const result = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor || !('value' in descriptor)) throw new TypeError(`${label} must not contain accessors.`);
      if (descriptor.value !== undefined)
        Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true });
    }
    return Object.freeze(result);
  };
  return copy(value, 0);
};

const canonicalJson = (value) => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
};

const readJson = async (path, label) => {
  let value;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new TypeError(
      `${label} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!isObject(value)) throw new TypeError(`${label} must be an object.`);
  return value;
};

const assertRelativePath = (path, label) => {
  if (typeof path !== 'string' || !path.trim() || isAbsolute(path) || path.split(/[\\/]/).includes('..'))
    throw new TypeError(`${label} must be a contained relative path.`);
};

const assertExactVersion = (version, label) => {
  if (typeof version !== 'string' || !EXACT_VERSION.test(version))
    throw new TypeError(`${label} must use the initial exact-version contract.`);
};

const assertNamespaceId = (id, label) => {
  if (typeof id !== 'string' || !NAMESPACE_ID.test(id)) throw new TypeError(`${label} must be namespace-qualified.`);
};

const assertUnique = (values, label) => {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new TypeError(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
};

const validateOperations = (operations, label) => {
  if (!Array.isArray(operations) || operations.length === 0)
    throw new TypeError(`${label} operations must not be empty.`);
  assertUnique(operations, `${label} operation`);
  for (const operation of operations)
    if (!OPERATIONS.has(operation)) throw new TypeError(`${label} operation is invalid.`);
};

const validateContracts = (contracts, label) => {
  if (contracts === undefined) return;
  if (!Array.isArray(contracts)) throw new TypeError(`${label} must be an array.`);
  assertUnique(
    contracts.map((contract) => contract?.id),
    `${label} id`,
  );
  for (const contract of contracts) {
    if (!isObject(contract)) throw new TypeError(`${label} entry must be an object.`);
    assertNamespaceId(contract.id, `${label} id`);
    assertExactVersion(contract.version, `${label} version`);
  }
};

const validateDescriptor = (descriptor) => {
  if (!isObject(descriptor)) throw new TypeError('Pack manifest module descriptor must be an object.');
  assertNamespaceId(descriptor.id, 'Module id');
  assertExactVersion(descriptor.version, `Module ${descriptor.id} version`);
  validateContracts(descriptor.provides, `Module ${descriptor.id} provides`);
  validateContracts(descriptor.requires, `Module ${descriptor.id} requires`);
  validateContracts(descriptor.replaces, `Module ${descriptor.id} replaces`);
  if (descriptor.resources !== undefined) {
    if (!Array.isArray(descriptor.resources))
      throw new TypeError(`Module ${descriptor.id} resources must be an array.`);
    assertUnique(
      descriptor.resources.map((resource) => resource?.id),
      `${descriptor.id} resource`,
    );
    for (const resource of descriptor.resources) {
      if (!isObject(resource) || typeof resource.id !== 'string' || !RESOURCE_ID.test(resource.id))
        throw new TypeError(`Module ${descriptor.id} resource is invalid.`);
      validateOperations(resource.operations, `Module resource ${resource.id}`);
    }
  }
  if (descriptor.permissions !== undefined) {
    if (!Array.isArray(descriptor.permissions))
      throw new TypeError(`Module ${descriptor.id} permissions must be an array.`);
    assertUnique(
      descriptor.permissions.map((permission) => permission?.resource),
      `${descriptor.id} permission`,
    );
    for (const permission of descriptor.permissions) {
      if (!isObject(permission) || typeof permission.resource !== 'string' || !RESOURCE_ID.test(permission.resource))
        throw new TypeError(`Module ${descriptor.id} permission is invalid.`);
      validateOperations(permission.operations, `Module permission ${permission.resource}`);
    }
  }
};

const assertLockedFile = (value, label) => {
  if (!isObject(value)) throw new TypeError(`${label} must be an object.`);
  assertRelativePath(value.path, `${label}.path`);
  if (typeof value.sha256 !== 'string' || !SHA256.test(value.sha256))
    throw new TypeError(`${label}.sha256 must be a SHA-256 hex digest.`);
};

const verifiedBytes = async (root, locked, label) => {
  const absolute = await realpath(resolve(root, locked.path));
  const fromRoot = relative(root, absolute);
  const parentPrefix = `..${process.platform === 'win32' ? '\\' : '/'}`;
  if (fromRoot === '..' || fromRoot.startsWith(parentPrefix) || isAbsolute(fromRoot))
    throw new TypeError(`${label} resolves outside the Pack lock directory: ${locked.path}`);
  const bytes = await readFile(absolute);
  const actual = sha256(bytes);
  if (actual !== locked.sha256.toLowerCase()) throw new TypeError(`${label} digest mismatch: ${locked.path}`);
  return { bytes, digest: actual };
};

const validateManifest = (manifest, lock) => {
  if (manifest.schemaVersion !== 1) throw new TypeError('Pack manifest schemaVersion must be 1.');
  assertNamespaceId(manifest.id, 'Pack manifest id');
  assertExactVersion(manifest.version, `Pack ${manifest.id} version`);
  if (manifest.kind !== 'playbook' && manifest.kind !== 'extension')
    throw new TypeError('Pack manifest kind is invalid.');
  assertRelativePath(manifest.entry, 'Pack manifest entry');
  if (!Array.isArray(manifest.modules)) throw new TypeError('Pack manifest modules must be an array.');
  assertUnique(
    manifest.modules.map((descriptor) => descriptor?.id),
    `${manifest.id} module`,
  );
  manifest.modules.forEach(validateDescriptor);
  if (manifest.dependencies !== undefined) {
    if (!Array.isArray(manifest.dependencies)) throw new TypeError('Pack manifest dependencies must be an array.');
    assertUnique(
      manifest.dependencies.map((dependency) => dependency?.id),
      `${manifest.id} dependency`,
    );
    for (const dependency of manifest.dependencies) {
      if (!isObject(dependency)) throw new TypeError('Pack dependency must be an object.');
      assertNamespaceId(dependency.id, 'Pack dependency id');
      assertExactVersion(dependency.version, `Pack dependency ${dependency.id} version`);
    }
  }
  if (manifest.resources !== undefined && !Array.isArray(manifest.resources))
    throw new TypeError('Pack manifest resources must be an array.');
  for (const path of manifest.resources ?? []) assertRelativePath(path, 'Pack manifest resource');
  assertUnique(manifest.resources ?? [], `${manifest.id} resource`);
  if (manifest.providerSelections !== undefined) {
    if (!Array.isArray(manifest.providerSelections)) throw new TypeError('Pack providerSelections must be an array.');
    assertUnique(
      manifest.providerSelections.map((selection) => selection?.capability),
      `${manifest.id} provider selection capability`,
    );
    for (const selection of manifest.providerSelections) {
      if (!isObject(selection)) throw new TypeError('Pack provider selection must be an object.');
      assertNamespaceId(selection.capability, 'Provider selection capability');
      assertNamespaceId(selection.moduleId, 'Provider selection module');
    }
  }
  if (manifest.id !== lock.id || manifest.version !== lock.version)
    throw new TypeError(`Pack lock identity does not match manifest: ${manifest.id}@${manifest.version}`);
  if (manifest.entry !== lock.entry.path) throw new TypeError('Pack lock entry path does not match manifest.');
  const manifestResources = [...(manifest.resources ?? [])].sort();
  const lockResources = lock.resources.map((resource) => resource.path).sort();
  if (JSON.stringify(manifestResources) !== JSON.stringify(lockResources))
    throw new TypeError(`Pack resource lock is not exact: ${manifest.id}`);
};

const assertSingleFileEsm = (source, path) => {
  const sourceFile = ts.createSourceFile(path, source.toString('utf8'), ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  if (sourceFile.parseDiagnostics.length > 0) throw new TypeError(`Pack entry is not valid ESM syntax: ${path}`);
  let dependency;
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    )
      dependency = node.moduleSpecifier.text;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      dependency = '<dynamic-import>';
    if (!dependency) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (dependency)
    throw new TypeError(
      `Pack entry must be a built single-file ESM artifact; unlocked code import in ${path}: ${dependency}`,
    );
};

export async function loadVerifiedPackArtifacts(lockPath) {
  const absoluteLock = await realpath(resolve(lockPath));
  const root = await realpath(dirname(absoluteLock));
  const lock = await readJson(absoluteLock, 'Pack lock');
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.packs)) throw new TypeError('Pack lock schema is invalid.');
  const seen = new Set();
  const staged = [];
  for (const entry of lock.packs) {
    if (!isObject(entry)) throw new TypeError('Pack lock entry is invalid.');
    assertNamespaceId(entry.id, 'Pack lock id');
    assertExactVersion(entry.version, `Pack lock ${entry.id} version`);
    if (seen.has(entry.id)) throw new TypeError(`Duplicate Pack lock entry: ${entry.id}`);
    seen.add(entry.id);
    assertLockedFile(entry.manifest, `${entry.id}.manifest`);
    assertLockedFile(entry.entry, `${entry.id}.entry`);
    if (!Array.isArray(entry.resources)) throw new TypeError(`${entry.id}.resources must be an array.`);
    entry.resources.forEach((resource, index) => assertLockedFile(resource, `${entry.id}.resources[${index}]`));
    assertUnique(
      entry.resources.map((resource) => resource.path),
      `${entry.id} locked resource`,
    );

    const manifestFile = await verifiedBytes(root, entry.manifest, `${entry.id} manifest`);
    let manifest;
    try {
      manifest = JSON.parse(manifestFile.bytes.toString('utf8'));
    } catch (error) {
      throw new TypeError(`Pack manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    if (!isObject(manifest)) throw new TypeError('Pack manifest must be an object.');
    manifest = snapshotJson(manifest, 'Pack manifest');
    validateManifest(manifest, entry);
    const entryFile = await verifiedBytes(root, entry.entry, `${entry.id} entry`);
    assertSingleFileEsm(entryFile.bytes, entry.entry.path);
    const resources = [];
    for (const resource of entry.resources) {
      const result = await verifiedBytes(root, resource, `${entry.id} resource`);
      resources.push(Object.freeze({ path: resource.path, digest: result.digest }));
    }
    staged.push({ entry, manifest, manifestFile, entryFile, resources });
  }

  const verified = [];
  for (const value of staged) {
    const dataUrl = `data:text/javascript;base64,${value.entryFile.bytes.toString('base64')}#sha256=${value.entryFile.digest}`;
    const namespace = await import(dataUrl);
    const modules = namespace.pack?.modules;
    if (!Array.isArray(modules)) throw new TypeError(`Pack entry must export pack.modules: ${value.entry.id}`);
    if (modules.length !== value.manifest.modules.length)
      throw new TypeError(`Pack entry module count does not match manifest: ${value.entry.id}`);
    const loadedModules = modules.map((module) => {
      if (!isObject(module) || typeof module.register !== 'function')
        throw new TypeError(`Pack entry module is invalid: ${value.entry.id}`);
      const descriptor = snapshotJson(module.descriptor, `Loaded module descriptor for ${value.entry.id}`);
      validateDescriptor(descriptor);
      const declared = value.manifest.modules.find((candidate) => candidate.id === descriptor.id);
      if (!declared || canonicalJson(declared) !== canonicalJson(descriptor))
        throw new TypeError(`Loaded module descriptor does not match manifest: ${descriptor.id}`);
      return Object.freeze({ descriptor, register: module.register });
    });
    const integrity = snapshotJson(
      {
        algorithm: 'sha256',
        manifestDigest: value.manifestFile.digest,
        entryDigest: value.entryFile.digest,
        resources: value.resources,
      },
      `Pack integrity receipt for ${value.entry.id}`,
    );
    verified.push(
      Object.freeze({
        manifest: value.manifest,
        modules: Object.freeze(loadedModules),
        integrity,
      }),
    );
  }
  return Object.freeze(verified);
}

const main = async () => {
  const index = process.argv.indexOf('--lock');
  if (index < 0 || !process.argv[index + 1]) throw new TypeError('Usage: pack-integrity.mjs --lock <packs.lock.json>');
  const artifacts = await loadVerifiedPackArtifacts(process.argv[index + 1]);
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      packs: artifacts.map((artifact) => ({
        id: artifact.manifest.id,
        version: artifact.manifest.version,
        moduleCount: artifact.modules.length,
      })),
    })}\n`,
  );
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)))
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
