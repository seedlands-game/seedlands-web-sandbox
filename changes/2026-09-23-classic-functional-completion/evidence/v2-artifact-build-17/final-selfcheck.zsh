#!/bin/zsh

set -e

main=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
tree=/private/tmp/seedlands-v2-acceptance-4052dae0
evidence=$main/changes/2026-09-23-classic-functional-completion/evidence/v2-artifact-build-17
strict=$main/changes/2026-09-23-classic-functional-completion/evidence/git-40-canonical-discovery/manifest-closure/strict-manifest.mjs

hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }

test "$(git -C "$tree" rev-parse HEAD)" = 4052dae01d4527bd1747a60358cf59469ab1b3e2
test "$(git -C "$tree" rev-parse HEAD^{tree})" = 12ed2ba3e8be11ccf5ba79aba684b03ca7c82cd5
git -C "$tree" diff --quiet
git -C "$tree" diff --cached --quiet
git -C "$main" diff --cached --quiet

node "$strict" --manifest "$evidence/SOURCE-MANIFEST.sha256" --root "$main" --expected-count 4
node "$strict" --manifest "$evidence/MANIFEST.sha256" --root "$evidence" --expected-count 21

node - "$evidence" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const evidence = process.argv[2];
const expectedRuns = {
  'dependency-setup': 'v2-artifact-build-17-dependency-setup',
  build: 'v2-artifact-build-17-build',
  'artifact-verify': 'v2-artifact-build-17-artifact-verify',
  'metadata-format': 'v2-artifact-build-17-metadata-format',
};
for (const [receipt, runId] of Object.entries(expectedRuns)) {
  const value = JSON.parse(fs.readFileSync(path.join(evidence, `${receipt}.window.json.log`), 'utf8'));
  if (value.status !== 'PASS' || value.exitCode !== 0 || value.runId !== runId) process.exit(1);
}
const receipt = JSON.parse(fs.readFileSync(path.join(evidence, 'harness-artifact.json.log'), 'utf8'));
const inspection = JSON.parse(fs.readFileSync(path.join(evidence, 'artifact-inspection.stdout.json.log'), 'utf8'));
const delivery = JSON.parse(fs.readFileSync(path.join(evidence, 'delivery-validation.json'), 'utf8'));
const expected = {
  sourceSha: '4052dae01d4527bd1747a60358cf59469ab1b3e2',
  sourceDigest: '21c84cd108b96deb6187a474bddf9779e027d2095be82a404b27c4815d321671',
  lockDigest: '44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169',
  artifactDigest: 'da1c156aaf1c4e3b40a12087301466e2b14291a49f4b5d5a1dfed66afe5c032f',
  builtAt: '2026-09-29T05:20:40.897Z',
};
for (const [key, value] of Object.entries(expected)) {
  if (receipt[key] !== value || inspection[key] !== value) process.exit(1);
}
if (Object.keys(receipt.files).length !== 276 || inspection.status !== 'PASS') process.exit(1);
if (inspection.artifactFiles !== 276 || inspection.diskFilesIncludingReceipt !== 277) process.exit(1);
if (inspection.missing.length || inspection.extra.length || inspection.mismatched.length || inspection.symlinks.length)
  process.exit(1);
if (inspection.sameAsBuild16 || inspection.changedPathCount !== 10) process.exit(1);
if (inspection.productionSourceChanges.length !== 4) process.exit(1);
if (!inspection.packLock.equal || inspection.packLockEntryCount !== 1) process.exit(1);
if (inspection.packLockEntry.contentType !== 'audio/mpeg') process.exit(1);
if (inspection.mp3.length !== 3 || inspection.mp3.some((entry) => entry.bytes !== 2976045)) process.exit(1);
if (inspection.mp3.some((entry) => entry.sha256 !== '3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9'))
  process.exit(1);
if (delivery.stage !== 'V2-ARTIFACT-BUILD-17' || delivery.status !== 'PASS') process.exit(1);
if (delivery.finalSelfcheck.status !== 'PENDING_WRAPPER_RECEIPT') process.exit(1);
NODE

test "$(hash_file "$evidence/harness-artifact.json.log")" = f00fe6ff759dfa8d5f73bea92d83c25ddd0495b67d2e6cd355ed0201ee2f4043
test "$(hash_file "$evidence/artifact-map.sha256.log")" = 766478f46bb2b048317e149a595c5a704c26788dc8a28a49ee43b4a33effccde
test "$(hash_file "$evidence/dist-files.sha256.log")" = 766478f46bb2b048317e149a595c5a704c26788dc8a28a49ee43b4a33effccde
test "$(hash_file "$evidence/artifact-map-vs-build16.diff.log")" = f5af9f23a21cd3a1e189e94ad3bf3243938a872ab8be5f290db09564decded7d

for link in \
  node_modules/@seedlands/kernel \
  node_modules/@seedlands/stdlib \
  node_modules/@seedlands/playbook-classic \
  apps/web/node_modules/@seedlands/kernel \
  apps/web/node_modules/@seedlands/stdlib \
  apps/web/node_modules/@seedlands/playbook-classic \
  playbooks/classic/node_modules/@seedlands/stdlib; do
  resolved=$(realpath "$tree/$link")
  case "$resolved" in
    "$tree"/*) ;;
    *) exit 1 ;;
  esac
done

actual=$(git -C "$main" status --short --untracked-files=all -- \
  changes/2026-09-23-classic-functional-completion/v2-artifact-build-evidence.md \
  changes/2026-09-23-classic-functional-completion/spec.md \
  changes/2026-09-23-classic-functional-completion/tasks.md \
  changes/2026-09-23-classic-functional-completion/execution-state.md \
  changes/2026-09-23-classic-functional-completion/evidence/v2-artifact-build-17)
test "$(printf '%s\n' "$actual" | sed '/^$/d' | wc -l | tr -d ' ')" = 29
printf '%s\n' "$actual" | awk '{print $2}' | while IFS= read -r owned_path; do
  case "$owned_path" in
    changes/2026-09-23-classic-functional-completion/v2-artifact-build-evidence.md|changes/2026-09-23-classic-functional-completion/spec.md|changes/2026-09-23-classic-functional-completion/tasks.md|changes/2026-09-23-classic-functional-completion/execution-state.md|changes/2026-09-23-classic-functional-completion/evidence/v2-artifact-build-17/*) ;;
    *) exit 1 ;;
  esac
done

max_bytes=$(find "$evidence" -type f -exec stat -f %z {} + | sort -nr | head -n 1)
test "$max_bytes" -lt 100000000
test "$(git -C "$main" show-ref --verify --hash refs/task-backups/git32-evidence-a402b016)" = a402b01623354a5c78e41260354a0fdd7c35394c

(cd "$main" && pnpm exec prettier --check \
  changes/2026-09-23-classic-functional-completion/v2-artifact-build-evidence.md \
  changes/2026-09-23-classic-functional-completion/spec.md \
  changes/2026-09-23-classic-functional-completion/tasks.md \
  changes/2026-09-23-classic-functional-completion/execution-state.md \
  changes/2026-09-23-classic-functional-completion/evidence/v2-artifact-build-17/README.md \
  changes/2026-09-23-classic-functional-completion/evidence/v2-artifact-build-17/delivery-validation.json)

printf 'BUILD17_FINAL_SELFCHECK=PASS\n'
