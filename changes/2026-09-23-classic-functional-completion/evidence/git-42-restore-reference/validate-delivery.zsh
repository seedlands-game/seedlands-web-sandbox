#!/bin/zsh
set -euo pipefail

tree=${1:?delivery tree required}
evidence=${2:?evidence directory required}
cd $tree

run() {
  local name=$1
  shift
  print "RUN $name"
  "$@" 2>&1 | tee "$evidence/$name.stdout.log"
}

run tests pnpm exec vitest run --config apps/web/vitest.config.ts \
  apps/web/tests/e2e/classic-support/equipment-restore-reference.test.ts \
  apps/web/tests/integration/runtime/server/world-harness-session.test.ts \
  apps/web/tests/unit/client/browser-authority-world-harness.test.ts \
  --maxWorkers=1
run stdlib-types pnpm --filter @seedlands/stdlib typecheck
run web-types pnpm --filter @seedlands/web typecheck
run root-test-types pnpm exec tsc -p tsconfig.test.json --noEmit
run classic-test-types pnpm exec tsc -p tsconfig.classic-tests.json --noEmit
run eslint pnpm exec eslint \
  packages/stdlib/src/server/harness/world-harness-contract.ts \
  packages/stdlib/src/server/harness/world-harness-validation.ts \
  packages/stdlib/src/server/harness/world-harness-operations.ts \
  packages/stdlib/src/server/harness/authority-world-harness.ts \
  apps/web/tests/e2e/classic-support/equipment-journey.ts \
  apps/web/tests/e2e/classic-runtime.spec.ts \
  apps/web/tests/e2e/classic-support/equipment-restore-reference.test.ts \
  apps/web/tests/integration/runtime/server/world-harness-session.test.ts
run prettier pnpm exec prettier --check \
  packages/stdlib/src/server/harness/world-harness-contract.ts \
  packages/stdlib/src/server/harness/world-harness-validation.ts \
  packages/stdlib/src/server/harness/world-harness-operations.ts \
  packages/stdlib/src/server/harness/authority-world-harness.ts \
  apps/web/tests/e2e/classic-support/equipment-journey.ts \
  apps/web/tests/e2e/classic-runtime.spec.ts \
  apps/web/tests/e2e/classic-support/equipment-restore-reference.test.ts \
  apps/web/tests/integration/runtime/server/world-harness-session.test.ts \
  changes/2026-09-23-classic-functional-completion/spec.md \
  changes/2026-09-23-classic-functional-completion/restore-reference-observability-contract.md \
  changes/2026-09-23-classic-functional-completion/action-owner-fixture-contract.md \
  docs/harness-contracts.md

git diff --cached --check
actual=$(git diff --cached --name-only | sort)
expected=$(sort "$evidence/ab.paths")
[[ $actual == $expected ]]
[[ $(git diff --cached --name-only | wc -l | tr -d ' ') == 12 ]]
[[ $(git diff --cached --name-only -- '*.ts' | wc -l | tr -d ' ') == 8 ]]
print 'PASS tests=28/28 types=4 eslintTs=8 prettierPaths=12 stagedPaths=12' | tee "$evidence/scope.stdout.log"
