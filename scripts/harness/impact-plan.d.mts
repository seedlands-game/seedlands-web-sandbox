export type ContractEntry = {
  id: string;
  kind: 'contract' | 'integration';
  files: string[];
  needs?: string[];
};
export type ContractOwner = {
  id: string;
  paths: string[];
  contracts: ContractEntry[];
  dependencies?: { owner: string; kind: 'required' | 'optional' | 'capability' | 'build' }[];
  dynamicPaths?: string[];
  dynamicReason?: string;
  classic?: boolean;
  localBenchmarks?: string[];
  documentation?: boolean;
};
export type ContractRegistry = { schemaVersion: 1; owners: ContractOwner[] };
export type RepositorySnapshot = {
  sha: string;
  files: Record<string, string>;
  registry: ContractRegistry | null;
};
export type ImpactPlan = {
  schemaVersion: 1;
  baseSha: string | null;
  headSha: string | null;
  status: 'READY' | 'BLOCKED';
  mode: 'affected' | 'full-new';
  changedOwners: string[];
  affectedOwners: string[];
  selectedContracts: (ContractEntry & { ownerId: string })[];
  selectedIntegrations: (ContractEntry & { ownerId: string })[];
  classic: { required: boolean; reasons: string[] };
  productionBuild: boolean;
  documentationOnly: boolean;
  localBenchmarks: string[];
  reasons: Record<string, string[]>;
  fallbackReasons: string[];
  unresolvedDependencies: { path: string; specifier: string; reason: string }[];
  errors: string[];
};
export function validateRegistry(registry: unknown): asserts registry is ContractRegistry;
export function createImpactPlan(input: {
  base: RepositorySnapshot | null;
  head: RepositorySnapshot;
  changedPaths: string[];
  all?: boolean;
}): ImpactPlan;
