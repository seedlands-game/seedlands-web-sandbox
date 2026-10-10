#!/bin/zsh

set -e

closure=${0:A:h}
evidence=${closure:h}
root=$(git -C "$closure" rev-parse --show-toplevel)
tool_root=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox

node "$closure/strict-manifest.mjs" \
  --manifest "$evidence/MANIFEST.sha256" \
  --root "$evidence" \
  --expected-count 39

node - "$evidence/SOURCE-MANIFEST.sha256" <<'NODE'
const fs = require('node:fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').trimEnd().split('\n');
const paths = [];
for (const line of lines) {
  const match = /^([0-9a-f]{64})  ([^/].*)$/.exec(line);
  if (!match || match[2].includes('\\') || match[2].split('/').some((part) => !part || part === '.' || part === '..'))
    process.exit(1);
  paths.push(match[2]);
}
if (lines.length !== 4 || new Set(paths).size !== 4) process.exit(1);
NODE
(cd "$root" && shasum -a 256 -c "$evidence/SOURCE-MANIFEST.sha256") >/dev/null

node "$closure/strict-manifest.mjs" \
  --manifest "$closure/PRIOR-MANIFEST.sha256" \
  --root "$closure" \
  --expected-count 3 >/dev/null

node - "$closure/strict-red.stdout.json.log" "$closure/strict-red.window.json.log" <<'NODE'
const fs = require('node:fs');
const [resultPath, windowPath] = process.argv.slice(2);
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
const window = JSON.parse(fs.readFileSync(windowPath, 'utf8'));
if (result.status !== 'FAIL' || result.lineCount !== 17 || result.validEntryCount !== 16 || result.verifiedCount !== 0)
  process.exit(1);
if (!result.errors.some((error) => error.code === 'KNOWN_INVALID_HISTORICAL_MANIFEST')) process.exit(1);
if (!result.errors.some((error) => error.line === 12 && error.code === 'NON_CANONICAL_ENTRY')) process.exit(1);
if (window.status !== 'FAIL' || window.exitCode !== 1) process.exit(1);
NODE

node - "$evidence/delivery-validation.json" "$evidence/MANIFEST.sha256" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [deliveryPath, manifestPath] = process.argv.slice(2);
const delivery = JSON.parse(fs.readFileSync(deliveryPath, 'utf8'));
const manifestHash = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
if (delivery.evidenceManifest.entries !== 39 || delivery.evidenceManifest.sha256 !== manifestHash) process.exit(1);
if (delivery.sourceManifest.entries !== 4) process.exit(1);
if (delivery.manifestClosure.oldManifestStrictStatus !== 'FAIL') process.exit(1);
NODE

git -C "$root" diff --cached --name-only | LC_ALL=C sort > /private/tmp/git40-manifest-closure-staged.paths
cmp "$closure/closure.paths" /private/tmp/git40-manifest-closure-staged.paths
git -C "$root" diff --cached --check

max_blob=0
while read -r mode object stage owned_path; do
  size=$(git -C "$root" cat-file -s "$object")
  if (( size > max_blob )); then max_blob=$size; fi
done < <(git -C "$root" ls-files -s -- $(cat "$closure/closure.paths"))
test "$max_blob" -lt 100000000

(cd "$tool_root" && pnpm exec prettier --check \
  "$evidence/README.md" \
  "$evidence/delivery-validation.json" \
  "$closure/incident.md" \
  "$closure/strict-manifest.mjs" >/dev/null)
