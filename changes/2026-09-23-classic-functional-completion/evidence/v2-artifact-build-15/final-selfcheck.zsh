#!/bin/zsh

set -e

main=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
tree=/private/tmp/seedlands-v2-acceptance-556c9b76
evidence=$main/changes/2026-09-23-classic-functional-completion/evidence/v2-artifact-build-15

hash_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

test "$(git -C "$tree" rev-parse HEAD)" = 556c9b76fb4447c49ad7d6f7a76bd7233d0011e6
test "$(git -C "$tree" rev-parse HEAD^{tree})" = 45ef275288163c3880bd9ea75d28c62996f3723a
git -C "$tree" diff --quiet
git -C "$tree" diff --cached --quiet
test "$(git -C "$main" diff --cached --name-only | wc -l | tr -d ' ')" = 0

(cd "$main" && shasum -a 256 -c "$evidence/SOURCE-MANIFEST.sha256")
(cd "$evidence" && shasum -a 256 -c MANIFEST.sha256)
test "$(hash_file "$evidence/SOURCE-MANIFEST.sha256")" = 14f6ea8ac362a42f47262feafb525c51ebfcd90b10e2858374a7f7d9795c0565
node -e 'const fs=require("node:fs");const crypto=require("node:crypto");const [deliveryPath,manifestPath]=process.argv.slice(1);const d=JSON.parse(fs.readFileSync(deliveryPath,"utf8"));const hash=crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");if(d.evidenceManifest.sha256!==hash||d.evidenceManifest.entries!==18||d.finalSelfcheck.status!=="PASS")process.exit(1);' \
  "$evidence/delivery-validation.json" \
  "$evidence/MANIFEST.sha256"

node -e 'const fs=require("node:fs"); const p=require("node:path"); const a=JSON.parse(fs.readFileSync(p.join(process.argv[1],"apps/web/dist/harness-artifact.json"))); if(a.sourceSha!=="556c9b76fb4447c49ad7d6f7a76bd7233d0011e6"||a.sourceDigest!=="a4bdd67ba41aa5e59c3650f5fcbcb0ffd7e37737f666a941fd79c6e379ddb136"||a.lockDigest!=="44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169"||a.artifactDigest!=="f6f1ea672dc8d19dacf70482aa900538c6d81f33637c16e9a718fc22fc1acfa4"||Object.keys(a.files).length!==276) process.exit(1);' "$tree"
test "$(hash_file "$tree/apps/web/dist/harness-artifact.json")" = f9a31b847ac71bdbdbf2aa7614039a0b5872d0f44e4b0aab9f1848d04a9045cf
test "$(hash_file "$evidence/artifact-map.sha256.log")" = d1babe3ba4b9a2326cb1e1304b77f8045838ed7004c708e71bc692dc61ef3aa6
test "$(hash_file "$evidence/dist-files.sha256.log")" = d1babe3ba4b9a2326cb1e1304b77f8045838ed7004c708e71bc692dc61ef3aa6
test "$(hash_file "$evidence/artifact-map-vs-build14.diff.log")" = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
rg -q 'mapsEqual=true' "$evidence/artifact-map-compare.stdout.log"
rg -q 'missing=\[\]' "$evidence/artifact-map-compare.stdout.log"
rg -q 'extra=\[\]' "$evidence/artifact-map-compare.stdout.log"
rg -q 'mismatched=\[\]' "$evidence/artifact-map-compare.stdout.log"
rg -q 'symlinks=\[\]' "$evidence/artifact-map-compare.stdout.log"
rg -q 'sourcePublicDistMatch=true' "$evidence/pack-media.stdout.log"
rg -q 'packLockEntryMatches=true' "$evidence/pack-media.stdout.log"

for receipt in dependency-setup build artifact-verify; do
  node -e 'const fs=require("node:fs");const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(x.status!=="PASS"||x.exitCode!==0)process.exit(1)' "$evidence/$receipt.window.json.log"
done

for link in node_modules/@seedlands/kernel node_modules/@seedlands/stdlib node_modules/@seedlands/playbook-classic apps/web/node_modules/@seedlands/kernel apps/web/node_modules/@seedlands/stdlib apps/web/node_modules/@seedlands/playbook-classic playbooks/classic/node_modules/@seedlands/stdlib; do
  resolved=$(realpath "$tree/$link")
  case "$resolved" in "$tree"/*) ;; *) exit 1 ;; esac
done

(cd "$main" && pnpm exec prettier --check \
  changes/2026-09-23-classic-functional-completion/evidence/v2-artifact-build-15/delivery-validation.json \
  changes/2026-09-23-classic-functional-completion/v2-artifact-build-evidence.md \
  changes/2026-09-23-classic-functional-completion/spec.md \
  changes/2026-09-23-classic-functional-completion/tasks.md \
  changes/2026-09-23-classic-functional-completion/execution-state.md)

printf 'BUILD15_FINAL_SELFCHECK=PASS\n'
