import type { ContractRegistry, RepositorySnapshot } from './impact-plan.mjs';
export function pathMatches(path: string, pattern: string): boolean;
export function ownersFor(path: string, registry: ContractRegistry): string[];
export function dependencyGraph(snapshot: RepositorySnapshot & { registry: ContractRegistry }): {
  dependencies: Map<string, Set<string>>;
  uncertain: Set<string>;
  unresolved: { path: string; specifier: string; reason: string }[];
};
