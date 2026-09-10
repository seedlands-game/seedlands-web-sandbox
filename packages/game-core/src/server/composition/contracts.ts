import type { snapshotPackLock, snapshotOperationIdentity } from './composition-identity';
import type { ModLifecycleDefinition, ModSystemDefinition, LifecycleRegistrations } from './lifecycle-contracts';
import type { ItemCapability } from '../gameplay/item-registry';
import type { ItemInstanceState } from '../gameplay/item-instance';
import type {
  ModStateDefinition,
  ModOperationDefinition,
  ModRuleDefinition,
  OperationRegistrations,
} from './operation-contracts';
import type {
  WorldAuthorizationTarget,
  WorldOperation,
  WorldResourceRegistration,
} from '../harness/world-authorization';

export type CapabilityContract = Readonly<{ id: string; version: string }>;
export type PackDependency = Readonly<{ id: string; version: string }>;
export type PackKind = 'playbook' | 'extension';

export type ModulePermission = Readonly<{
  resource: string;
  operations: readonly WorldOperation[];
}>;

export type ModModuleDescriptor = Readonly<{
  id: string;
  version: string;
  provides?: readonly CapabilityContract[];
  requires?: readonly CapabilityContract[];
  replaces?: readonly CapabilityContract[];
  resources?: readonly WorldResourceRegistration[];
  permissions?: readonly ModulePermission[];
}>;

export type ModItemDefinition = Readonly<{
  id: string;
  name: string;
  stackLimit: number;
  storageId?: string;
  itemType?: 'block' | 'resource' | 'food' | 'tool';
  capabilities?: readonly ItemCapability[];
  durability?: Readonly<{ max: number }>;
}>;

export type ModItemAmount = Readonly<{
  itemId: string;
  count: number;
  instance?: ItemInstanceState;
}>;

export type ModRecipeDefinition = Readonly<{
  id: string;
  storageId?: string;
  inputs: readonly ModItemAmount[];
  outputs: readonly ModItemAmount[];
}>;

/** Frozen assembly identity for the module currently receiving the facade. */
export type ModRegistrationIdentity = Readonly<{
  moduleId: string;
  moduleVersion: string;
  packId: string;
}>;

export type ModRegistrationFacade = Readonly<{
  readonly identity: ModRegistrationIdentity;
  readContentDefinitions(): Readonly<{ items: readonly ModItemDefinition[]; recipes: readonly ModRecipeDefinition[] }>;
  onDefinitionsReady(finalize: () => void): void;
  registerLifecycle(definition: ModLifecycleDefinition): void;
  registerSystem(definition: ModSystemDefinition): void;
  registerState(definition: ModStateDefinition): void;
  registerOperation(definition: ModOperationDefinition): void;
  registerRule(definition: ModRuleDefinition): void;
  registerItem(definition: ModItemDefinition): void;
  registerRecipe(definition: ModRecipeDefinition): void;
  provideCapability<Value>(id: string, value: Value): void;
  requireCapability<Value>(id: string): Value;
}>;

export type ModModule = Readonly<{
  descriptor: ModModuleDescriptor;
  register(facade: ModRegistrationFacade): void;
}>;

export type ProviderSelection = Readonly<{ capability: string; moduleId: string }>;

export type PackManifest = Readonly<{
  schemaVersion: 1;
  id: string;
  version: string;
  kind: PackKind;
  entry: string;
  modules: readonly ModModuleDescriptor[];
  dependencies?: readonly PackDependency[];
  resources?: readonly string[];
  providerSelections?: readonly ProviderSelection[];
}>;

export type ArtifactDigest = Readonly<{ path: string; digest: string }>;

export type ArtifactIntegrityReceipt = Readonly<{
  algorithm: 'sha256';
  manifestDigest: string;
  entryDigest: string;
  resources: readonly ArtifactDigest[];
}>;

export type VerifiedPackArtifact = Readonly<{
  manifest: PackManifest;
  modules: readonly ModModule[];
  integrity: ArtifactIntegrityReceipt;
}>;

export type PackDefinitionInput = Readonly<{
  id: string;
  version: string;
  kind: PackKind;
  entry?: string;
  modules?: readonly ModModule[];
  dependencies?: readonly PackDependency[];
  resources?: readonly string[];
  providerSelections?: readonly ProviderSelection[];
}>;

export type PackDefinition = Readonly<{
  manifest: PackManifest;
  modules: readonly ModModule[];
}>;

export type WorldDefinitionMap = ReturnType<typeof snapshotOperationIdentity> &
  Readonly<{
    packs: readonly Readonly<{ id: string; version: string }>[];
    modules: readonly Readonly<{ id: string; version: string; packId: string }>[];
    capabilities: readonly Readonly<{ id: string; version: string; moduleId: string }>[];
    resources: readonly WorldResourceRegistration[];
    items: readonly Readonly<{ id: string; storageId: string }>[];
    recipes: readonly Readonly<{ id: string; storageId: string }>[];
    systems: LifecycleRegistrations['systems'];
    lifecycles: LifecycleRegistrations['lifecycles'];
  }>;

export type WorldComposition = Readonly<{
  capability<Value>(id: string): Value;
  playbookId: string;
  packLock: ReturnType<typeof snapshotPackLock>;
  packOrder: readonly string[];
  moduleOrder: readonly string[];
  definitionMap: WorldDefinitionMap;
  resources: readonly WorldResourceRegistration[];
  registrations: OperationRegistrations &
    LifecycleRegistrations &
    Readonly<{
      items: readonly ModItemDefinition[];
      recipes: readonly ModRecipeDefinition[];
    }>;
  moduleBindings: Readonly<
    Record<
      string,
      Readonly<{
        packId: string;
        permissions: readonly ModulePermission[];
      }>
    >
  >;
}>;

export type AssembleWorldPackOptions = Readonly<{
  approvedPermissions?: Readonly<Record<string, readonly ModulePermission[]>>;
  approvedReplacements?: readonly ProviderSelection[];
}>;

export type ModuleInvocationValue =
  | null
  | boolean
  | number
  | string
  | readonly ModuleInvocationValue[]
  | Readonly<{ [key: string]: ModuleInvocationValue }>;

export type ModuleInvocation = Readonly<{
  resource: string;
  operation: WorldOperation;
  target: WorldAuthorizationTarget;
  /** Bounded JSON-compatible parameters; identity and authorization target come from the frozen execution context. */
  input?: ModuleInvocationValue;
}>;
