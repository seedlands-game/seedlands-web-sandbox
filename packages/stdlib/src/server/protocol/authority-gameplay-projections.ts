/** Derived from the crop owner and frozen Pack metadata; no writable state. */
export type AuthorityCropStageProjection = Readonly<{
  position: readonly [number, number, number];
  stage: number;
  presentationId?: string;
}>;
