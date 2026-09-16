export type ArtifactIdentity = { sourceSha: string; sourceDigest: string; lockDigest: string };
export type Artifact = ArtifactIdentity & {
  schemaVersion: 1;
  artifactDigest: string;
  files: Record<string, string>;
  builtAt: string;
};
export const root: string;
export function sourceIdentity(directory?: string): ArtifactIdentity;
export function distFiles(directory: string): Record<string, string>;
export function verifyArtifact(directory?: string): Artifact;
export function buildArtifact(directory?: string): Artifact;
