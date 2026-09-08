import type { GameServer } from '../game-server';
import type { CanonicalChunkResidencyDiagnostics } from '../chunk-residency';

export type AuthorityResidencyDiagnostics = CanonicalChunkResidencyDiagnostics &
  Readonly<{
    autoSaveInFlight: boolean;
    autoSaveFailureCount: number;
    nextRetryActiveTimeMs: number;
    lastSaveError: string | null;
  }>;

export class AuthorityResidencyRuntime {
  private saveInFlight: Promise<void> | null = null;
  private autoSaveFailures = 0;
  private retryActiveTimeMs = 0;
  private activeTimeMs = 0;
  private lastSaveError: string | null = null;

  constructor(
    private readonly server: GameServer,
    private readonly currentCommitSequence: () => number,
  ) {}

  get diagnostics(): AuthorityResidencyDiagnostics {
    return {
      ...this.server.canonicalResidencyDiagnostics,
      autoSaveInFlight: Boolean(this.saveInFlight),
      autoSaveFailureCount: this.autoSaveFailures,
      nextRetryActiveTimeMs: this.retryActiveTimeMs,
      lastSaveError: this.lastSaveError,
    };
  }

  maintain(activeTimeMs: number): void {
    this.activeTimeMs = activeTimeMs;
    if (!this.server.canonicalResidencyNeedsMaintenance) return;
    this.server.maintainCanonicalResidency();
    if (!this.server.canonicalResidencyNeedsMaintenance) return;
    const diagnostics = this.server.canonicalResidencyDiagnostics;
    if (diagnostics.dirtyCount === 0 || this.saveInFlight || activeTimeMs < this.retryActiveTimeMs) return;
    const frozen = this.server.freezeSaveSnapshot(this.currentCommitSequence());
    const saving = this.server
      .saveFrozen(frozen)
      .then((result) => {
        if (!result.gameplaySaved && !result.savedChunks.length && this.server.canonicalResidencyDiagnostics.dirtyCount)
          throw new Error('Canonical residency checkpoint persistence is unavailable.');
        this.recordSaveSuccess();
      })
      .catch((error: unknown) => {
        this.autoSaveFailures += 1;
        const delayMs = canonicalResidencyRetryDelayMs(this.autoSaveFailures);
        this.retryActiveTimeMs = this.activeTimeMs + delayMs;
        this.lastSaveError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        if (this.saveInFlight === saving) this.saveInFlight = null;
        this.server.maintainCanonicalResidency();
      });
    this.saveInFlight = saving;
  }

  recordSaveSuccess(): void {
    this.autoSaveFailures = 0;
    this.retryActiveTimeMs = 0;
    this.lastSaveError = null;
  }
}

export const canonicalResidencyRetryDelayMs = (failureCount: number): number =>
  Math.min(30_000, 1_000 * 2 ** Math.max(0, failureCount - 1));
