import { dependencyGraph, ownersFor, pathMatches } from './dependency-graph.mjs';

const broadPaths = [
  'harness/contracts.json',
  'scripts/harness/**',
  'packages/eslint-plugin/**',
  '.github/**',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '*config*',
  '.ls-lint.yml',
  'AGENTS.md',
  'docs/development-governance.md',
  'docs/harness-contracts.md',
  '.agents/skills/**',
];

export function validateRegistry(registry) {
  if (registry?.schemaVersion !== 1 || !Array.isArray(registry.owners) || !registry.owners.length)
    throw new TypeError('Invalid or empty contract registry.');
  const owners = new Set();
  const contracts = new Set();
  for (const owner of registry.owners) {
    if (
      typeof owner.id !== 'string' ||
      !owner.id ||
      owners.has(owner.id) ||
      !Array.isArray(owner.paths) ||
      !owner.paths.length ||
      !owner.paths.every(
        (path) => typeof path === 'string' && !path.startsWith('/') && !path.split('/').includes('..'),
      ) ||
      !Array.isArray(owner.contracts)
    )
      throw new TypeError('Invalid or duplicate registry owner.');
    owners.add(owner.id);
    for (const contract of owner.contracts) {
      if (
        typeof contract.id !== 'string' ||
        contracts.has(contract.id) ||
        !['contract', 'integration'].includes(contract.kind) ||
        !Array.isArray(contract.files) ||
        !contract.files.length ||
        !contract.files.every(
          (path) => typeof path === 'string' && !path.startsWith('/') && !path.split('/').includes('..'),
        )
      )
        throw new TypeError(`Invalid or duplicate contract: ${contract.id}`);
      contracts.add(contract.id);
    }
    if (
      owner.dynamicPaths &&
      (!Array.isArray(owner.dynamicPaths) ||
        !owner.dynamicPaths.length ||
        !owner.dynamicPaths.every(
          (path) =>
            typeof path === 'string' &&
            !path.includes('*') &&
            owner.paths.some((pattern) => pathMatches(path, pattern)),
        ) ||
        !owner.dynamicReason?.trim() ||
        !owner.dependencies?.length)
    )
      throw new TypeError(`Unexplained dynamic boundary for ${owner.id}`);
  }
  for (const owner of registry.owners)
    for (const dependency of owner.dependencies ?? []) {
      if (!owners.has(dependency.owner) || !['required', 'optional', 'capability', 'build'].includes(dependency.kind))
        throw new TypeError(`Invalid dependency for ${owner.id}`);
    }
  if (!contracts.size) throw new TypeError('Registry has no effective contracts.');
}

export function createImpactPlan({ base, head, changedPaths, all = false }) {
  const errors = [];
  const fallbackReasons = [];
  const snapshots = [];
  for (const [label, snapshot] of [
    ['base', base],
    ['head', head],
  ]) {
    if (!snapshot?.registry) {
      fallbackReasons.push(`missing-${label}-registry`);
      if (label === 'head') errors.push('Head registry is missing.');
      continue;
    }
    try {
      validateRegistry(snapshot.registry);
      snapshots.push(snapshot);
    } catch (error) {
      fallbackReasons.push(`invalid-${label}-registry`);
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const changedOwners = new Set();
  const affected = new Set();
  const reasons = {};
  const select = (owner, reason) => {
    affected.add(owner);
    reasons[owner] ??= [];
    if (!reasons[owner].includes(reason)) reasons[owner].push(reason);
  };
  if (all) fallbackReasons.push('explicit-all');
  if (!Array.isArray(changedPaths) || !changedPaths.length) fallbackReasons.push('no-reliable-diff');
  for (const path of Array.isArray(changedPaths) ? changedPaths : []) {
    if (broadPaths.some((pattern) => pathMatches(path, pattern))) fallbackReasons.push(`policy-or-build:${path}`);
    const owners = new Set(snapshots.flatMap((snapshot) => ownersFor(path, snapshot.registry)));
    if (!owners.size) fallbackReasons.push(`unknown-path:${path}`);
    for (const owner of owners) {
      changedOwners.add(owner);
      select(owner, `changed:${path}`);
    }
  }
  const graphs = snapshots.map(dependencyGraph);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const graph of graphs)
      for (const [consumer, dependencies] of graph.dependencies) {
        for (const dependency of dependencies)
          if (affected.has(dependency) && !affected.has(consumer)) {
            select(consumer, `consumes:${dependency}`);
            expanded = true;
          }
      }
  }
  for (const graph of graphs)
    for (const owner of graph.uncertain) {
      // An unresolved consumer may depend on the changed owner even when the
      // static closure cannot produce that edge. Do not prune it out first.
      if (
        [...changedOwners].some((id) =>
          snapshots.some((snapshot) => !snapshot.registry.owners.find((entry) => entry.id === id)?.documentation),
        )
      )
        fallbackReasons.push(`unresolved-dependency:${owner}`);
    }
  if (fallbackReasons.length)
    for (const snapshot of snapshots) for (const owner of snapshot.registry.owners) select(owner.id, 'full-new');
  const selected = new Map();
  const classicReasons = [];
  for (const snapshot of snapshots)
    for (const owner of snapshot.registry.owners) {
      if (!affected.has(owner.id)) continue;
      if (owner.classic) classicReasons.push(owner.id);
      for (const contract of owner.contracts) {
        const prior = selected.get(contract.id);
        if (prior && prior.kind !== contract.kind)
          errors.push(`Contract kind changed without migration: ${contract.id}`);
        const entry = prior ?? { ...contract, ownerId: owner.id, files: [] };
        // Base declarations cannot be removed by the candidate being tested.
        for (const pattern of contract.files) {
          const matching = Object.keys(snapshot.files).filter((path) => pathMatches(path, pattern));
          if (!matching.length) errors.push(`Contract ${contract.id} has no tests matching ${pattern}`);
          for (const file of matching) if (!entry.files.includes(file)) entry.files.push(file);
        }
        selected.set(contract.id, entry);
      }
    }
  for (const entry of selected.values()) {
    entry.files.sort();
    for (const file of entry.files)
      if (!Object.hasOwn(head?.files ?? {}, file)) errors.push(`Selected base test missing in head: ${file}`);
  }
  const documentationOnly =
    fallbackReasons.length === 0 &&
    affected.size > 0 &&
    changedPaths.every((path) => /\.(?:md|png|webp|svg|jpg)$/.test(path)) &&
    [...affected].every((id) =>
      snapshots.every((snapshot) => snapshot.registry.owners.find((owner) => owner.id === id)?.documentation),
    );
  if (!selected.size && !documentationOnly) errors.push('No effective tests selected.');
  const entries = [...selected.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    baseSha: base?.sha ?? null,
    headSha: head?.sha ?? null,
    status: errors.length ? 'BLOCKED' : 'READY',
    mode: fallbackReasons.length ? 'full-new' : 'affected',
    changedOwners: [...changedOwners].sort(),
    affectedOwners: [...affected].sort(),
    selectedContracts: entries.filter((entry) => entry.kind === 'contract'),
    selectedIntegrations: entries.filter((entry) => entry.kind === 'integration'),
    classic: {
      required: fallbackReasons.length > 0 || classicReasons.length > 0,
      reasons: [...new Set(classicReasons)],
    },
    productionBuild: !documentationOnly,
    documentationOnly,
    localBenchmarks: [
      ...new Set(
        snapshots.flatMap((snapshot) =>
          snapshot.registry.owners
            .filter((owner) => affected.has(owner.id))
            .flatMap((owner) => owner.localBenchmarks ?? []),
        ),
      ),
    ],
    reasons,
    fallbackReasons: [...new Set(fallbackReasons)],
    unresolvedDependencies: [
      ...new Map(
        graphs.flatMap((graph) => graph.unresolved).map((entry) => [`${entry.path}\0${entry.specifier}`, entry]),
      ).values(),
    ],
    errors: [...new Set(errors)],
  };
}
