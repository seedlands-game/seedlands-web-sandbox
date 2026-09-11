type AuthorityStateSource = Readonly<{
  gameplayRevision: number;
  worldRevision: number;
  worldTime: number;
}>;

export type AuthorityStateVersion = Readonly<{
  gameplayRevision: number;
  worldRevision: number;
  worldTime: number;
}>;

export const captureAuthorityStateVersion = (source: AuthorityStateSource): AuthorityStateVersion => ({
  gameplayRevision: source.gameplayRevision,
  worldRevision: source.worldRevision,
  worldTime: source.worldTime,
});

export const authorityStateChanged = (before: AuthorityStateVersion, current: AuthorityStateSource): boolean =>
  before.gameplayRevision !== current.gameplayRevision ||
  before.worldRevision !== current.worldRevision ||
  before.worldTime !== current.worldTime;
