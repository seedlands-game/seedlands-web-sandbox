#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../../../../" && pwd)
cd "$ROOT"

node_modules/.bin/vitest run tests/agent-server/resident-scheduler.test.ts tests/agent-server/resident-host.test.ts tests/agent-server/resident-factory.test.ts --no-file-parallelism --maxWorkers=1
node_modules/.bin/tsc -p apps/agent-server/tsconfig.json --noEmit --pretty false
node_modules/.bin/tsc -p tsconfig.test.json --noEmit --pretty false
node_modules/.bin/eslint \
  apps/agent-server/src/node/resident-host.ts \
  apps/agent-server/src/node/resident-host-validation.ts \
  apps/agent-server/src/node/main.ts \
  apps/agent-server/src/resident-channel.ts \
  apps/agent-server/src/resident-factory.ts \
  tests/agent-server/resident-host.test.ts \
  tests/agent-server/resident-factory.test.ts
