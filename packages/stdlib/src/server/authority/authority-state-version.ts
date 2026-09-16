type AuthorityStateSource = Readonly<{
  commitSequence: number;
  gameplayRevision: number;
  worldRevision: number;
  worldTime: number;
}>;

export type AuthorityStateVersion = Readonly<{
  commitSequence: number;
  gameplayRevision: number;
  worldRevision: number;
  worldTime: number;
}>;

export const captureAuthorityStateVersion = (source: AuthorityStateSource): AuthorityStateVersion => ({
  commitSequence: source.commitSequence,
  gameplayRevision: source.gameplayRevision,
  worldRevision: source.worldRevision,
  worldTime: source.worldTime,
});

export const authorityStateChanged = (before: AuthorityStateVersion, current: AuthorityStateSource): boolean =>
  before.gameplayRevision !== current.gameplayRevision ||
  before.worldRevision !== current.worldRevision ||
  before.worldTime !== current.worldTime;
