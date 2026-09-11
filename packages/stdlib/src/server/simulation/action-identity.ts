export type EntityLifetimeReference = Readonly<{
  entityId: string;
  epoch: number;
  lifetime: number;
}>;

export type EntityIdentityPort = Readonly<{
  referenceFor: (entityId: string) => EntityLifetimeReference | null;
  resolve: (reference: EntityLifetimeReference) => string | null;
  rebind: (reference: EntityLifetimeReference) => EntityLifetimeReference | null;
}>;

export type EntityReferenceRole = 'actor' | 'target';
export type EntityReferenceRebindResult =
  Readonly<{ ok: true; reference: EntityLifetimeReference }> | Readonly<{ ok: false; reason: string }>;

export function isEntityLifetimeReference(value: unknown): value is EntityLifetimeReference {
  const reference = value as Partial<EntityLifetimeReference> | null;
  return (
    !!reference &&
    typeof reference.entityId === 'string' &&
    reference.entityId.trim().length > 0 &&
    Number.isSafeInteger(reference.epoch) &&
    reference.epoch! >= 0 &&
    Number.isSafeInteger(reference.lifetime) &&
    reference.lifetime! >= 0
  );
}

export function rebindEntityLifetimeReference(
  identity: EntityIdentityPort,
  saved: EntityLifetimeReference,
  entityId: string,
  role: EntityReferenceRole,
): EntityReferenceRebindResult {
  const current = identity.referenceFor(entityId);
  if (!current) return { ok: false, reason: `restore-${role}-missing` };
  if (current.lifetime !== saved.lifetime) return { ok: false, reason: `restore-${role}-lifetime-mismatch` };
  const rebound = identity.rebind(saved);
  if (!rebound || rebound.entityId !== entityId || rebound.lifetime !== saved.lifetime)
    return { ok: false, reason: `restore-${role}-binding-invalid` };
  return { ok: true, reference: { ...rebound } };
}

export function entityReferenceExecutionFailure(
  identity: EntityIdentityPort | undefined,
  reference: EntityLifetimeReference | null,
  entityId: string,
  role: EntityReferenceRole,
): string | null {
  if (!identity) return null;
  if (!reference) return `${role}-binding-missing`;
  if (identity.resolve(reference) === entityId) return null;
  const current = identity.referenceFor(entityId);
  if (!current) return `${role}-missing`;
  if (current.lifetime !== reference.lifetime) return `${role}-lifetime-mismatch`;
  return `${role}-epoch-mismatch`;
}
