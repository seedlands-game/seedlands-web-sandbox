export type WorldCommitProjection = Readonly<{ committed: boolean; reason?: string; worldRevision: number }>;

export type HarnessResult<T> = Readonly<
  | { ok: true; data: T; frontier: Readonly<Record<string, unknown>> }
  | { ok: false; error: Readonly<{ code: string; message: string }> }
>;
