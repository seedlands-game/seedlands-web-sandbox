#!/bin/zsh

set -e

root=/private/tmp/seedlands-git39-canonical-budget-terminal
main=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
base=changes/2026-09-23-classic-functional-completion
evidence=$base/evidence/git-39-canonical-budget-terminal

cd "$root"
test "$(git rev-parse HEAD)" = fca25ef13eb060b281aa90cf713ce4837b603b14
cmp \
  <(git diff --cached --name-only | LC_ALL=C sort) \
  <(awk '$0 != "changes/2026-09-23-classic-functional-completion/evidence/git-39-canonical-budget-terminal/final-selfcheck.stdout.log" && $0 != "changes/2026-09-23-classic-functional-completion/evidence/git-39-canonical-budget-terminal/final-selfcheck.window.json.log"' "$evidence/evidence-staged.paths")

shasum -a 256 -c "$evidence/SOURCE-MANIFEST.sha256"
(cd "$evidence" && shasum -a 256 -c MANIFEST.sha256)

deliveries=(
  v2-canonical-browser-23=bf8b7aecfb5a5ad348e03445e766212570bfdee0685931ed13a7196102b7b04c
  v2-browser23-canonical-budget-map-01=828f23d14b54d51f19d5fd66d6454da8322b2210526d73f80713d412e992da61
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
cmp "$evidence/evidence-staged.paths" "$evidence/evidence-staged.actual.paths"

format_paths=("${(@f)$(git diff --cached --name-only -- '*.json' '*.css' '*.md' '*.yml' '*.yaml')}")
source_paths=("${(@f)$(git diff --cached --name-only -- '*.ts' '*.mts' '*.cts' '*.js' '*.mjs' '*.cjs' '*.svelte')}")
pnpm exec prettier --check "${format_paths[@]}" "${source_paths[@]}"
pnpm exec eslint "${source_paths[@]}"
pnpm lint:paths

set +e
git diff --cached --check > /tmp/git39-canonical-budget-terminal-diff-check.log
diff_status=$?
set -e
test "$diff_status" -ne 0
awk -F: '/^[^+].*:[0-9]+:/ && $1 !~ /^changes\/2026-09-23-classic-functional-completion\/evidence\// { bad = 1 } END { exit bad }' \
  /tmp/git39-canonical-budget-terminal-diff-check.log
printf 'DIFF_CHECK=EXPECTED_RAW_ONLY\n'
printf 'GIT39_FINAL_SELFCHECK=PASS\n'
