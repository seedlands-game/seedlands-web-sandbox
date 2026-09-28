#!/bin/zsh

set -e

main=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
tree=/private/tmp/seedlands-v2-acceptance-556c9b76
evidence=$main/changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-24
report=$main/changes/2026-09-23-classic-functional-completion/v2-canonical-browser-evidence.md

hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }

test "$(git -C "$tree" rev-parse HEAD)" = 556c9b76fb4447c49ad7d6f7a76bd7233d0011e6
test "$(git -C "$tree" rev-parse HEAD^{tree})" = 45ef275288163c3880bd9ea75d28c62996f3723a
git -C "$tree" diff --quiet
git -C "$tree" diff --cached --quiet
git -C "$main" diff --cached --quiet

head -n 6 "$evidence/SOURCE-MANIFEST.sha256" > /private/tmp/browser24-acceptance-source-manifest.sha256
(cd "$tree" && shasum -a 256 -c /private/tmp/browser24-acceptance-source-manifest.sha256)
tail -n 1 "$evidence/SOURCE-MANIFEST.sha256" > /private/tmp/browser24-main-source-manifest.sha256
(cd "$main" && shasum -a 256 -c /private/tmp/browser24-main-source-manifest.sha256)
(cd "$evidence" && shasum -a 256 -c MANIFEST.sha256)
test "$(hash_file "$evidence/SOURCE-MANIFEST.sha256")" = ad8b5a66672e967ed0f73b839c1354f54e922edd69fc92ade94833b778bf7b1a
node -e 'const fs=require("node:fs");const crypto=require("node:crypto");const [d,m]=process.argv.slice(1);const delivery=JSON.parse(fs.readFileSync(d,"utf8"));const hash=crypto.createHash("sha256").update(fs.readFileSync(m)).digest("hex");if(delivery.evidenceManifest.sha256!==hash||delivery.finalSelfcheck.status!=="PASS")process.exit(1)' "$evidence/delivery-validation.json" "$evidence/MANIFEST.sha256"

node -e 'const fs=require("node:fs");const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(r.status!=="FAIL"||r.runId!=="v2-canonical-browser-24-556c9b76"||r.sourceSha!=="556c9b76fb4447c49ad7d6f7a76bd7233d0011e6"||r.selection.mode!=="NON_MAIN"||r.selection.canonicalMainSelected||r.selection.canonicalMainMatches!==0||r.attempts.length!==0||r.runnerOutcome!=="failed")process.exit(1)' "$evidence/classic.json.log"
test "$(hash_file "$evidence/classic.json.log")" = 5674f2e6c2345fbf17a03b6c3bb3f86ec0ef71e4b9c689e8c4ca75f3fe6734e0
rg -q 'Cannot find module .*predecessor-close15.*visual-rebuild' "$evidence/runner.stdout.log"
rg -q 'Cannot find module .*null-closure/prior-release.*visual-rebuild' "$evidence/runner.stdout.log"
test "$(cat "$evidence/trace-disposition.txt")" = NOT_PRODUCED_BEFORE_TEST_DISCOVERY_FAILURE
test "$(find "$tree/test-results" "$tree/playwright-report" -type f -name 'trace.zip' 2>/dev/null | wc -l | tr -d ' ')" = 0

node -e 'const fs=require("node:fs");const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(x.status!=="PASS"||x.exitCode!==0)process.exit(1)' "$evidence/artifact-postcheck-window.json.log"
rg -q 'sourceSha.*556c9b76fb4447c49ad7d6f7a76bd7233d0011e6' "$evidence/artifact-postcheck.stdout.log"
rg -q 'artifactDigest.*f6f1ea672dc8d19dacf70482aa900538c6d81f33637c16e9a718fc22fc1acfa4' "$evidence/artifact-postcheck.stdout.log"

awk 'BEGIN{keep=0} /^## Browser-23 正式验收/{keep=1} keep{print}' "$report" > /private/tmp/browser24-final-tail.md
test "$(stat -f %z /private/tmp/browser24-final-tail.md)" = 64589
test "$(hash_file /private/tmp/browser24-final-tail.md)" = d19ec067355f7278d460aef24ab533d8deb1bf535e73c1ffde65946a4dc2c45f

(cd "$main" && pnpm exec prettier --check \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-24/diagnosis.json \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-24/delivery-validation.json \
  changes/2026-09-23-classic-functional-completion/v2-canonical-browser-evidence.md)
printf 'BROWSER24_FINAL_SELFCHECK=PASS\n'
