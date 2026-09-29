#!/bin/zsh
set -euo pipefail

repo=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
dir=$repo/changes/2026-09-23-classic-functional-completion/evidence/v2-restore-reference-observability-01
head=01c650793c79ac34e6184da48b5a4c94a5f161c2
tree=e20a8b1d85520c960096b5c898c3ffdd7e241b2a
source=$dir/SOURCE-MANIFEST.sha256
manifest=$dir/MANIFEST.sha256

cd $repo
[[ $(git rev-parse HEAD) == $head ]]
[[ $(git rev-parse 'HEAD^{tree}') == $tree ]]
git diff --cached --quiet

[[ $(wc -l < $source | tr -d ' ') == 29 ]]
[[ $(awk '$2 ~ /^git-show:/ {n++} END {print n+0}' $source) == 18 ]]
[[ $(awk '$2 ~ /^working:/ {n++} END {print n+0}' $source) == 11 ]]
if grep -Ev '^[0-9a-f]{64}  (git-show:[0-9a-f]{40}:.+|working:.+)$' $source; then
  print -u2 'SOURCE contains a malformed row'
  exit 1
fi
[[ $(awk '{print $2}' $source | sort | uniq -d | wc -l | tr -d ' ') == 0 ]]

sourceValidated=0
while read -r expected locator; do
  case $locator in
    git-show:*)
      payload=${locator#git-show:}
      commit=${payload%%:*}
      sourcePath=${payload#*:}
      [[ $commit == $head ]]
      actual=$(git show "$commit:$sourcePath" | shasum -a 256 | cut -d' ' -f1)
      ;;
    working:*)
      sourcePath=${locator#working:}
      actual=$(shasum -a 256 "$repo/$sourcePath" | cut -d' ' -f1)
      ;;
    *)
      print -u2 "Unknown SOURCE locator: $locator"
      exit 1
      ;;
  esac
  [[ $actual == $expected ]]
  (( sourceValidated += 1 ))
done < $source
[[ $sourceValidated == 29 ]]

manifestExpected=$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).evidenceManifest.entries))" $dir/delivery-validation.json)
[[ $(wc -l < $manifest | tr -d ' ') == $manifestExpected ]]
if grep -Ev '^[0-9a-f]{64}  \./[^/].+$' $manifest; then
  print -u2 'MANIFEST contains a malformed row'
  exit 1
fi
[[ $(awk '{print $2}' $manifest | sort | uniq -d | wc -l | tr -d ' ') == 0 ]]
manifestValidated=0
while read -r expected relative; do
  [[ $relative == ./* ]]
  evidencePath=$dir/${relative#./}
  [[ -f $evidencePath ]]
  actual=$(shasum -a 256 "$evidencePath" | cut -d' ' -f1)
  [[ $actual == $expected ]]
  (( manifestValidated += 1 ))
done < $manifest
[[ $manifestValidated == $manifestExpected ]]

for required in README.md SOURCE-MANIFEST.sha256 diagnosis.json final-selfcheck.zsh MANIFEST.sha256 delivery-validation.json final-selfcheck.stdout.log; do
  [[ -f $dir/$required ]]
done
for evidencePath in $dir/*; do
  case ${evidencePath:t} in
    MANIFEST.sha256|delivery-validation.json|metadata-format*.stdout.log|metadata-format*.window.json.log|final-selfcheck*.stdout.log|final-selfcheck*.window.json.log) ;;
    *)
      grep -Fq "  ./${evidencePath:t}" $manifest || {
        print -u2 "Evidence file missing from MANIFEST: ${evidencePath:t}"
        exit 1
      }
      ;;
  esac
done

node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(d.stage!=='V2-RESTORE-REFERENCE-OBSERVABILITY-01'||d.status!=='FOCUSED_DETERMINISTIC_STATIC_GREEN_BROWSER_NOT_RUN'||d.interface.protocolVersion!==1||d.tdd.focusedGreen.passed!==11||d.tdd.affectedExisting.passed!==16||d.boundaries.productGreenClaimed!==false) process.exit(1)" $dir/diagnosis.json
node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(d.status!=='PASS'||d.sourceManifest.entries!==29||d.evidenceManifest.entries!==$manifestExpected||d.workspace.indexExpectedEmpty!==true||d.boundaries.browser26Run!==false||d.notRun.includes('Browser26')!==true) process.exit(1)" $dir/delivery-validation.json
declaredSource=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).sourceManifest.sha256)" $dir/delivery-validation.json)
declaredManifest=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).evidenceManifest.sha256)" $dir/delivery-validation.json)
[[ $(shasum -a 256 $source | cut -d' ' -f1) == $declaredSource ]]
[[ $(shasum -a 256 $manifest | cut -d' ' -f1) == $declaredManifest ]]

expectedTracked=(
  apps/web/tests/e2e/classic-runtime.spec.ts
  apps/web/tests/e2e/classic-support/equipment-journey.ts
  changes/2026-09-23-classic-functional-completion/spec.md
  docs/harness-contracts.md
  packages/stdlib/src/server/harness/authority-world-harness.ts
  packages/stdlib/src/server/harness/world-harness-contract.ts
  packages/stdlib/src/server/harness/world-harness-operations.ts
  packages/stdlib/src/server/harness/world-harness-validation.ts
)
for trackedPath in $expectedTracked; do
  git diff --name-only -- $trackedPath | grep -Fxq $trackedPath
done
[[ $(printf '%s\n' $expectedTracked | sort | uniq | wc -l | tr -d ' ') == 8 ]]
for untrackedPath in \
  apps/web/tests/e2e/classic-support/equipment-restore-reference.test.ts \
  changes/2026-09-23-classic-functional-completion/restore-reference-observability-contract.md \
  changes/2026-09-23-classic-functional-completion/restore-reference-observability-evidence.md; do
  [[ -f $untrackedPath ]]
  git ls-files --error-unmatch $untrackedPath >/dev/null 2>&1 && exit 1
done

[[ -f /tmp/seedlands-benchmark-reservation/owner.json ]]
lockRun=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).runId)" /tmp/seedlands-benchmark-reservation/owner.json)
[[ $lockRun == ${SEEDLANDS_PERFORMANCE_WINDOW_ID:?} ]]

pnpm exec prettier --check \
  $dir/README.md \
  $dir/diagnosis.json \
  $dir/delivery-validation.json \
  changes/2026-09-23-classic-functional-completion/restore-reference-observability-evidence.md
print "PASS source=$sourceValidated manifest=$manifestValidated head=$head tree=$tree index=0 trackedSlice=8 untrackedSource=3 lock=current-owner currentWindow=WRITTEN_BY_WRAPPER"
