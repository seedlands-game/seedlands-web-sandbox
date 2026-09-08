import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sourceFiles = [
  'package.json',
  'playwright.config.ts',
  'apps/node-server/src/node/server/node-authority-worker.ts',
  'apps/node-server/src/node/server/node-playable-input-diagnostics.ts',
  'apps/node-server/src/node/server/node-playable-network-session.ts',
  'apps/node-server/src/node/server/node-playable-network-baseline.ts',
  'apps/node-server/src/node/server/node-playable-network-server.ts',
  'apps/node-server/dist/node-server.js',
  'apps/web/src/app/game.ts',
  'apps/web/src/app/world/initial-world-ready.ts',
  'apps/web/src/app/world/initial-playable-area.ts',
  'apps/web/src/app/world/mesh-request-priority.ts',
  'apps/web/src/app/world/mesh-task-dispatch.ts',
  'apps/web/src/app/world/mesh-task-scheduler.ts',
  'apps/web/src/app/world/remote-playable-evidence.ts',
  'apps/web/src/app/world/world-runtime.ts',
  'apps/web/src/client/authority/remote-authority-client.ts',
  'apps/web/src/client/authority/remote-authority-input-diagnostics.ts',
  'apps/web/src/client/authority/remote-authority-input-pipeline.ts',
  'apps/web/src/client/authority/remote-authority-mesh-mirror.ts',
  'changes/2026-09-08-web-node-playable/e2e/graphics-identity-evidence.ts',
  'changes/2026-09-08-web-node-playable/e2e/graphics-identity-failure.spec.ts',
  'changes/2026-09-08-web-node-playable/e2e/remote-playable-node-fixture.ts',
  'changes/2026-09-08-web-node-playable/e2e/graphics-identity-probe.ts',
  'changes/2026-09-08-web-node-playable/e2e/journey-progress-diagnostics.ts',
  'changes/2026-09-08-web-node-playable/e2e/web-node-playable-source-inputs.ts',
  'changes/2026-09-08-web-node-playable/e2e/web-node-playable.spec.ts',
  'changes/2026-09-08-web-node-playable/contracts/validation.json',
] as const;

// prettier-ignore
const appearanceSourceFiles = ['apps/web/src/app/gameplay/asset-image.ts', 'apps/web/src/app/gameplay/load-appearance-runtime.ts', 'apps/web/src/app/scene/voxel-materials.ts', 'apps/web/src/app/ui/styles/experience.css', 'apps/web/src/client/presentation/item-mesh-definition.ts', 'apps/web/src/client/presentation/terrain-assets.ts', 'apps/web/src/client/presentation/visual-asset-catalog.ts', 'apps/web/public/assets/item-thumbnails/berry.png', 'apps/web/public/assets/item-thumbnails/dirt-block.png', 'apps/web/public/assets/ui/health-heart.png', 'apps/web/public/assets/ui/hunger-drumstick.png', 'apps/web/public/assets/ui/obsidian-hotbar-slot.png'] as const;

export const webNodePlayableSourceInputs = Object.fromEntries(
  [...sourceFiles, ...appearanceSourceFiles].map((path) => [
    path,
    createHash('sha256').update(readFileSync(path)).digest('hex'),
  ]),
);
