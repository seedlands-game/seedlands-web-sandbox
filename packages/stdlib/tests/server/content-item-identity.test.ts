import { describe, expect, it } from 'vitest';
import { createContentItemIdentityResolver } from '../../src/server/composition/content-item-identity';

describe('composition content item identity', () => {
  it('freezes exact definition and storage lookups without namespace guessing', () => {
    const identity = createContentItemIdentityResolver({
      items: [
        { id: 'sample:door', storageId: 'door' },
        { id: 'sample:bucket', storageId: 'sample:bucket' },
      ],
    });
    expect(identity.storageIdForDefinitionId('sample:door')).toBe('door');
    expect(identity.definitionIdForStorageId('door')).toBe('sample:door');
    expect(identity.definitionIdForStorageId('sample:door')).toBeNull();
    expect(identity.storageIdForDefinitionId('door')).toBeNull();
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it('rejects malformed or duplicate definition and storage identities', () => {
    expect(() => createContentItemIdentityResolver({ items: [{ id: 'door', storageId: 'door' }] })).toThrow(
      /definition/i,
    );
    expect(() =>
      createContentItemIdentityResolver({
        items: [
          { id: 'sample:first', storageId: 'door' },
          { id: 'sample:second', storageId: 'door' },
        ],
      }),
    ).toThrow(/storage/i);
  });
});
