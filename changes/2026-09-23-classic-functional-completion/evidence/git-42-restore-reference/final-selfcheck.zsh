#!/bin/zsh
set -euo pipefail

repo=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
tree=/private/tmp/seedlands-git42-restore-reference
dir=$repo/changes/2026-09-23-classic-functional-completion/evidence/git-42-restore-reference
head=01c650793c79ac34e6184da48b5a4c94a5f161c2
source=$dir/SOURCE-MANIFEST.sha256
manifest=$dir/MANIFEST.sha256

cd $repo
[[ $(git rev-parse HEAD) == $head ]]
git diff --cached --quiet
[[ $(wc -l < $source | tr -d ' ') == 41 ]]
[[ $(awk '$2 ~ /^git-show:/ {n++} END {print n+0}' $source) == 13 ]]
[[ $(awk '$2 ~ /^working:/ {n++} END {print n+0}' $source) == 28 ]]
if grep -Ev '^[0-9a-f]{64}  (git-show:[0-9a-f]{40}:.+|working:.+)$' $source; then exit 1; fi
[[ $(awk '{print $2}' $source | sort | uniq -d | wc -l | tr -d ' ') == 0 ]]
sourceValidated=0
while read -r expected locator; do
  case $locator in
    git-show:*)
      payload=${locator#git-show:}
      commit=${payload%%:*}
      sourcePath=${payload#*:}
      actual=$(git show "$commit:$sourcePath" | shasum -a 256 | cut -d' ' -f1)
      ;;
    working:*)
      sourcePath=${locator#working:}
      actual=$(shasum -a 256 "$repo/$sourcePath" | cut -d' ' -f1)
      ;;
    *) exit 1 ;;
  esac
  [[ $actual == $expected ]]
  (( sourceValidated += 1 ))
done < $source

manifestExpected=$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).evidenceManifest.entries))" $dir/delivery-validation.json)
[[ $(wc -l < $manifest | tr -d ' ') == $manifestExpected ]]
if grep -Ev '^[0-9a-f]{64}  \./[^/].+$' $manifest; then exit 1; fi
[[ $(awk '{print $2}' $manifest | sort | uniq -d | wc -l | tr -d ' ') == 0 ]]
manifestValidated=0
while read -r expected relative; do
  evidencePath=$dir/${relative#./}
  actual=$(shasum -a 256 "$evidencePath" | cut -d' ' -f1)
  [[ $actual == $expected ]]
  (( manifestValidated += 1 ))
done < $manifest

node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(d.status!=='PASS_PENDING_NATURAL_HOOK'||d.sourceManifest.entries!==41||d.evidenceManifest.entries!==$manifestExpected||d.validation.tests!=='3 files / 28 tests PASS'||d.naturalHooks!=='A_PASS_B_PASS_C_PENDING'||d.boundaries.browserRun!==false)process.exit(1)" $dir/delivery-validation.json
[[ $(shasum -a 256 $source | cut -d' ' -f1) == $(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).sourceManifest.sha256)" $dir/delivery-validation.json) ]]
[[ $(shasum -a 256 $manifest | cut -d' ' -f1) == $(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).evidenceManifest.sha256)" $dir/delivery-validation.json) ]]
node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if(d.status!=='PASS'||d.exitCode!==0||d.runId!=='git42-delivery-validation-01')process.exit(1)" $dir/validation.window.json.log
grep -Fq 'Tests  28 passed (28)' $dir/tests.stdout.log
grep -Fq 'PASS tests=28/28 types=4 eslintTs=8 prettierPaths=12 stagedPaths=12' $dir/scope.stdout.log
[[ $(awk -F '\t' '$1=="LINK" {n++} END {print n+0}' $dir/identity.stdout.log) == 6 ]]
if awk -F '\t' '$1=="LINK" && index($3, "/private/tmp/seedlands-git42-restore-reference/")!=1 {bad=1} END {exit bad}' $dir/identity.stdout.log; then :; else exit 1; fi
[[ $(git -C $tree rev-parse HEAD) == cc8cfb06d0040d4b35594f25673780b394d276cb ]]
[[ $(git -C $tree rev-parse HEAD^) == a1bc8d6f32588ae22d8d573442403a53cf59aee8 ]]
[[ $(git -C $tree rev-parse HEAD^^) == $head ]]
diff -u <(sort $dir/a.paths) <(git -C $tree diff-tree --no-commit-id --name-only -r a1bc8d6f32588ae22d8d573442403a53cf59aee8 | sort) >/tmp/git42-a-diff.txt
diff -u <(sort $dir/b.paths) <(git -C $tree diff-tree --no-commit-id --name-only -r cc8cfb06d0040d4b35594f25673780b394d276cb | sort) >/tmp/git42-b-diff.txt
while IFS= read -r p; do [[ $(shasum -a 256 $repo/$p | cut -d' ' -f1) == $(shasum -a 256 $tree/$p | cut -d' ' -f1) ]]; done < $dir/ab.paths
rm -f /tmp/git42-a-diff.txt /tmp/git42-b-diff.txt

dirtyNow=/tmp/git42-protected-final.tsv
git status --porcelain=v1 -z --untracked-files=all > /tmp/git42-protected-final.z
: > $dirtyNow
while IFS= read -r -d '' entry; do
  state=${entry[1,2]}
  filePath=${entry[4,-1]}
  case "$filePath" in
    .env|.env.*|*/.env|*/.env.*|*secret*|*secrets*) continue ;;
    packages/stdlib/src/server/harness/world-harness-contract.ts|packages/stdlib/src/server/harness/world-harness-validation.ts|packages/stdlib/src/server/harness/world-harness-operations.ts|packages/stdlib/src/server/harness/authority-world-harness.ts) continue ;;
    apps/web/tests/e2e/classic-support/equipment-journey.ts|apps/web/tests/e2e/classic-runtime.spec.ts|apps/web/tests/e2e/classic-support/equipment-restore-reference.test.ts|apps/web/tests/integration/runtime/server/world-harness-session.test.ts) continue ;;
    changes/2026-09-23-classic-functional-completion/spec.md|changes/2026-09-23-classic-functional-completion/restore-reference-observability-contract.md|changes/2026-09-23-classic-functional-completion/action-owner-fixture-contract.md|docs/harness-contracts.md) continue ;;
    changes/2026-09-23-classic-functional-completion/restore-reference-observability-evidence.md|changes/2026-09-23-classic-functional-completion/action-owner-fixture-evidence.md|changes/2026-09-23-classic-functional-completion/tasks.md|changes/2026-09-23-classic-functional-completion/execution-state.md) continue ;;
    changes/2026-09-23-classic-functional-completion/evidence/v2-post-browser25-acceptance-gap-map-01/*|changes/2026-09-23-classic-functional-completion/evidence/v2-restore-reference-observability-01/*|changes/2026-09-23-classic-functional-completion/evidence/v2-restore-reference-baseline-control-01/*|changes/2026-09-23-classic-functional-completion/evidence/v2-harness-action-owner-fixture-close-01/*|changes/2026-09-23-classic-functional-completion/evidence/git-42-restore-reference/*) continue ;;
  esac
  if [[ -f "$filePath" || -L "$filePath" ]]; then
    size=$(stat -f %z "$filePath")
    hash=$(shasum -a 256 "$filePath" | awk '{print $1}')
    printf '%s\t%s\t%s\t%s\n' "$state" "$size" "$hash" "$filePath" >> $dirtyNow
  fi
done < /tmp/git42-protected-final.z
cmp -s $dir/protected-dirty-preflight.tsv $dirtyNow
[[ $(wc -l < $dirtyNow | tr -d ' ') == 38 ]]
rm -f $dirtyNow /tmp/git42-protected-final.z
[[ -f /tmp/seedlands-benchmark-reservation/owner.json ]]
[[ $(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).runId)" /tmp/seedlands-benchmark-reservation/owner.json) == ${SEEDLANDS_PERFORMANCE_WINDOW_ID:?} ]]
pnpm exec prettier --check $dir/README.md $dir/delivery-validation.json changes/2026-09-23-classic-functional-completion/tasks.md changes/2026-09-23-classic-functional-completion/execution-state.md
print "PASS source=$sourceValidated manifest=$manifestValidated head=$head mainIndex=0 protectedDirty=38 commits=A10+B2 validation=28/28 hooks=A+B_PASS_C_PENDING currentWindow=WRITTEN_BY_WRAPPER"
