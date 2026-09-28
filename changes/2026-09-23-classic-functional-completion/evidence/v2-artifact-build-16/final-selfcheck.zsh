#!/bin/zsh

set -e

main=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
tree=/private/tmp/seedlands-v2-acceptance-fdb53c07
evidence=$main/changes/2026-09-23-classic-functional-completion/evidence/v2-artifact-build-16
strict=$main/changes/2026-09-23-classic-functional-completion/evidence/git-40-canonical-discovery/manifest-closure/strict-manifest.mjs

hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }

test "$(git -C "$tree" rev-parse HEAD)" = fdb53c07c0da14c7f523473e4f33060a385f23ff
test "$(git -C "$tree" rev-parse HEAD^{tree})" = ecc7940708bca8ea1d01e8df50337fa536d27d18
git -C "$tree" diff --quiet
git -C "$tree" diff --cached --quiet
git -C "$main" diff --cached --quiet

node "$strict" --manifest "$evidence/SOURCE-MANIFEST.sha256" --root "$main" --expected-count 4
node "$strict" --manifest "$evidence/MANIFEST.sha256" --root "$evidence" --expected-count 22

for receipt in dependency-setup build artifact-verify metadata-format; do
  node - "$evidence/$receipt.window.json.log" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value.status !== 'PASS' || value.exitCode !== 0) process.exit(1);
NODE
done

node - "$evidence/harness-artifact.json.log" "$evidence/artifact-inspection.stdout.json.log" <<'NODE'
const fs = require('node:fs');
const [receiptPath, inspectionPath] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
const inspection = JSON.parse(fs.readFileSync(inspectionPath, 'utf8'));
const expected = {
  sourceSha: 'fdb53c07c0da14c7f523473e4f33060a385f23ff',
  sourceDigest: '80ec89b82c297f451902bd5661b56c31ef6d1be76774bd93a3fcd11c10d0c574',
  lockDigest: '44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169',
  artifactDigest: 'f6f1ea672dc8d19dacf70482aa900538c6d81f33637c16e9a718fc22fc1acfa4',
  builtAt: '2026-09-28T23:19:29.712Z',
};
for (const [key, value] of Object.entries(expected)) {
  if (receipt[key] !== value || inspection[key] !== value) process.exit(1);
}
if (Object.keys(receipt.files).length !== 276 || inspection.status !== 'PASS') process.exit(1);
if (inspection.artifactFiles !== 276 || inspection.diskFilesIncludingReceipt !== 277) process.exit(1);
if (inspection.missing.length || inspection.extra.length || inspection.mismatched.length || inspection.symlinks.length)
  process.exit(1);
if (!inspection.sameAsBuild15 || !inspection.packLock.equal || inspection.packLockEntryCount !== 1) process.exit(1);
if (inspection.packLockEntry.contentType !== 'audio/mpeg') process.exit(1);
if (inspection.mp3.length !== 3 || inspection.mp3.some((entry) => entry.bytes !== 2976045)) process.exit(1);
if (inspection.mp3.some((entry) => entry.sha256 !== '3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9'))
  process.exit(1);
NODE

test "$(hash_file "$evidence/harness-artifact.json.log")" = 5af78cfc542d641f4e6bf5cd0e503a616db2c146db4d8f53b187af2a1eb86702
test "$(hash_file "$evidence/artifact-map.sha256.log")" = d1babe3ba4b9a2326cb1e1304b77f8045838ed7004c708e71bc692dc61ef3aa6
test "$(hash_file "$evidence/dist-files.sha256.log")" = d1babe3ba4b9a2326cb1e1304b77f8045838ed7004c708e71bc692dc61ef3aa6
test ! -s "$evidence/artifact-map-vs-build15.diff.log"

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
  changes/2026-09-23-classic-functional-completion/evidence/v2-artifact-build-16)
test "$(printf '%s\n' "$actual" | sed '/^$/d' | wc -l | tr -d ' ')" = 29
printf '%s\n' "$actual" | awk '{print $2}' | while IFS= read -r owned_path; do
  case "$owned_path" in
    changes/2026-09-23-classic-functional-completion/v2-artifact-build-evidence.md|changes/2026-09-23-classic-functional-completion/spec.md|changes/2026-09-23-classic-functional-completion/tasks.md|changes/2026-09-23-classic-functional-completion/execution-state.md|changes/2026-09-23-classic-functional-completion/evidence/v2-artifact-build-16/*) ;;
    *) exit 1 ;;
  esac
done

max_bytes=$(find "$evidence" -type f -exec stat -f %z {} + | sort -nr | head -n 1)
test "$max_bytes" -lt 100000000

(cd "$main" && pnpm exec prettier --check \
  changes/2026-09-23-classic-functional-completion/v2-artifact-build-evidence.md \
  changes/2026-09-23-classic-functional-completion/spec.md \
  changes/2026-09-23-classic-functional-completion/tasks.md \
  changes/2026-09-23-classic-functional-completion/execution-state.md \
  changes/2026-09-23-classic-functional-completion/evidence/v2-artifact-build-16/README.md \
  changes/2026-09-23-classic-functional-completion/evidence/v2-artifact-build-16/delivery-validation.json)

printf 'BUILD16_FINAL_SELFCHECK=PASS\n'
