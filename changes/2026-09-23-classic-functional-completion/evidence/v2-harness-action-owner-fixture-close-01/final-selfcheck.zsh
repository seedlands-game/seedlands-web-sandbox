#!/bin/zsh
set -euo pipefail

repo=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
candidate=/private/tmp/seedlands-v2-action-owner-candidate-01
dir=$repo/changes/2026-09-23-classic-functional-completion/evidence/v2-harness-action-owner-fixture-close-01
head=01c650793c79ac34e6184da48b5a4c94a5f161c2
tree=e20a8b1d85520c960096b5c898c3ffdd7e241b2a
source=$dir/SOURCE-MANIFEST.sha256
manifest=$dir/MANIFEST.sha256

cd $repo
[[ $(git rev-parse HEAD) == $head ]]
[[ $(git rev-parse 'HEAD^{tree}') == $tree ]]
git diff --cached --quiet

[[ $(wc -l < $source | tr -d ' ') == 29 ]]
[[ $(awk '$2 ~ /^git-show:/ {n++} END {print n+0}' $source) == 12 ]]
[[ $(awk '$2 ~ /^working:/ {n++} END {print n+0}' $source) == 17 ]]
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
  evidencePath=$dir/${relative#./}
  [[ -f $evidencePath ]]
  actual=$(shasum -a 256 "$evidencePath" | cut -d' ' -f1)
  [[ $actual == $expected ]]
  (( manifestValidated += 1 ))
done < $manifest
[[ $manifestValidated == $manifestExpected ]]
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

node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(d.stage!=='V2-HARNESS-ACTION-OWNER-FIXTURE-CLOSE-01'||d.status!=='PASS'||d.fixtureChange.archetypeAfter!=='cow'||d.fixtureChange.permissionDenialAssertionsPreserved!==4||d.tests.candidateFull.passed!==28||d.boundaries.productionModified!==false||d.boundaries.productGreenClaimed!==false) process.exit(1)" $dir/delivery-validation.json
declaredSource=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).sourceManifest.sha256)" $dir/delivery-validation.json)
declaredManifest=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).evidenceManifest.sha256)" $dir/delivery-validation.json)
[[ $(shasum -a 256 $source | cut -d' ' -f1) == $declaredSource ]]
[[ $(shasum -a 256 $manifest | cut -d' ' -f1) == $declaredManifest ]]

for pair in \
  candidate-install:FAIL:1:v2-action-owner-candidate-install-01 \
  candidate-install-02:PASS:0:v2-action-owner-candidate-install-02 \
  candidate-full:PASS:0:v2-action-owner-candidate-full-01 \
  root-test-types:PASS:0:v2-action-owner-root-test-types-01 \
  classic-test-types:PASS:0:v2-action-owner-classic-test-types-01 \
  eslint:PASS:0:v2-action-owner-eslint-01 \
  format:PASS:0:v2-action-owner-format-01; do
  name=${pair%%:*}
  rest=${pair#*:}
  expectedStatus=${rest%%:*}
  rest=${rest#*:}
  expectedExit=${rest%%:*}
  expectedRun=${rest#*:}
  node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if(d.status!==process.argv[2]||String(d.exitCode)!==process.argv[3]||d.runId!==process.argv[4]) process.exit(1)" $dir/$name.window.json.log $expectedStatus $expectedExit $expectedRun
done
grep -Fq 'Test Files  3 passed (3)' $dir/candidate-full.stdout.log
grep -Fq 'Tests  28 passed (28)' $dir/candidate-full.stdout.log
grep -Fq 'equipment-restore-reference.test.ts (11 tests)' $dir/candidate-full.stdout.log
grep -Fq 'world-harness-session.test.ts (10 tests)' $dir/candidate-full.stdout.log
grep -Fq 'browser-authority-world-harness.test.ts (7 tests)' $dir/candidate-full.stdout.log
grep -Fq 'Already up to date' $dir/candidate-install-02.stdout.log
grep -Fxq $'TRACKED_COUNT\t9' $dir/candidate-identity.stdout.log
grep -Fxq $'UNTRACKED_COUNT\t3' $dir/candidate-identity.stdout.log
[[ $(awk -F '\t' '$1=="LINK" {n++} END {print n+0}' $dir/candidate-identity.stdout.log) == 6 ]]
if awk -F '\t' '$1=="LINK" && index($3, "/private/tmp/seedlands-v2-action-owner-candidate-01/")!=1 {bad=1} END {exit bad}' $dir/candidate-identity.stdout.log; then :; else
  print -u2 'Workspace link escaped the candidate tree'
  exit 1
fi
[[ -d $candidate ]]
[[ $(shasum -a 256 $candidate/apps/web/tests/integration/runtime/server/world-harness-session.test.ts | cut -d' ' -f1) == db1a24bc6ac0fd6bbe5df21edfc7fbebc0be00ca0c14cee3753e9e65325ff156 ]]
[[ $(grep -c 'WORLD_PERMISSION_DENIED' apps/web/tests/integration/runtime/server/world-harness-session.test.ts) == 4 ]]
grep -Fq "archetype: 'cow'" apps/web/tests/integration/runtime/server/world-harness-session.test.ts
grep -Fq "actorId: 'foreign', type: 'idle', status: 'pending'" apps/web/tests/integration/runtime/server/world-harness-session.test.ts

dirtyNow=/tmp/v2-action-owner-protected-final.tsv
: > $dirtyNow
git status --porcelain=v1 -z --untracked-files=all > /tmp/v2-action-owner-protected-final.z
while IFS= read -r -d '' entry; do
  state=${entry[1,2]}
  filePath=${entry[4,-1]}
  case "$filePath" in
    .env|.env.*|*/.env|*/.env.*|*secret*|*secrets*) continue ;;
    apps/web/tests/integration/runtime/server/world-harness-session.test.ts) continue ;;
    changes/2026-09-23-classic-functional-completion/action-owner-fixture-contract.md) continue ;;
    changes/2026-09-23-classic-functional-completion/action-owner-fixture-evidence.md) continue ;;
    changes/2026-09-23-classic-functional-completion/evidence/v2-harness-action-owner-fixture-close-01/*) continue ;;
  esac
  if [[ -f "$filePath" || -L "$filePath" ]]; then
    size=$(stat -f %z "$filePath")
    hash=$(shasum -a 256 "$filePath" | awk '{print $1}')
    printf '%s\t%s\t%s\t%s\n' "$state" "$size" "$hash" "$filePath" >> $dirtyNow
  fi
done < /tmp/v2-action-owner-protected-final.z
cmp -s $dir/protected-dirty-preflight.tsv $dirtyNow
[[ $(wc -l < $dirtyNow | tr -d ' ') == 236 ]]
rm -f $dirtyNow /tmp/v2-action-owner-protected-final.z

[[ -f /tmp/seedlands-benchmark-reservation/owner.json ]]
lockRun=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).runId)" /tmp/seedlands-benchmark-reservation/owner.json)
[[ $lockRun == ${SEEDLANDS_PERFORMANCE_WINDOW_ID:?} ]]
pnpm exec prettier --check $dir/README.md $dir/delivery-validation.json changes/2026-09-23-classic-functional-completion/action-owner-fixture-contract.md changes/2026-09-23-classic-functional-completion/action-owner-fixture-evidence.md
print "PASS source=$sourceValidated manifest=$manifestValidated head=$head tree=$tree index=0 protectedDirty=236 candidate=9tracked+3untracked links=6 closure=28/28 types=2 lint=1 format=1 lock=current-owner currentWindow=WRITTEN_BY_WRAPPER"
