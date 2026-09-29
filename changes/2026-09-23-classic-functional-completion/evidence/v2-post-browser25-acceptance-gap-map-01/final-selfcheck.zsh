#!/bin/zsh
set -euo pipefail

repo=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
dir=$repo/changes/2026-09-23-classic-functional-completion/evidence/v2-post-browser25-acceptance-gap-map-01
head=01c650793c79ac34e6184da48b5a4c94a5f161c2
tree=e20a8b1d85520c960096b5c898c3ffdd7e241b2a
acceptance=/private/tmp/seedlands-v2-acceptance-fdb53c07
source=$dir/SOURCE-MANIFEST.sha256
manifest=$dir/MANIFEST.sha256

cd $repo
[[ $(git rev-parse HEAD) == $head ]]
[[ $(git rev-parse 'HEAD^{tree}') == $tree ]]
git diff --cached --quiet

[[ $(wc -l < $source | tr -d ' ') == 92 ]]
[[ $(awk '$2 ~ /^git-show:/ {n++} END {print n+0}' $source) == 62 ]]
[[ $(awk '$2 ~ /^acceptance:/ {n++} END {print n+0}' $source) == 1 ]]
[[ $(awk '$2 ~ /^working:/ {n++} END {print n+0}' $source) == 29 ]]
if grep -Ev '^[0-9a-f]{64}  (git-show:[0-9a-f]{40}:.+|acceptance:/private/tmp/seedlands-v2-acceptance-fdb53c07:.+|working:.+)$' $source; then
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
    acceptance:*)
      payload=${locator#acceptance:}
      root=${payload%%:*}
      sourcePath=${payload#*:}
      [[ $root == $acceptance ]]
      actual=$(shasum -a 256 "$root/$sourcePath" | cut -d' ' -f1)
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
[[ $sourceValidated == 92 ]]

[[ $(wc -l < $manifest | tr -d ' ') == 8 ]]
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
  actual=$(shasum -a 256 $evidencePath | cut -d' ' -f1)
  [[ $actual == $expected ]]
  (( manifestValidated += 1 ))
done < $manifest
[[ $manifestValidated == 8 ]]

for name in README.md SOURCE-MANIFEST.sha256 coverage.tsv diagnosis.json dirty-boundary.tsv metadata-format.stdout.log metadata-format.window.json.log final-selfcheck.zsh MANIFEST.sha256 delivery-validation.json metadata-format-final.stdout.log metadata-format-final.window.json.log final-selfcheck.stdout.log final-selfcheck.window.json.log final-selfcheck-02.stdout.log final-selfcheck-02.window.json.log final-selfcheck-03.stdout.log final-selfcheck-03.window.json.log; do
  [[ -f $dir/$name ]]
done
for evidencePath in $dir/*; do
  case ${evidencePath:t} in
    README.md|SOURCE-MANIFEST.sha256|coverage.tsv|diagnosis.json|dirty-boundary.tsv|metadata-format.stdout.log|metadata-format.window.json.log|final-selfcheck.zsh|MANIFEST.sha256|delivery-validation.json|metadata-format-final.stdout.log|metadata-format-final.window.json.log|final-selfcheck.stdout.log|final-selfcheck.window.json.log|final-selfcheck-02.stdout.log|final-selfcheck-02.window.json.log|final-selfcheck-03.stdout.log|final-selfcheck-03.window.json.log|final-selfcheck-04.stdout.log|final-selfcheck-04.window.json.log|final-selfcheck-05.stdout.log|final-selfcheck-05.window.json.log|final-selfcheck-06.stdout.log|final-selfcheck-06.window.json.log) ;;
    *)
      print -u2 "Unexpected evidence file: ${evidencePath:t}"
      exit 1
      ;;
  esac
done

node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(d.stage!=='V2-POST-BROWSER25-ACCEPTANCE-GAP-MAP-01'||d.status!=='MAP_ONLY_NO_IMPLEMENTATION'||d.findings.catalog.capabilityCountSum!==194||d.recommendedSlice.aiHardLimitHours!==3||d.boundaries.productGreenClaimed!==false) process.exit(1)" $dir/diagnosis.json
node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(d.status!=='PASS_AFTER_SELFCHECK_FIXES'||d.sourceManifest.entries!==92||d.evidenceManifest.entries!==8||d.boundaries.gitOrIndexWrite!==false||d.notRun.includes('Browser26')!==true||d.selfcheck.firstAttempt!=='FAIL_EXIT_127_ZSH_SPECIAL_PATH'||d.selfcheck.secondAttempt!=='FAIL_EXIT_1_CURRENT_WINDOW_NOT_YET_WRITTEN'||d.selfcheck.thirdAttempt!=='FAIL_DELIVERY_MANIFEST_ENTRY_COUNT_STALE'||d.selfcheck.fourthAttempt!=='FAIL_SOURCE_WORKING_HASH_TRANSCRIPTION'||d.selfcheck.finalAttempt!=='PASS_BY_EXIT_ZERO'||d.selfcheck.finalRunId!=='v2-post-browser25-gap-map-01-final-selfcheck-06') process.exit(1)" $dir/delivery-validation.json
declaredSource=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).sourceManifest.sha256)" $dir/delivery-validation.json)
declaredManifest=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).evidenceManifest.sha256)" $dir/delivery-validation.json)
[[ $(shasum -a 256 $source | cut -d' ' -f1) == $declaredSource ]]
[[ $(shasum -a 256 $manifest | cut -d' ' -f1) == $declaredManifest ]]
[[ $(awk -F '\t' 'NR==1 {columns=NF} NF!=columns {bad=1} END {if (bad) exit 1; print NR}' $dir/coverage.tsv) == 19 ]]
[[ $(awk -F '\t' 'NR==1 {columns=NF} NF!=columns {bad=1} END {if (bad) exit 1; print NR}' $dir/dirty-boundary.tsv) == 30 ]]
[[ $(awk -F '\t' 'NR>1 && $1=="tracked-modified" {n++} END {print n+0}' $dir/dirty-boundary.tsv) == 9 ]]
[[ $(awk -F '\t' 'NR>1 && $1=="untracked" {n++} END {print n+0}' $dir/dirty-boundary.tsv) == 20 ]]
[[ $(git status --short | wc -l | tr -d ' ') == 39 ]]

pnpm exec prettier --check $dir/README.md $dir/diagnosis.json $dir/delivery-validation.json
print "PASS source=$sourceValidated manifest=$manifestValidated head=$head tree=$tree index=0 status=39 newDirectory=1 filesAllowlisted=yes currentWindow=WRITTEN_BY_WRAPPER"
