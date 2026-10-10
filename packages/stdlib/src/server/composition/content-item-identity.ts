import type { WorldDefinitionMap } from './contracts';

const DEFINITION_ID = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._/-]*$/;
const STORAGE_ID = /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._/-]*)?$/;

export type ContentItemIdentityResolver = Readonly<{
  storageIdForDefinitionId(definitionId: string): string | null;
  definitionIdForStorageId(storageId: string): string | null;
}>;

export function createContentItemIdentityResolver(
  definitions: Pick<WorldDefinitionMap, 'items'>,
): ContentItemIdentityResolver {
  const byDefinition = new Map<string, string>();
  const byStorage = new Map<string, string>();
  for (const item of definitions.items) {
    if (!DEFINITION_ID.test(item.id)) throw new TypeError(`Content item definition id is invalid: ${item.id}`);
    if (!STORAGE_ID.test(item.storageId)) throw new TypeError(`Content item storage id is invalid: ${item.storageId}`);
    if (byDefinition.has(item.id)) throw new TypeError(`Duplicate content item definition id: ${item.id}`);
    if (byStorage.has(item.storageId)) throw new TypeError(`Duplicate content item storage id: ${item.storageId}`);
    byDefinition.set(item.id, item.storageId);
    byStorage.set(item.storageId, item.id);
  }
  return Object.freeze({
    storageIdForDefinitionId: (definitionId) => byDefinition.get(definitionId) ?? null,
    definitionIdForStorageId: (storageId) => byStorage.get(storageId) ?? null,
  });
}
