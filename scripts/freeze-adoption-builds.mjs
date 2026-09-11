import { verifyArtifact } from './harness/artifact.mjs';
process.stdout.write(JSON.stringify(verifyArtifact()) + '\n');
