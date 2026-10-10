#!/bin/zsh
set -euo pipefail

repo=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
dir=$repo/changes/2026-09-23-classic-functional-completion/evidence/v2-restore-reference-baseline-control-01
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

node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(d.stage!=='V2-RESTORE-REFERENCE-BASELINE-CONTROL-01'||d.comparison.classification!=='PREEXISTING_REPRODUCED'||d.candidateFull.testsPassed!==27||d.candidateFull.testsFailed!==1||d.candidateFull.affectedStatus!=='KNOWN_FAIL_NOT_ALL_GREEN'||d.boundaries.productGreenClaimed!==false) process.exit(1)" $dir/identity.json
node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(d.status!=='PREEXISTING_REPRODUCED_CANDIDATE_NEW_TESTS_PASS_AFFECTED_KNOWN_FAIL'||d.sourceManifest.entries!==29||d.evidenceManifest.entries!==$manifestExpected||d.controlComparison.candidateRegression!==false||d.candidateFull.focusedReference!=='11/11 PASS'||d.boundaries.gitOrIndexWrite!==false) process.exit(1)" $dir/delivery-validation.json
declaredSource=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).sourceManifest.sha256)" $dir/delivery-validation.json)
declaredManifest=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).evidenceManifest.sha256)" $dir/delivery-validation.json)
[[ $(shasum -a 256 $source | cut -d' ' -f1) == $declaredSource ]]
[[ $(shasum -a 256 $manifest | cut -d' ' -f1) == $declaredManifest ]]

for pair in \
  control-install:PASS:0:v2-reference-control-install-01 \
  candidate-install:PASS:0:v2-reference-candidate-install-01 \
  control-old-case:FAIL:1:v2-reference-control-old-case-01 \
  candidate-old-case:FAIL:1:v2-reference-candidate-old-case-01 \
  candidate-full:FAIL:1:v2-reference-candidate-full-01; do
  name=${pair%%:*}
  rest=${pair#*:}
  expectedStatus=${rest%%:*}
  rest=${rest#*:}
  expectedExit=${rest%%:*}
  expectedRun=${rest#*:}
  node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(d.status!==process.argv[2]||String(d.exitCode)!==process.argv[3]||d.runId!==process.argv[4]) process.exit(1)" $dir/$name.window.json.log $expectedStatus $expectedExit $expectedRun
done
grep -Fq 'Tests  1 failed | 9 skipped (10)' $dir/control-old-case.stdout.log
grep -Fq 'Tests  1 failed | 9 skipped (10)' $dir/candidate-old-case.stdout.log
grep -Fq "getActorAction('foreign')" $dir/control-old-case.stdout.log
grep -Fq "getActorAction('foreign')" $dir/candidate-old-case.stdout.log
grep -Fq 'Tests  1 failed | 27 passed (28)' $dir/candidate-full.stdout.log
grep -Fq 'equipment-restore-reference.test.ts (11 tests)' $dir/candidate-full.stdout.log
[[ $(awk -F '\t' '$1=="LINK" && $2=="control" {n++} END {print n+0}' $dir/link-resolution.stdout.log) == 6 ]]
[[ $(awk -F '\t' '$1=="LINK" && $2=="candidate" {n++} END {print n+0}' $dir/link-resolution.stdout.log) == 6 ]]
if awk -F '\t' '$1=="LINK" && index($4, "/private/tmp/seedlands-v2-reference-" $2 "-01/")!=1 {bad=1} END {exit bad}' $dir/link-resolution.stdout.log; then :; else
  print -u2 'Workspace link escaped its own temporary tree'
  exit 1
fi
grep -Fxq $'CONTROL_TRACKED_COUNT\t0' $dir/tree-identity.stdout.log
grep -Fxq $'CONTROL_UNTRACKED_COUNT\t0' $dir/tree-identity.stdout.log
grep -Fxq $'CANDIDATE_TRACKED_COUNT\t8' $dir/tree-identity.stdout.log
grep -Fxq $'CANDIDATE_UNTRACKED_COUNT\t3' $dir/tree-identity.stdout.log

dirtyNow=/tmp/v2-restore-reference-dirty-final.tsv
: > $dirtyNow
git status --porcelain=v1 -z --untracked-files=all > /tmp/v2-restore-reference-dirty-final.z
while IFS= read -r -d '' entry; do
  state=${entry[1,2]}
  filePath=${entry[4,-1]}
  case "$filePath" in
    .env|.env.*|*/.env|*/.env.*|*secret*|*secrets*) continue ;;
    changes/2026-09-23-classic-functional-completion/evidence/v2-restore-reference-baseline-control-01/*) continue ;;
  esac
  if [[ -f "$filePath" || -L "$filePath" ]]; then
    size=$(stat -f %z "$filePath")
    hash=$(shasum -a 256 "$filePath" | awk '{print $1}')
    printf '%s\t%s\t%s\t%s\n' "$state" "$size" "$hash" "$filePath" >> $dirtyNow
  fi
done < /tmp/v2-restore-reference-dirty-final.z
cmp -s $dir/dirty-preflight.tsv $dirtyNow
[[ $(wc -l < $dirtyNow | tr -d ' ') == 205 ]]
rm -f $dirtyNow /tmp/v2-restore-reference-dirty-final.z

[[ -f /tmp/seedlands-benchmark-reservation/owner.json ]]
lockRun=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).runId)" /tmp/seedlands-benchmark-reservation/owner.json)
[[ $lockRun == ${SEEDLANDS_PERFORMANCE_WINDOW_ID:?} ]]
pnpm exec prettier --check $dir/README.md $dir/identity.json $dir/delivery-validation.json
print "PASS source=$sourceValidated manifest=$manifestValidated head=$head tree=$tree index=0 dirty=205 control=FAIL candidate=FAIL same-point candidateFull=27pass-1knownfail links=12 lock=current-owner currentWindow=WRITTEN_BY_WRAPPER"
