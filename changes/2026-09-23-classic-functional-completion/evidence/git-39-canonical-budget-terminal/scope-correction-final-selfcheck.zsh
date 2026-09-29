#!/bin/zsh

set -e

root=/private/tmp/seedlands-git39-canonical-budget-terminal
main=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
acceptance=/private/tmp/seedlands-v2-acceptance-0eafd427
base=changes/2026-09-23-classic-functional-completion
evidence=$base/evidence/git-39-canonical-budget-terminal
browser=$base/evidence/v2-canonical-browser-23
map=$base/evidence/v2-browser23-canonical-budget-map-01

hash_file() {
  shasum -a 256 "$1" | awk '{print $1}'
}

cd "$root"
test "$(git rev-parse HEAD)" = fca25ef13eb060b281aa90cf713ce4837b603b14
cmp \
  <(git diff --cached --name-only | LC_ALL=C sort) \
  <(awk '$0 != "changes/2026-09-23-classic-functional-completion/evidence/git-39-canonical-budget-terminal/scope-correction-final-selfcheck.stdout.log" && $0 != "changes/2026-09-23-classic-functional-completion/evidence/git-39-canonical-budget-terminal/scope-correction-final-selfcheck.window.json.log"' "$evidence/evidence-staged.paths")
cmp "$evidence/evidence-staged.paths" "$evidence/evidence-staged.actual.paths"
printf 'EXACT_STAGED_SCOPE=PASS\n'

shasum -a 256 -c "$evidence/SOURCE-MANIFEST.sha256"
(cd "$evidence" && shasum -a 256 -c MANIFEST.sha256)
node -e 'const fs=require("node:fs"); const crypto=require("node:crypto"); const [deliveryPath, manifestPath]=process.argv.slice(1); const delivery=JSON.parse(fs.readFileSync(deliveryPath, "utf8")); const hash=crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex"); if (delivery.evidenceManifest.entries !== 116 || delivery.evidenceManifest.sha256 !== hash || delivery.evidenceCommitAllowlistEntries !== 453 || delivery.scopeCorrectionFinalSelfcheck.status !== "PASS") process.exit(1);' \
  "$evidence/delivery-validation.json" \
  "$evidence/MANIFEST.sha256"
printf 'GIT39_SOURCE_AND_MANIFEST=PASS\n'

test "$(hash_file "$browser/SOURCE-MANIFEST.sha256")" = d275044b38e568f82eb054f11356fa1ea12faa5a0bf363b46bb80fdd485b1160
test "$(hash_file "$browser/MANIFEST.sha256")" = e985c56ac652b7af5c1c84bb4853f06d9f321c3754bd6fbb5e94f115c03fd188
test "$(hash_file "$browser/delivery-validation.json")" = 35842ab0daeebd431707a12f92bcf34a48ce25b9b28a2b13e78b9997134fc941
(cd "$browser" && shasum -a 256 -c MANIFEST.sha256)
test "$(hash_file "$map/SOURCE-MANIFEST.sha256")" = 1257c5a4382b49f9425dd17cfb3250958443415e0066f989f15a9bcbcfac3559
test "$(hash_file "$map/MANIFEST.sha256")" = 52d68bec8123d823c8d89bf0e956eabcc40e48e673ca23dc1851c9f28762e94d
test "$(hash_file "$map/delivery-validation.json")" = 0483a7701a555f0288f37ffdfc1804283eb2803b2d0f9d5209377db70cb555e0
(cd "$map" && shasum -a 256 -c MANIFEST.sha256)
while read -r expected filepath; do
  case "$filepath" in
    $browser/*) target=$filepath ;;
    *) target=$acceptance/$filepath ;;
  esac
  test "$(hash_file "$target")" = "$expected"
done < "$map/SOURCE-MANIFEST.sha256"
printf 'BROWSER23_AND_MAP_RESTORED=PASS\n'

prior_hook=$evidence/prior-hook-json
test "$(hash_file "$prior_hook/PRIOR-MANIFEST.sha256")" = 7e36a3178b043e7fb740631f164d447200bd945a4a95303fe302c3939ad2be3f
(cd "$prior_hook/files" && shasum -a 256 -c ../PRIOR-MANIFEST.sha256)
scope=$evidence/scope-correction
test "$(hash_file "$scope/INTERMEDIATE-MANIFEST.sha256")" = 7babca0720f2c7711eb0f0419d352298edd66f04f219e1da4825daf04da94e72
(cd "$scope/files" && shasum -a 256 -c ../INTERMEDIATE-MANIFEST.sha256)
printf 'PRIOR26_AND_SCOPE_CORRECTION=PASS\n'

raws=(artifact-readback.json playwright-attachments.json receipt-readback.json result-summary.json)
for name in "${raws[@]}"; do
  test -f "$browser/$name"
  test ! -e "$browser/$name.log"
  cmp "$browser/$name" "$prior_hook/files/$browser/$name.log"
done
md_raw=$browser/attachments/test-0-error-context.md.log
test "$(stat -f %z "$md_raw")" = 2800
test "$(hash_file "$md_raw")" = 499ae94ac08d04e70cc7e1775ca03a453b7c1daae16fd5f3b26209652c31a573
test ! -e "$browser/attachments/test-0-error-context.md"
printf 'RAW_PACKAGING_SCOPE=PASS\n'

test "$(hash_file "$evidence/staged-gate.stdout.log")" = a58fd069245dcd88b3365023814bff75f319d71296e4374389cc78fe9dfa2836
test "$(hash_file "$evidence/staged-gate.window.json.log")" = 7f46cf534e97388264d35e5c3bfeaf9d3cc84ea9621fd6afc2fa3126dc0c646b
rg -q 'pass 8' "$evidence/staged-gate.stdout.log"
rg -q 'canonical-reporter.test.ts \(5 tests\)' "$evidence/staged-gate.stdout.log"
rg -q 'performance-window.test.ts \(3 tests\)' "$evidence/staged-gate.stdout.log"
node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (value.status !== "PASS" || value.exitCode !== 0) process.exit(1)' "$evidence/staged-gate.window.json.log"
printf 'EXISTING_16_TEST_GATE=PASS\n'

largest=0
while IFS= read -r filepath; do
  size=$(git cat-file -s ":$filepath")
  (( size < 100000000 ))
  if (( size > largest )); then
    largest=$size
  fi
done < <(git diff --cached --name-only)
printf 'MAX_STAGED_BLOB_BYTES=%s\n' "$largest"
git -C "$main" diff --cached --quiet
printf 'MAIN_INDEX_EMPTY=PASS\n'

format_paths=("${(@f)$(git diff --cached --name-only -- '*.json' '*.css' '*.md' '*.yml' '*.yaml')}")
pnpm exec prettier --check "${format_paths[@]}"
pnpm lint:paths
printf 'NATURAL_FORMAT_AND_SCOPE=PASS\n'
printf 'GIT39_SCOPE_CORRECTION_FINAL_SELFCHECK=PASS\n'
