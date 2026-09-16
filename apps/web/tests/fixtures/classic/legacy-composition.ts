import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { CompositionCheckpointIdentity } from '../../../../../packages/stdlib/src/server/composition/checkpoint-identity';

// Codec tests may supply a trusted host envelope explicitly. Their synthetic payloads
// do not prove historical provenance; real captured-save compatibility has separate tests.
export function capturedLegacyCompositionIdentity(): CompositionCheckpointIdentity {
  const captured = JSON.parse(
    gunzipSync(readFileSync(new URL('../checkpoints/base-checkpoint.json.gz', import.meta.url))).toString('utf8'),
  ) as { args: [{ snapshot: { gameplay: { composition: CompositionCheckpointIdentity } } }] };
  return captured.args[0].snapshot.gameplay.composition;
}
