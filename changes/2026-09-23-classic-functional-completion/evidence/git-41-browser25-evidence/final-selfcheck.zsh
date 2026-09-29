#!/bin/zsh

set -euo pipefail

root=$(git rev-parse --show-toplevel)
base=changes/2026-09-23-classic-functional-completion
evidence=$base/evidence/git-41-browser25-evidence
browser25=$base/evidence/v2-canonical-browser-25
strict=$base/evidence/git-40-canonical-discovery/manifest-closure/strict-manifest.mjs

hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }

cd "$root"
test "$(git rev-parse HEAD)" = 783e106fb5fcba4869bcc8d0aab68ada1df827a7
node "$strict" --manifest "$evidence/SOURCE-MANIFEST.sha256" --root . --expected-count 6
node "$strict" --manifest "$evidence/MANIFEST.sha256" --root "$evidence" --expected-count 8
node "$strict" --manifest "$browser25/MANIFEST.sha256" --root "$browser25" --expected-count 84

test "$(hash_file "$browser25/SOURCE-MANIFEST.sha256")" = c0d37c2742c8a9627c4839d0cde0c1d5eb7dd17cdfff4c39bd13c7064d8c49eb
test "$(hash_file "$browser25/MANIFEST.sha256")" = 78b45e794bb2688cb75acf4756df80fc6691b456e7881eff14f210c713722a2c
test "$(hash_file "$browser25/delivery-validation.json")" = f227181902cecbe52d7b45e666c8ac9c4a0cc8e227b38df56f84988ac2942838
test "$(find "$browser25" -type f | wc -l | tr -d ' ')" = 88

awk 'BEGIN{keep=0} /^## Browser-24 正式验收/{keep=1} keep{print}' "$base/v2-canonical-browser-evidence.md" > /tmp/git41-browser25-tail.md
test "$(stat -f %z /tmp/git41-browser25-tail.md)" = 66845
test "$(hash_file /tmp/git41-browser25-tail.md)" = b5f25ee4c270dfa9e8765268ddaa5ccecb66a717ab7b3b7bc1ca1df4a8d117af

node - "$evidence/delivery-validation.json" "$evidence/SOURCE-MANIFEST.sha256" "$evidence/MANIFEST.sha256" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [deliveryPath, sourcePath, manifestPath] = process.argv.slice(2);
const delivery = JSON.parse(fs.readFileSync(deliveryPath, 'utf8'));
const digest = (path) => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
if (delivery.stage !== 'GIT-41-BROWSER25-EVIDENCE') process.exit(1);
if (delivery.status !== 'PASS_PENDING_NATURAL_HOOK') process.exit(1);
if (delivery.baseline !== '783e106fb5fcba4869bcc8d0aab68ada1df827a7') process.exit(1);
if (delivery.browser25.sourceManifestSha256 !== 'c0d37c2742c8a9627c4839d0cde0c1d5eb7dd17cdfff4c39bd13c7064d8c49eb')
  process.exit(1);
if (delivery.browser25.evidenceManifestSha256 !== '78b45e794bb2688cb75acf4756df80fc6691b456e7881eff14f210c713722a2c')
  process.exit(1);
if (delivery.browser25.deliverySha256 !== 'f227181902cecbe52d7b45e666c8ac9c4a0cc8e227b38df56f84988ac2942838')
  process.exit(1);
if (delivery.sourceManifest.entries !== 6 || delivery.sourceManifest.sha256 !== digest(sourcePath)) process.exit(1);
if (delivery.evidenceManifest.entries !== 8 || delivery.evidenceManifest.sha256 !== digest(manifestPath)) process.exit(1);
if (delivery.commitScope.browser25Files !== 88 || delivery.commitScope.browser25AndCumulativePaths !== 89)
  process.exit(1);
if (delivery.commitScope.git41EvidencePaths !== 12 || delivery.commitScope.totalPaths !== 103) process.exit(1);
if (delivery.boundaries.browserRerun || delivery.boundaries.buildRerun || delivery.boundaries.productGreenClaimed)
  process.exit(1);
NODE

rg -q 'Browser25 已由 root 独立验收' "$base/tasks.md"
rg -q 'Browser25 已由 root 独立验收' "$base/execution-state.md"
rg -q '^## Browser-25 正式验收$' "$base/v2-canonical-browser-evidence.md"

actual=/tmp/git41-browser25-staged.actual.paths
git diff --cached --name-only | LC_ALL=C sort > /tmp/git41-browser25-staged.all.paths
awk -v evidence="$evidence" '$0 != evidence "/final-selfcheck.stdout.log" && $0 != evidence "/final-selfcheck.window.json.log"' \
  /tmp/git41-browser25-staged.all.paths > "$actual"
awk -v evidence="$evidence" '$0 != evidence "/final-selfcheck.stdout.log" && $0 != evidence "/final-selfcheck.window.json.log"' \
  "$evidence/evidence.paths" > /tmp/git41-browser25-expected-before-selfcheck.paths
cmp /tmp/git41-browser25-expected-before-selfcheck.paths "$actual"
test "$(wc -l < "$evidence/evidence.paths" | tr -d ' ')" = 103
test "$(LC_ALL=C sort -u "$evidence/evidence.paths" | wc -l | tr -d ' ')" = 103

max_blob=0
while IFS= read -r owned_path; do
  if [[ "$owned_path" == "$evidence/final-selfcheck.stdout.log" || "$owned_path" == "$evidence/final-selfcheck.window.json.log" ]]; then
    continue
  fi
  object=$(git ls-files -s -- "$owned_path" | awk '{print $2}')
  test -n "$object"
  size=$(git cat-file -s "$object")
  (( size < 100000000 ))
  if (( size > max_blob )); then max_blob=$size; fi
done < "$evidence/evidence.paths"
printf 'MAX_STAGED_BLOB_BYTES=%s\n' "$max_blob"

set +e
git diff --cached --check > /tmp/git41-browser25-diff-check.log
diff_status=$?
set -e
if (( diff_status != 0 )); then
  awk -F: '/^[^+].*:[0-9]+:/ && $1 !~ /^changes\/2026-09-23-classic-functional-completion\/evidence\/v2-canonical-browser-25\/.*\.log$/ { bad = 1 } END { exit bad }' \
    /tmp/git41-browser25-diff-check.log
  printf 'DIFF_CHECK=EXPECTED_FROZEN_RAW_ONLY\n'
else
  printf 'DIFF_CHECK=PASS\n'
fi

"$root/node_modules/.bin/prettier" --check \
  "$base/v2-canonical-browser-evidence.md" \
  "$base/tasks.md" \
  "$base/execution-state.md" \
  "$browser25/README.md" \
  "$browser25/artifact-postcheck-readback.json" \
  "$browser25/delivery-validation.json" \
  "$browser25/diagnosis.json" \
  "$browser25/main-step-timeline.json" \
  "$browser25/playwright-attachments.json" \
  "$browser25/result-summary.json" \
  "$browser25/v2-checkpoints.json" \
  "$evidence/README.md" \
  "$evidence/delivery-validation.json"

printf 'GIT41_FINAL_SELFCHECK=PASS\n'
