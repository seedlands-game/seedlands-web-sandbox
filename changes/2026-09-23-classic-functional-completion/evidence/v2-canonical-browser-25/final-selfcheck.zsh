#!/bin/zsh

set -e

main=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
tree=/private/tmp/seedlands-v2-acceptance-fdb53c07
evidence=$main/changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-25
report=$main/changes/2026-09-23-classic-functional-completion/v2-canonical-browser-evidence.md
strict=$main/changes/2026-09-23-classic-functional-completion/evidence/git-40-canonical-discovery/manifest-closure/strict-manifest.mjs

hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }

test "$(git -C "$tree" rev-parse HEAD)" = fdb53c07c0da14c7f523473e4f33060a385f23ff
test "$(git -C "$tree" rev-parse HEAD^{tree})" = ecc7940708bca8ea1d01e8df50337fa536d27d18
git -C "$tree" diff --quiet
git -C "$tree" diff --cached --quiet
git -C "$main" diff --cached --quiet

head -n 5 "$evidence/SOURCE-MANIFEST.sha256" > /private/tmp/browser25-acceptance-source.sha256
(cd "$tree" && node "$strict" --manifest /private/tmp/browser25-acceptance-source.sha256 --root . --expected-count 5)
tail -n 1 "$evidence/SOURCE-MANIFEST.sha256" > /private/tmp/browser25-main-source.sha256
(cd "$main" && node "$strict" --manifest /private/tmp/browser25-main-source.sha256 --root . --expected-count 1)
node "$strict" --manifest "$evidence/MANIFEST.sha256" --root "$evidence" --expected-count 84

node - "$evidence/classic.json.log" "$evidence/result-summary.json" "$evidence/v2-checkpoints.json" <<'NODE'
const fs = require('node:fs');
const [receiptPath, summaryPath, checkpointsPath] = process.argv.slice(2);
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const checkpoints = JSON.parse(fs.readFileSync(checkpointsPath, 'utf8'));
const attempt = receipt.attempts[0];
const expectedSteps = [
  'resources-placed',
  'wood-collected',
  'wood-pickaxe-equipped',
  'stone-collected',
  'stone-pickaxe-equipped',
  'iron-blocks-collected',
  'five-iron-armor-crafted',
  'helmet-click',
  'chestplate-quick-move',
  'leggings-quick-move',
  'boots-quick-move',
  'wrong-slot-zero-change',
  'occupied-helmet-swap',
  'swapped-helmet-stored',
  'chestplate-detached',
  'chestplate-stored',
  'chestplate-quick-move',
  'equipment-origin-close',
  'workbench-reclaimed',
];
if (receipt.status !== 'PASS' || receipt.runnerOutcome !== 'passed') process.exit(1);
if (receipt.selection.mode !== 'CANONICAL_MAIN' || !receipt.selection.canonicalMainSelected) process.exit(1);
if (receipt.selection.canonicalMainMatches !== 1 || receipt.attempts.length !== 1 || receipt.conflicts.length !== 0)
  process.exit(1);
if (receipt.runId !== 'v2-canonical-browser-25-fdb53c07' || receipt.sourceSha !== 'fdb53c07c0da14c7f523473e4f33060a385f23ff')
  process.exit(1);
if (attempt.attempt !== 0 || attempt.testOutcome !== 'passed' || attempt.status !== 'PASS') process.exit(1);
if (attempt.testId !== 'c1221f8f363362ddeabe-684679c2f0f617936171') process.exit(1);
if (attempt.file !== 'apps/web/tests/e2e/classic-runtime.spec.ts' || attempt.project !== 'chromium') process.exit(1);
if (attempt.test !== 'Classic 生产旅程以真实输入完成 C0-C5，并复用同一运行时性能场景') process.exit(1);
if (!attempt.assertionEvidencePresent || attempt.assertionEvidenceStatus !== 'PASS') process.exit(1);
if (attempt.failureEvidencePresent || attempt.resultErrors.length || attempt.receiptErrors.length) process.exit(1);
if (Object.values(attempt.stages).some((stage) => stage.status !== 'PASS')) process.exit(1);
if (attempt.pageErrors.length || attempt.failedResponses.length) process.exit(1);
if (summary.status !== 'PASS' || summary.tests.length !== 3 || summary.playwrightStats.expected !== 2) process.exit(1);
if (summary.playwrightStats.unexpected !== 0 || summary.playwrightStats.skipped !== 1) process.exit(1);
if (checkpoints.phase !== 'ready-to-save' || checkpoints.count !== 19) process.exit(1);
if (JSON.stringify(checkpoints.steps.map((entry) => entry.step)) !== JSON.stringify(expectedSteps)) process.exit(1);
const byStep = Object.fromEntries(checkpoints.steps.map((entry) => [entry.step, entry]));
if (byStep['wood-collected'].resourceCounts.woodBlock !== 3) process.exit(1);
if (byStep['stone-collected'].resourceCounts.cobblestone !== 3) process.exit(1);
if (byStep['iron-blocks-collected'].resourceCounts.ironBlock !== 4) process.exit(1);
if (byStep['stone-pickaxe-equipped'].stonePickaxeDurability !== 132) process.exit(1);
if (byStep['iron-blocks-collected'].stonePickaxeDurability !== 128) process.exit(1);
if (byStep['workbench-reclaimed'].stonePickaxeDurability !== 127) process.exit(1);
if (byStep['wrong-slot-zero-change'].armorPoints !== 15) process.exit(1);
if (byStep['occupied-helmet-swap'].cursor.origin?.kind !== 'equipment') process.exit(1);
if (byStep['chestplate-detached'].cursor.origin?.slot !== 'chestplate') process.exit(1);
if (byStep['equipment-origin-close'].cursor.itemId !== null) process.exit(1);
if (checkpoints.preSave.stonePickaxeDurability !== 127 || checkpoints.restored.stonePickaxeDurability !== 127)
  process.exit(1);
if (checkpoints.preSave.armorPoints !== 15 || checkpoints.restored.armorPoints !== 15) process.exit(1);
if (Object.values(checkpoints.preSave.armor).some((item) => item?.durability !== 165)) process.exit(1);
if (Object.values(checkpoints.restored.armor).some((item) => item?.durability !== 165)) process.exit(1);
if (checkpoints.preSave.ironIngotCount !== 7 || checkpoints.restored.ironIngotCount !== 7) process.exit(1);
if (checkpoints.preSave.workbenchCount !== 1 || checkpoints.restored.workbenchCount !== 1) process.exit(1);
if (checkpoints.preSave.inventoryRevision !== 143 || checkpoints.restored.inventoryRevision !== 143) process.exit(1);
if (checkpoints.continued.inventoryRevision !== 145 || checkpoints.preSave.actor.epoch !== 1) process.exit(1);
if (checkpoints.restored.actor.epoch !== 2 || checkpoints.restored.actor.lifetime !== 1) process.exit(1);
if (JSON.stringify(checkpoints.worldBefore) !== JSON.stringify(checkpoints.worldAfter)) process.exit(1);
NODE

node - "$evidence/playwright-attachments.json" "$evidence" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const [mapPath, root] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
const seen = new Set();
for (const row of rows) {
  if (seen.has(row.archivedPath)) process.exit(1);
  seen.add(row.archivedPath);
  const bytes = fs.readFileSync(path.join(root, row.archivedPath));
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== row.sizeBytes || hash !== row.sha256) process.exit(1);
}
if (rows.length !== 55 || seen.size !== 55 || fs.readdirSync(path.join(root, 'attachments')).length !== 55) process.exit(1);
NODE

for receipt in canonical-window.json.log artifact-postcheck-window.json.log metadata-format.window.json.log; do
  node - "$evidence/$receipt" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value.status !== 'PASS' || value.exitCode !== 0) process.exit(1);
NODE
done

node - "$evidence/artifact-postcheck-readback.json" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value.status !== 'PASS' || value.identity.sourceSha !== 'fdb53c07c0da14c7f523473e4f33060a385f23ff')
  process.exit(1);
if (!value.sameAsBuild16 || value.artifactFiles !== 276 || value.diskFilesIncludingReceipt !== 277) process.exit(1);
if (value.missing.length || value.extra.length || value.mismatched.length || value.symlinks.length) process.exit(1);
NODE

test "$(cat "$evidence/trace-disposition.txt")" = NOT_RETAINED_BY_CONFIG
test "$(find "$tree/test-results" "$tree/playwright-report" -type f -name trace.zip 2>/dev/null | wc -l | tr -d ' ')" = 0
test "$(cat "$evidence/playwright-report-zip-test.exit-code.txt")" = 0
rg -q 'No errors detected in compressed data' "$evidence/playwright-report-zip-test.stdout.log"

awk 'BEGIN{keep=0} /^## Browser-24 正式验收/{keep=1} keep{print}' "$report" > /private/tmp/browser25-final-tail.md
test "$(stat -f %z /private/tmp/browser25-final-tail.md)" = 66845
test "$(hash_file /private/tmp/browser25-final-tail.md)" = b5f25ee4c270dfa9e8765268ddaa5ccecb66a717ab7b3b7bc1ca1df4a8d117af

node - "$evidence/delivery-validation.json" "$evidence/SOURCE-MANIFEST.sha256" "$evidence/MANIFEST.sha256" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [deliveryPath, sourcePath, manifestPath] = process.argv.slice(2);
const delivery = JSON.parse(fs.readFileSync(deliveryPath, 'utf8'));
const digest = (path) => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
if (delivery.sourceManifest.entries !== 6 || delivery.sourceManifest.sha256 !== digest(sourcePath)) process.exit(1);
if (delivery.evidenceManifest.entries !== 84 || delivery.evidenceManifest.sha256 !== digest(manifestPath)) process.exit(1);
if (delivery.finalSelfcheck.status !== 'PASS') process.exit(1);
NODE

actual=$(git -C "$main" status --short --untracked-files=all -- \
  changes/2026-09-23-classic-functional-completion/v2-canonical-browser-evidence.md \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-25)
test "$(printf '%s\n' "$actual" | sed '/^$/d' | wc -l | tr -d ' ')" = 88
printf '%s\n' "$actual" | awk '{print $2}' | while IFS= read -r owned_path; do
  case "$owned_path" in
    changes/2026-09-23-classic-functional-completion/v2-canonical-browser-evidence.md|changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-25/*) ;;
    *) exit 1 ;;
  esac
done
max_bytes=$(find "$evidence" -type f -exec stat -f %z {} + | sort -nr | head -n 1)
test "$max_bytes" -lt 100000000

(cd "$main" && pnpm exec prettier --check \
  changes/2026-09-23-classic-functional-completion/v2-canonical-browser-evidence.md \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-25/README.md \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-25/diagnosis.json \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-25/delivery-validation.json \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-25/playwright-attachments.json \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-25/result-summary.json \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-25/main-step-timeline.json \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-25/v2-checkpoints.json \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-25/artifact-postcheck-readback.json)

printf 'BROWSER25_FINAL_SELFCHECK=PASS\n'
