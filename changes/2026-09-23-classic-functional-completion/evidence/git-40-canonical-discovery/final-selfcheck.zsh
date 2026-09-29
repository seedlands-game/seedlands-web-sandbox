#!/bin/zsh

set -e

root=/private/tmp/seedlands-git40-canonical-discovery
evidence=$root/changes/2026-09-23-classic-functional-completion/evidence/git-40-canonical-discovery
browser24=$root/changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-24
close17=$root/changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-discovery-boundary-close-17

hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }

test "$(git -C "$root" rev-parse HEAD)" = ed6ea030cfacc517aab337b32993803c50ed3ab7
(cd "$root" && shasum -a 256 -c "$evidence/SOURCE-MANIFEST.sha256")
(cd "$evidence" && shasum -a 256 -c MANIFEST.sha256)
test "$(hash_file "$evidence/SOURCE-MANIFEST.sha256")" = 922f1859ff33d8d1fe4cfad1ce6613e7d16c57057977924f2fd4c4556c4d4120

test "$(hash_file "$browser24/SOURCE-MANIFEST.sha256")" = ad8b5a66672e967ed0f73b839c1354f54e922edd69fc92ade94833b778bf7b1a
test "$(hash_file "$browser24/MANIFEST.sha256")" = 4cf5e544d22d3826ecdaa6292607ed118fd1890257b1f388d36bd3847cbfa44f
test "$(hash_file "$browser24/delivery-validation.json")" = 4073de5c997a03dd4c251dcfd0ae0028ce59788cdeb4959481aec5e7edd13576
(cd "$browser24" && shasum -a 256 -c MANIFEST.sha256)

test "$(hash_file "$close17/SOURCE-MANIFEST.sha256")" = b67b0a48bf7c7ee2ba41a6dfbd5d7394b3ca9aa7ffccaaa704f668071e2ae403
test "$(hash_file "$close17/MANIFEST.sha256")" = 791017d6c245f3f241cff8c0ac5f07f679c30110e9fb24edaf34a67f544b0852
test "$(hash_file "$close17/delivery-validation.json")" = 8c4cb1879f1fca5638d23890ab6ab73c599a1c081ffda33ff805b2ff3926f3dc
(cd "$close17" && shasum -a 256 -c MANIFEST.sha256)

for receipt in dependency-setup staged-gate; do
  node - "$evidence/$receipt.window.json.log" <<'NODE'
const fs = require('node:fs');
const receipt = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (receipt.status !== 'PASS' || receipt.exitCode !== 0) process.exit(1);
NODE
done

node - "$evidence/discovery.stdout.json.log" "$evidence/selection.stdout.json.log" "$root" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [discoveryPath, selectionPath, root] = process.argv.slice(2);
const discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf8'));
const selection = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
const project = discovery.config.projects[0];
const specs = discovery.suites.flatMap((suite) => suite.specs ?? []);
if (discovery.errors.length !== 0 || discovery.config.rootDir !== root) process.exit(1);
if (project.testDir !== path.join(root, 'apps/web/tests/e2e') || project.timeout !== 60000) process.exit(1);
if (specs.length !== 3 || specs.some((spec) => spec.file !== 'apps/web/tests/e2e/classic-runtime.spec.ts'))
  process.exit(1);
if (/changes\/|prior-release|predecessor-close15/.test(JSON.stringify(specs))) process.exit(1);
if (selection.status !== 'PASS' || selection.selection.mode !== 'CANONICAL_MAIN') process.exit(1);
if (!selection.selection.canonicalMainSelected || selection.selection.canonicalMainMatches !== 1) process.exit(1);
NODE

node - "$evidence/delivery-validation.json" "$evidence/MANIFEST.sha256" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [deliveryPath, manifestPath] = process.argv.slice(2);
const delivery = JSON.parse(fs.readFileSync(deliveryPath, 'utf8'));
const manifestHash = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
if (delivery.status !== 'PASS_PENDING_NATURAL_HOOK') process.exit(1);
if (delivery.evidenceManifest.entries !== 17 || delivery.evidenceManifest.sha256 !== manifestHash) process.exit(1);
if (delivery.secondCommit.exactAllowlistPaths !== 75 || delivery.finalSelfcheck.status !== 'PASS') process.exit(1);
NODE

git -C "$root" diff --cached --name-only | LC_ALL=C sort > /private/tmp/git40-staged.actual.paths
cmp "$evidence/evidence.paths" /private/tmp/git40-staged.actual.paths
git -C "$root" diff --cached --check

max_blob=0
while read -r mode object stage owned_path; do
  size=$(git -C "$root" cat-file -s "$object")
  if (( size > max_blob )); then max_blob=$size; fi
done < <(git -C "$root" ls-files -s -- $(cat "$evidence/evidence.paths"))
test "$max_blob" -lt 100000000

for link in \
  node_modules/@seedlands/kernel \
  node_modules/@seedlands/stdlib \
  node_modules/@seedlands/playbook-classic \
  apps/web/node_modules/@seedlands/kernel \
  apps/web/node_modules/@seedlands/stdlib \
  apps/web/node_modules/@seedlands/playbook-classic \
  playbooks/classic/node_modules/@seedlands/stdlib; do
  resolved=$(realpath "$root/$link")
  case "$resolved" in
    "$root"/*) ;;
    *) exit 1 ;;
  esac
done

(cd "$root" && pnpm exec prettier --check \
  changes/2026-09-23-classic-functional-completion/canonical-discovery-evidence.md \
  changes/2026-09-23-classic-functional-completion/v2-canonical-browser-evidence.md \
  changes/2026-09-23-classic-functional-completion/tasks.md \
  changes/2026-09-23-classic-functional-completion/execution-state.md \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-24/diagnosis.json \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-browser-24/delivery-validation.json \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-discovery-boundary-close-17/README.md \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-discovery-boundary-close-17/delivery-validation.json \
  changes/2026-09-23-classic-functional-completion/evidence/git-40-canonical-discovery/README.md \
  changes/2026-09-23-classic-functional-completion/evidence/git-40-canonical-discovery/delivery-validation.json)

printf 'GIT40_FINAL_SELFCHECK=PASS\n'
