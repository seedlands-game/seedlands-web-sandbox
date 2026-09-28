#!/bin/zsh

set -e

root=/private/tmp/seedlands-git39-canonical-budget-terminal
main=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
acceptance=/private/tmp/seedlands-v2-acceptance-0eafd427
base=changes/2026-09-23-classic-functional-completion
evidence=$base/evidence/git-39-canonical-budget-terminal
raw=$base/evidence/v2-canonical-browser-23/attachments/test-0-error-context.md.log
prior=$evidence/prior-packaging

cd "$root"
test "$(git rev-parse HEAD)" = fca25ef13eb060b281aa90cf713ce4837b603b14
cmp \
  <(git diff --cached --name-only | LC_ALL=C sort) \
  <(awk '$0 != "changes/2026-09-23-classic-functional-completion/evidence/git-39-canonical-budget-terminal/recovery-selfcheck.stdout.log" && $0 != "changes/2026-09-23-classic-functional-completion/evidence/git-39-canonical-budget-terminal/recovery-selfcheck.window.json.log"' "$evidence/evidence-staged.paths")
cmp "$evidence/evidence-staged.paths" "$evidence/evidence-staged.actual.paths"
printf 'EXACT_STAGED_SCOPE=PASS\n'

shasum -a 256 -c "$evidence/SOURCE-MANIFEST.sha256"
(cd "$evidence" && shasum -a 256 -c MANIFEST.sha256)
(cd "$prior/files" && shasum -a 256 -c ../PRIOR-MANIFEST.sha256)
test "$(shasum -a 256 "$prior/PRIOR-MANIFEST.sha256" | awk '{print $1}')" = 891511bd6446a871e6c0fae7c933688572c1bfeb800a7bca615c2ad13b6ae4e5
cmp "$raw" "$prior/files/$base/evidence/v2-canonical-browser-23/attachments/test-0-error-context.md.log"
test "$(stat -f %z "$raw")" = 2800
test "$(shasum -a 256 "$raw" | awk '{print $1}')" = 499ae94ac08d04e70cc7e1775ca03a453b7c1daae16fd5f3b26209652c31a573
test ! -e "$base/evidence/v2-canonical-browser-23/attachments/test-0-error-context.md"
printf 'CURRENT_MANIFESTS_AND_RAW=PASS\n'
/bin/zsh "$evidence/verify-prior-packaging.zsh"
git -C "$acceptance" diff --quiet
git -C "$acceptance" diff --cached --quiet
test "$(git -C "$acceptance" rev-parse HEAD)" = 0eafd4273bc1f5a23e7d147ded37801436074015
printf 'ACCEPTANCE_IDENTITY_AND_CLEAN=PASS\n'

deliveries=(
  v2-canonical-browser-23=35842ab0daeebd431707a12f92bcf34a48ce25b9b28a2b13e78b9997134fc941
  v2-browser23-canonical-budget-map-01=0483a7701a555f0288f37ffdfc1804283eb2803b2d0f9d5209377db70cb555e0
  v2-canonical-budget-registration-close-15=b853e2cec7300f90f01cf43d9d021c0ad0df7bbbe9f9acd406277460d492f944
  v2-canonical-terminal-receipt-close-16=a4f0dd2668f1250294d174b73d2972ad90a548a70cd44a1ea3b13ad1a81f3896
  v2-canonical-terminal-receipt-close-16-null-closure=b1307e63d4176f42db1733808acc85c32ce02e370163b7c0c0024f0ab4ee6810
)
for delivery in "${deliveries[@]}"; do
  directory=${delivery%%=*}
  expected=${delivery#*=}
  frozen=$base/evidence/$directory
  (cd "$frozen" && shasum -a 256 -c MANIFEST.sha256)
  actual=$(shasum -a 256 "$frozen/delivery-validation.json" | awk '{print $1}')
  test "$actual" = "$expected"
done
printf 'CURRENT_DELIVERIES=PASS\n'

test "$(shasum -a 256 "$base/evidence/v2-canonical-browser-23/SOURCE-MANIFEST.sha256" | awk '{print $1}')" = d275044b38e568f82eb054f11356fa1ea12faa5a0bf363b46bb80fdd485b1160
test "$(shasum -a 256 "$base/evidence/v2-canonical-browser-23/MANIFEST.sha256" | awk '{print $1}')" = e985c56ac652b7af5c1c84bb4853f06d9f321c3754bd6fbb5e94f115c03fd188
test "$(shasum -a 256 "$base/evidence/v2-browser23-canonical-budget-map-01/SOURCE-MANIFEST.sha256" | awk '{print $1}')" = 1257c5a4382b49f9425dd17cfb3250958443415e0066f989f15a9bcbcfac3559
test "$(shasum -a 256 "$base/evidence/v2-browser23-canonical-budget-map-01/MANIFEST.sha256" | awk '{print $1}')" = 52d68bec8123d823c8d89bf0e956eabcc40e48e673ca23dc1851c9f28762e94d
node -e 'const fs=require("node:fs"); const crypto=require("node:crypto"); const [mappingPath, manifestPath, deliveryPath]=process.argv.slice(1); const mapping=JSON.parse(fs.readFileSync(mappingPath, "utf8")); const hash=(path)=>crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex"); if (mapping.git39.manifestAfter !== hash(manifestPath)) throw new Error("GIT39 manifest mapping mismatch"); if (mapping.git39.deliveryAfter !== hash(deliveryPath)) throw new Error("GIT39 delivery mapping mismatch");' \
  "$evidence/prior-packaging/metadata-identity-mapping.json" \
  "$evidence/MANIFEST.sha256" \
  "$evidence/delivery-validation.json"
printf 'CURRENT_IDENTITY_MAPPING=PASS\n'

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
source_paths=("${(@f)$(git diff --cached --name-only -- '*.ts' '*.mts' '*.cts' '*.js' '*.mjs' '*.cjs' '*.svelte')}")
pnpm exec prettier --check "${format_paths[@]}" "${source_paths[@]}"
pnpm exec eslint "${source_paths[@]}"
pnpm lint:paths
printf 'NATURAL_HOOK_EQUIVALENT=PASS\n'
printf 'GIT39_PACKAGING_RECOVERY_SELFCHECK=PASS\n'
