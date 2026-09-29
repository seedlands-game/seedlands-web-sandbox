#!/bin/zsh

set -e

main=/Users/bytedance/.codex/worktrees/6dd1/seedlands-web-sandbox
evidence=$main/changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-discovery-boundary-close-17

hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }

test "$(git -C "$main" rev-parse HEAD)" = 549dfecad3f6a8c6ba5c5179382f1af39101c1ff
git -C "$main" diff --cached --quiet
(cd "$main" && shasum -a 256 -c "$evidence/SOURCE-MANIFEST.sha256")
(cd "$evidence" && shasum -a 256 -c MANIFEST.sha256)

node - "$main" <<'NODE'
const fs = require('node:fs');
const cp = require('node:child_process');
const root = process.argv[2];
const path = root + '/playwright.config.ts';
const current = fs.readFileSync(path, 'utf8');
const baseline = cp.execFileSync('git', ['-C', root, 'show', 'HEAD:playwright.config.ts'], { encoding: 'utf8' });
const expected = baseline.replace(
  "projects: [{ name: 'chromium', timeout: 60_000 }]",
  "projects: [{ name: 'chromium', testDir: './apps/web/tests/e2e', timeout: 60_000 }]",
);
if (current !== expected) process.exit(1);
NODE

node - "$evidence/discovery-red.stdout.json.log" "$evidence/discovery-red-window.json.log" <<'NODE'
const fs = require('node:fs');
const [reportPath, windowPath] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const window = JSON.parse(fs.readFileSync(windowPath, 'utf8'));
const messages = report.errors.map((error) => error.message).join('\n');
if (report.config.version !== '1.62.1' || report.config.projects.length !== 1) process.exit(1);
if (report.config.projects[0].testDir !== report.config.rootDir) process.exit(1);
if (!messages.includes('predecessor-close15') || !messages.includes('null-closure/prior-release')) process.exit(1);
if (window.status !== 'FAIL' || window.exitCode !== 1) process.exit(1);
NODE

node - "$evidence/discovery-green.stdout.json.log" "$evidence/discovery-green-window.json.log" "$main" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [reportPath, windowPath, root] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const window = JSON.parse(fs.readFileSync(windowPath, 'utf8'));
const project = report.config.projects[0];
const specs = report.suites.flatMap((suite) => suite.specs ?? []);
const titles = specs.map((spec) => spec.title);
const expectedTitles = [
  'Classic 生产旅程以真实输入完成 C0-C5，并复用同一运行时性能场景',
  'Classic 视觉 v3 生产素材、连续帧与单击破坏回归',
  '非 Classic Playbook 从锁定 production artifact 启动并消费自定义 worldgen/voxel/presentation',
];
if (window.status !== 'PASS' || window.exitCode !== 0 || report.errors.length !== 0) process.exit(1);
if (report.config.rootDir !== root || report.config.projects.length !== 1) process.exit(1);
if (project.name !== 'chromium' || project.testDir !== path.join(root, 'apps/web/tests/e2e')) process.exit(1);
if (project.timeout !== 60000 || project.retries !== 0) process.exit(1);
if (specs.length !== 3 || specs.some((spec) => spec.file !== 'apps/web/tests/e2e/classic-runtime.spec.ts'))
  process.exit(1);
if (expectedTitles.some((title) => !titles.includes(title))) process.exit(1);
if (/changes\/|prior-release|predecessor-close15/.test(JSON.stringify(specs))) process.exit(1);
NODE

node - "$evidence/selection.stdout.json.log" <<'NODE'
const fs = require('node:fs');
const selection = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (selection.status !== 'PASS' || selection.selection.mode !== 'CANONICAL_MAIN') process.exit(1);
if (!selection.selection.canonicalMainSelected || selection.selection.canonicalMainMatches !== 1) process.exit(1);
if (selection.selection.modularSmokeMatches !== 1 || selection.selectedTests.length !== 3) process.exit(1);
NODE

for gate in classic-types root-types eslint format; do
  node - "$evidence/$gate-window.json.log" <<'NODE'
const fs = require('node:fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (value.status !== 'PASS' || value.exitCode !== 0) process.exit(1);
NODE
done

test "$(hash_file "$main/changes/2026-09-23-classic-functional-completion/evidence/git-39-canonical-budget-terminal/SOURCE-MANIFEST.sha256")" = 9431139f712b23814c0d368fbe49531875264c3f8a7a29fb89ab566537fdd1db
test "$(hash_file "$main/changes/2026-09-23-classic-functional-completion/evidence/git-39-canonical-budget-terminal/MANIFEST.sha256")" = 57684cabdac02207b94a4695b23de298b30769480c7dd08e61b1a7fe6410f762
test "$(hash_file "$main/changes/2026-09-23-classic-functional-completion/evidence/git-39-canonical-budget-terminal/delivery-validation.json")" = 1ece187dc577e144ee0f25fb795aa98b918a4149253a93a9f50db7322c1ac453

node - "$evidence/delivery-validation.json" "$evidence/SOURCE-MANIFEST.sha256" "$evidence/MANIFEST.sha256" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const [deliveryPath, sourcePath, manifestPath] = process.argv.slice(2);
const delivery = JSON.parse(fs.readFileSync(deliveryPath, 'utf8'));
const digest = (path) => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
if (delivery.sourceManifest.sha256 !== digest(sourcePath) || delivery.sourceManifest.entries !== 9) process.exit(1);
if (delivery.evidenceManifest.sha256 !== digest(manifestPath) || delivery.evidenceManifest.entries !== 24) process.exit(1);
if (delivery.finalSelfcheck.status !== 'PASS' || delivery.staticGates.scope !== 'PASS') process.exit(1);
if (delivery.staticGates.maxBlobBytes >= 100000000) process.exit(1);
NODE

actual=$(git -C "$main" status --short --untracked-files=all -- \
  playwright.config.ts \
  docs/ci-testing.md \
  changes/2026-09-23-classic-functional-completion/spec.md \
  changes/2026-09-23-classic-functional-completion/canonical-discovery-contract.md \
  changes/2026-09-23-classic-functional-completion/canonical-discovery-evidence.md \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-discovery-boundary-close-17)
test "$(printf '%s\n' "$actual" | sed '/^$/d' | wc -l | tr -d ' ')" = 32
printf '%s\n' "$actual" | awk '{print $2}' | while IFS= read -r owned_path; do
  case "$owned_path" in
    playwright.config.ts|docs/ci-testing.md|changes/2026-09-23-classic-functional-completion/spec.md|changes/2026-09-23-classic-functional-completion/canonical-discovery-contract.md|changes/2026-09-23-classic-functional-completion/canonical-discovery-evidence.md|changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-discovery-boundary-close-17/*) ;;
    *) exit 1 ;;
  esac
done

max_bytes=$(find "$evidence" -type f -exec stat -f %z {} + | sort -nr | head -n 1)
test "$max_bytes" -lt 100000000

(cd "$main" && pnpm exec prettier --check \
  playwright.config.ts \
  docs/ci-testing.md \
  changes/2026-09-23-classic-functional-completion/spec.md \
  changes/2026-09-23-classic-functional-completion/canonical-discovery-contract.md \
  changes/2026-09-23-classic-functional-completion/canonical-discovery-evidence.md \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-discovery-boundary-close-17/README.md \
  changes/2026-09-23-classic-functional-completion/evidence/v2-canonical-discovery-boundary-close-17/delivery-validation.json)

printf 'CLOSE17_FINAL_SELFCHECK=PASS\n'
