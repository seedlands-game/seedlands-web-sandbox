export type ClassicTestIdentity = Readonly<{
  testId: string;
  file: string;
  test: string;
  project: string;
}>;

export type ClassicSelection = Readonly<{
  mode: 'CANONICAL_MAIN' | 'NON_MAIN' | 'MODULAR_WORLD' | 'AMBIGUOUS';
  canonicalMainSelected: boolean;
  canonicalMainMatches: number;
  modularSmokeMatches: number;
  selectedTests: readonly ClassicTestIdentity[];
}>;

export type ClassicEvidenceAttachment = Readonly<{ name: string; payload: unknown; error?: string }>;
export type ClassicTestEndEvent = ClassicTestIdentity &
  Readonly<{
    retry: number;
    resultStatus: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
    resultErrors: readonly string[];
    attachments: readonly ClassicEvidenceAttachment[];
  }>;

export type ClassicReceipt = Readonly<Record<string, unknown>> &
  Readonly<{
    status: 'PASS' | 'FAIL';
    runId: string;
    sourceSha: string;
    selection: ClassicSelection;
    attempts: readonly Readonly<Record<string, unknown>>[];
    conflicts: readonly Readonly<Record<string, unknown>>[];
  }>;

export const canonicalMainIdentity: Readonly<{ file: string; title: string; project: string }>;
export const modularSmokeIdentity: Readonly<{ file: string; title: string; project: string }>;
export function isCanonicalMainTest(test: ClassicTestIdentity): boolean;
export function createCanonicalSelection(
  selectedTests: readonly ClassicTestIdentity[],
  options?: Readonly<{ modularWorld?: boolean }>,
): ClassicSelection;
export function createClassicReceipt(
  options: Readonly<{
    runId: string;
    sourceSha: string;
    selection: ClassicSelection;
  }>,
): ClassicReceipt;
export function recordCanonicalTestEnd(receipt: ClassicReceipt, event: ClassicTestEndEvent): ClassicReceipt;
export function finalizeClassicReceipt(
  receipt: ClassicReceipt,
  runnerOutcome: 'passed' | 'failed' | 'timedout' | 'interrupted',
): ClassicReceipt;
export function parseClassicReceiptText(text: string): unknown;
export function readClassicReceipt(path: string): unknown;
export function validateClassicRunReceipt(
  receipt: unknown,
  options: Readonly<{
    runId: string;
    sourceSha: string;
    processStatus: number | null;
    requireCanonicalMain: boolean;
    benchmark: boolean;
    modularWorld?: boolean;
  }>,
): Readonly<Record<string, unknown>> | null;
