import type { AuthoritySnapshot } from './authority-session';

export const AUTHORITY_BASELINE_CAPTURE_ENTRY_LIMIT = 27;
export const AUTHORITY_BASELINE_CAPTURE_COMPLETION_WINDOW = 256;

export type AuthorityBaselineCapturePurpose = 'mesh' | 'collision-resync';

export type AuthorityBaselineCaptureRequest = Readonly<{
  captureId: number;
  purpose: AuthorityBaselineCapturePurpose;
  key: string;
  minimumRevision: number;
}>;

export type AuthorityBaselineCaptureCheckpoint = Readonly<
  Pick<AuthoritySnapshot, 'epoch' | 'physicsTick' | 'commitSequence' | 'worldRevision'>
>;

export type AuthorityBaselineCaptureEntry = Readonly<{
  role: 'main' | 'overlay' | 'collision-resync';
  key: string;
  chunkRevision: number;
  generatorVersion: number;
  canonical: ArrayBuffer;
  fluid: ArrayBuffer;
}>;

type AuthorityBaselineCaptureIdentity = Readonly<{
  captureId: number;
  captureGeneration: number;
  purpose: AuthorityBaselineCapturePurpose;
  key: string;
}>;

export type AuthorityBaselineCaptureResult =
  | (AuthorityBaselineCaptureIdentity &
      Readonly<{
        status: 'available';
        checkpoint: AuthorityBaselineCaptureCheckpoint;
        entries: readonly AuthorityBaselineCaptureEntry[];
      }>)
  | (AuthorityBaselineCaptureIdentity &
      Readonly<{
        status: 'unavailable';
        reason: 'cancelled' | 'not-available' | 'residency-pressure' | 'superseded' | 'stopping';
      }>);

export type AuthorityBaselineCaptureCancellation = Readonly<{
  captureId: number;
  captureGeneration: number | null;
  status: 'cancelled' | 'already-settled' | 'unknown';
}>;
