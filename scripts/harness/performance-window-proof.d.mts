export type PerformanceWindowContext = Readonly<{
  windowId: string;
  evidencePath: string;
  declarationPath: string;
}>;

export type MeasurementDeclaration = {
  schemaVersion: 1;
  windowId: string;
  evidencePath: string;
  measurementPath: string;
  format: 'local' | 'classic';
  runId: string;
  owner: string;
  scenario: string;
};

export function measurementDigest(record: unknown): string;
export function performanceWindowContext(environment?: NodeJS.ProcessEnv): PerformanceWindowContext | null;
export function requirePerformanceWindowContext(environment?: NodeJS.ProcessEnv): PerformanceWindowContext;
export function writeMeasurementDeclaration(
  context: PerformanceWindowContext,
  declaration: Omit<MeasurementDeclaration, 'schemaVersion' | 'windowId' | 'evidencePath'>,
): MeasurementDeclaration;
export function measurementFromDeclaration(
  declarationPath: string,
  options?: { rootDirectory?: string },
): { declaration: MeasurementDeclaration; record: Record<string, unknown> };
export function measurementSummary(
  declarationPath: string,
  options?: { rootDirectory?: string },
): Record<string, unknown>;
export function assertMeasurementWindow(record: unknown, options?: { rootDirectory?: string }): Record<string, unknown>;
