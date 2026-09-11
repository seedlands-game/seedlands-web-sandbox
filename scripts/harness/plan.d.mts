import type { ImpactPlan } from './impact-plan.mjs';

export function generatePlan(input: {
  root: string;
  baseSha?: string;
  headSha?: string;
  all?: boolean;
}): ImpactPlan & { worktreeDigest: string | null; diagnostics: string[] };
