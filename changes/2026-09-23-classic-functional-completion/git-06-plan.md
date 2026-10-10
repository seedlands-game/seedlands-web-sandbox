# GIT-06 Media 与旧档恢复提交计划

状态：`2026-09-25` 已获 root 准出执行。冻结基线、当前本地与 upstream 均为 `78545d877ed08ee0613a690ff53e36b0c2120b69`，开始时 index 为空。

## 提交策略

代码、资源和测试组成一个诚实的最小可编译闭包：Media 公共协议被 stdlib Authority、Web Worker、Browser consumer 与 Classic Pack 同时消费；V4 restore 又同时依赖 Media checkpoint、动态 world owner、旧档 layout 和精确 lineage。不得为了形式拆出缺公开类型、缺 Pack resource 或不能恢复的中间提交。

计划提交顺序：

1. `feat(classic): complete media playback and legacy restore`：下述生产、资产、测试、spec/tasks 与合同文件的完整闭包。
2. `docs(classic): record media and restore evidence`：本 change 已准出的 evidence、`git-06-plan.md` 和执行状态；不把旧 manifest 冒充后续 capacity/layout/lineage/restore hash。
3. 验证、push 并读回远端后，如执行状态需要写入真实最终 SHA，再用一个只含 `execution-state.md` 的 checkpoint commit；不写自引用“最终 SHA”。

## 精确闭包

### stdlib 生产与协议

- Authority/协议：`packages/stdlib/src/server/authority/{authority-gameplay-view.ts,authority-media-runtime.ts,authority-player-action.ts,authority-runtime.ts}`、`packages/stdlib/src/server/protocol/{authority-worker-protocol.ts,media-playback-protocol.ts}`。
- composition/identity：`packages/stdlib/src/server/composition/{checkpoint-identity.ts,gameplay-actor-authority.ts,gameplay-composition.ts,mod-api.ts}`。`mod-api.ts` 只含已准出的 lineage 与 Media export，可整文件暂存。
- GameServer/restore：`packages/stdlib/src/server/{chunk-residency.ts,media-world-residency.ts,game-server.ts,game-server-fluid-runtime.ts,game-server-gameplay-api.ts,game-server-gameplay-host.ts,game-server-gameplay-restore.ts,game-server-restore-candidate.ts,game-server-world-commit-adapter.ts}` 与 `packages/stdlib/src/server/fluid/fluid-chunk-activation-queue.ts`。
- Gameplay/Media：`packages/stdlib/src/server/gameplay/{gameplay-media-commit.ts,gameplay-media-facade.ts,gameplay-media-runtime.ts,gameplay-media-target-runtime.ts,gameplay-registered-adapters.ts,gameplay-runtime-checkpoint.ts,gameplay-runtime-metadata.ts,gameplay-runtime.ts,gameplay-snapshot-migration.ts,gameplay-snapshot.ts,gameplay-structure-commit.ts,gameplay-structure-runtime.ts}`。
- modules：`packages/stdlib/src/server/gameplay/modules/{block-actions-module.ts,block-host-commit.ts,gameplay-module-runtime.ts,media-playback-host-commit.ts,media-playback-model.ts,media-playback-module.ts,media-playback-wire.ts,registered-block-runtime.ts,registered-media-playback-runtime.ts}`。

### Classic、Pack 与资产

- `playbooks/classic/src/{media.ts,pack.ts,legacy-composition-identities.ts,retired-actors-migration.ts}`。当前 `pack.ts` diff 仅含 Media resource/module/block-host 安装，可整文件暂存；`playbooks/classic/src/blocks.ts` 的 Lighting hunk明确排除。
- `playbooks/classic/assets/audio/to-far-shores.mp3`：`2976045` bytes、SHA-256 `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`、`audio/mpeg`。
- `ASSETS.md` 的用户提供音频、许可 unknown 段。
- `scripts/{build-gameplay-packs.mjs,pack-integrity.mjs,product-pack-admissions.mjs}` 与 `apps/web/tests/integration/engineering/pack-integrity.test.ts`。不手改或提交生成的 public Pack artifact。

### Web/Worker/反馈

- 音频与 app 接线：`apps/web/src/app/audio/{game-media-controller.ts,global-audio.ts,music-player.ts,world-media-audio-adapter.ts,world-media-player.ts,world-media-runtime.ts}`、`apps/web/src/app/{bootstrap.ts,browser-worker-session.ts,game-runtime-controls.ts,game.ts}`、`apps/web/src/app/ui/shell-overlays.svelte`。
- Authority/Worker/Pack：`apps/web/src/client/authority/{browser-authority-client-contract.ts,browser-authority-client.ts,browser-media-frontier.ts,media-playback-admission.ts}`、`apps/web/src/client/presentation/pack-media-loader.ts`、`apps/web/src/worker/{authority-media-publisher.ts,authority-worker-ingress.ts,authority-worker-response.ts,authority-worker.ts,pack-loader.ts}`。
- 旧档失败反馈：`apps/web/src/client/persistence/legacy-gameplay-provenance-error.ts`、`apps/web/src/client/shell/shell-controller.ts`、`apps/web/src/app/gameplay/companion/companion-session.ts`、`apps/web/src/worker/authority-worldgen-runtime.ts`。

### 测试与 fixture

- stdlib：`packages/stdlib/tests/server/{game-server-restore-owner.test.ts,gameplay-media-fact-drain.test.ts,gameplay-snapshot-predecessor.test.ts,legacy-gameplay-layout.test.ts,media-dependent-removal.test.ts,media-playback-host-commit.test.ts,media-playback-model.test.ts,media-playback-module.test.ts,player-inventory-layout.test.ts,registered-media-playback-runtime-fixture.ts,registered-media-playback-runtime.test.ts}`。
- Classic：`playbooks/classic/tests/{legacy-composition-lineage.test.ts,media-declarations.test.ts}`。
- Web Media/Worker：`apps/web/tests/unit/app/{browser-media-audio-consumer.test.ts,game-media-controller.test.ts,reference-audio-lifecycle.test.ts,world-media-audio-adapter.test.ts,world-media-player.test.ts,world-media-runtime.test.ts}`、`apps/web/tests/unit/client/{browser-authority-client.test.ts,browser-authority-world-harness.test.ts,browser-media-frontier.test.ts,pack-loader.test.ts,pack-media-loader.test.ts}`、`apps/web/tests/unit/worker/{authority-media-publisher.test.ts,authority-worker-ingress.test.ts,authority-worker-response-media.test.ts}`。
- Browser 旧档反馈：`apps/web/tests/unit/{app/companion-session.test.ts,client/browser-chunk-persistence.test.ts,client/legacy-gameplay-provenance-error.test.ts,client/shell-controller.test.ts,worker/authority-worldgen-legacy-provenance.test.ts}`、`apps/web/tests/integration/runtime/app/companion-checkpoint-recovery.test.ts`。
- Authority/restore：`apps/web/tests/integration/runtime/server/{autonomy-restore-capacity.test.ts,composition/classic-media-authority.test.ts}`。
- 12-file fixture 最终闭包：`apps/web/tests/integration/runtime/server/composition/{secondary-actor-permissions.test.ts,actor-profile-closure.test.ts,gameplay-registered-needs.test.ts,classic-fluid-interactions.test.ts,gameplay-registered-inventory-actions.test.ts,gameplay-prepared-mode.test.ts,gameplay-registered-feeding.test.ts,block-content-ownership.test.ts,gameplay-registered-combat.test.ts,geometry-capability-integration.test.ts,gameplay-registered-block-actions.test.ts,gameplay-mining-progression.test.ts}` 与共享 `classic-gameplay-domain-options.ts`。只暂存当前确有 diff 的路径；无 diff 的 control 仍进入隔离验证。
- lineage/checkpoint：`apps/web/tests/integration/runtime/server/composition/gameplay-composition-checkpoint.test.ts`。

### 当前 change 文档

- 合同/范围：`spec.md`、`tasks.md`、`browser-legacy-feedback-contract.md`、`browser-legacy-provenance.md`、`legacy-layout-contract.md`、`legacy-lineage-decision.md`、`lineage-contract-amendment.md`、`v1-browser-preflight.md`。
- 证据：`media-public-evidence.md`、`media-web-public-evidence.md`、`media-asset-evidence.md`、`media-dependent-removal-evidence.md`、`media-capacity-closure-evidence.md`、`media-fixture-closure-evidence.md`、`restore-owner-close-evidence.md`、`browser-legacy-feedback-evidence.md`、`legacy-layout-closure-evidence.md`、`prepointer-fixture-closure-evidence.md`、`legacy-lineage-closure-evidence.md`。
- 状态：`execution-state.md` 与本文件。

## 混合文件与保护边界

- 逐 hunk 复核所有已跟踪路径；若一个文件同时含本闭包与未准出功能，只用 index patch 暂存本闭包。当前已知明确排除：`packages/stdlib/src/{world/voxel-light.ts,server/gameplay/light-sampler.ts}`、`playbooks/classic/src/blocks.ts`、`apps/web/src/app/scene/{block-light-volume.ts,sky-visibility-volume.ts,surface-lighting.ts}` 及其 Lighting 测试。
- 明确排除后续模型：`climb-surface-model.ts`、`route-definition.ts`、`stateful-block-model.ts`、`transport-*.ts` 与对应测试。
- 永不暂存保护 dirty：`.github/workflows/ci.yml`、`README.md`、`README.zh-CN.md`、`apps/web/index.html`、`package.json`、`changes/2026-09-22-hotpath-allocation-baseline/`、`changes/2026-09-23-cloudflare-pages-migration/` 和 `reports/2026-09-23-classic-stage3/browser/`。
- 不使用 `git add -A`、stash、rebase、force 或全局 cleanup；只清理本批明确创建的临时 worktree/patch。

## 隔离 staged-tree 验证

从 `HEAD 78545d87...` 创建 detached 临时 worktree，应用 `git diff --cached --binary`，仅通过主工作区的现有依赖链接运行。每条重命令使用默认 `benchmark-window`，Vitest固定 `--maxWorkers=1`。

1. 类型：`@seedlands/stdlib`、`@seedlands/playbook-classic`、`@seedlands/web`、`tsconfig.test.json`、`tsconfig.classic-tests.json`。
2. stdlib Media/restore/layout/lineage：上述 11 个 stdlib tests；另纳入 B2 依赖的 Structure/registered block 定向回归，避免 Media dependent removal破坏已提交门事务。
3. Classic：`legacy-composition-lineage.test.ts`、`media-declarations.test.ts`。
4. Web：冻结的 14-file Media `95/95`；Browser 旧档反馈 7-file 回归；Authority Media、restore、needs/autonomy/checkpoint；12-file fixture 全部 `104/104`。重复路径只运行一次。
5. Pack：定向运行 `pack-integrity.test.ts`，在临时目录执行现有 Pack builder并核对生成 lock 的 MP3 path/size/MIME/SHA；不提交临时 artifact，不运行完整产品 build。
6. 静态：对 staged TypeScript/Svelte执行 ESLint，对全部 staged files执行 Prettier check，执行 `git diff --check --cached`；自然 hooks 不绕过。

隔离验证若因漏掉已准出依赖失败，可把该依赖加入同一闭包并重建 staged tree；若需要新生产语义、所有权不明或测试口径变化，停止并向 root 报告。

## 完成条件

- 所有 staged-tree 检查通过，语义 commit自然 hooks通过并推送当前 upstream。
- 读回 local HEAD、`@{upstream}` 和 `git ls-remote` 相等，ahead/behind `0/0`，index为空。
- 上述保护 dirty 与 Lighting/transport改动仍在 working tree且未暂存。
- 只清理本批临时 worktree/patch；不查看CI/PR review，不启动browser/dev server，不宣称真实设备已听到MP3。

## 执行记录

代码闭包的index binary patch SHA-256为 `782476924a2ad2722a76eaab5289c340610d3a7a4403630b5d3c4e0733a7d63e`，在 `/private/tmp/seedlands-git06-media` 从 `78545d87...` detached tree无冲突应用，122个路径、`10387 insertions / 546 deletions`。

类型命令均在该临时树通过默认 `benchmark-window` 执行；由于软链接依赖触发pnpm task-state保护，最终使用主工作区现有只读工具二进制解析临时树配置与源码：

```text
tsc -p packages/stdlib/tsconfig.json --noEmit
tsc -p playbooks/classic/tsconfig.json --noEmit
svelte-check --tsconfig apps/web/tsconfig.json
tsc -p apps/web/tsconfig.json --noEmit
tsc -p apps/web/tsconfig.tools.json --noEmit
tsc -p tsconfig.test.json --noEmit
tsc -p tsconfig.classic-tests.json --noEmit
```

七段均exit 0；Svelte为0 errors/0 warnings。每个测试命令均是 `vitest run --config <package config> <下面路径> --maxWorkers=1` 并在默认锁内执行：

- stdlib：本计划列出的11个Media/restore/layout/lineage路径，加 `gameplay-structure-commit`、`gameplay-structure-runtime`、`registered-structure-fact-delivery`、`registered-structure-hit-validation`、`registered-structure-runtime`，结果 `15 files / 101 tests PASS`。
- Classic：`legacy-composition-lineage.test.ts`、`media-declarations.test.ts`，结果 `2 files / 5 tests PASS`。
- Web Media与旧档反馈：本计划14个Media路径加6个去重反馈路径，结果 `20 files / 152 tests PASS`。
- 12-file composition：本计划列出的完整12路径，结果 `12 files / 104 tests PASS`。
- Authority/恢复/Pack：`classic-media-authority`、`gameplay-composition-checkpoint`、`gameplay-registered-needs`、`autonomy-restore-capacity`、`pack-integrity`，结果 `5 files / 39 tests PASS`。

临时Pack命令为 `node scripts/build-gameplay-packs.mjs --out /private/tmp/seedlands-git06-pack --playbook overworld`，exit 0；lock与文件复核为 path `playbooks/classic/assets/audio/to-far-shores.mp3`、size `2976045`、MIME `audio/mpeg`、SHA-256 `3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9`。staged TS/Svelte/MJS ESLint、全部非MP3 staged文件Prettier、`git diff --cached --check`与自然hooks全部PASS。

代码提交为 `3d429701769989168e2397b8b27c3c4364b44a85`（`feat(classic): complete media playback and legacy restore`）。合同/evidence提交、push和远端读回在执行完成后写入 `execution-state.md`，不在本文件制造SHA自引用。
