export function validateClassicReceipt(
  receipt: unknown,
  expected: {
    runId: string;
    artifact: {
      sourceSha: string;
      sourceDigest: string;
      lockDigest: string;
      artifactDigest: string;
      files: Record<string, string>;
    };
    scenario: {
      schemaVersion: number;
      scenarioId: string;
      seed: string;
      generatorVersion: number;
      playbookId: string;
      playbookVersion: string;
    };
    benchmark: boolean;
    performanceWindow?: { windowId: string; evidencePath: string };
  },
): unknown;
