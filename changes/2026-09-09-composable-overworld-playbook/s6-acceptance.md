# S6 最终集成验收记录

状态：Implementing。不是完成声明；最新源码与下列每轮证据分别绑定。

## 冻结与主干

S4/S5 实现提交 `d05206b`，主干 #27 同步提交 `27bf75d`，V4 Wasm 构建凭据及 S6 预算提交 `61901d3`。同期主干为 `baeba09`；只同步已合并变更。测试配置冲突保留两边 E2E 类型目录，动态阴影逻辑与本 change 的世界物品定义解析同时保留。

## 第一轮完整静态与修复

`61901d3` 的 `pnpm verify:static` 完成格式、Lint、路径和全量逻辑测试，结果 1756 passed、2 failed、4 skipped；失败后未进入 typecheck/build。日志 `/tmp/seedlands-s6-static1.log`。两项实际库存/Combat 集成测试捕获同一回归：无近战档案的 settler 作为受击目标时被投影拒绝。

修复合同：Combat 受击角色允许没有近战定义；只有主动攻击者必须提供合法定义。投影 `meleeDefinitionId` 可为 null，请求候选创建前拒绝无定义攻击者，不恢复默认 unarmed。新增实际 owner 用例同时检查无攻击能力角色发起失败且快照不变，以及玩家攻击成功且目标实际扣血。原失败和新 RED 保留在 `/tmp/seedlands-s6-unarmed-target-red.log`；首轮定向夹具误用了仅玩家入口（Unknown player: bob），改由普通角色 Combat 入口验证；最终 35 项通过，见 `/tmp/seedlands-s6-unarmed-target-green2.log`。

## 独立审阅

独立 reviewer 对冻结 `61901d3` 与 base `baeba09` 按项目 Code Review Skill 执行；后续修复通过精确 commit delta 回读。合同 SHA-256 `c4ab1a73db2535711bb234dc35eda81a3faf40cb117e85f5fd599ff06277572e`，S6 共享 12h 中分配最多 4h，只读、无外部写入。最终报告已返回：已覆盖范围没有剩余可证实的 P0/P1/P2，准确覆盖与限制见 [独立审阅](s6-review.md)。S1–S3 使用既有 scoped review 加最终关键接缝复查，不声称本轮全量逐行重审。

## 当前剩余

本地实施、证据、演示与独立审阅已闭合；剩余 PR 当前 HEAD 的必要 CI 与 mergeability 读回。

## 修复后的完整本地准出

冻结源码 `50ff14c2d1a3c62cafbb3b85e18b789e33d10e9c`：

| 门禁                                                 | 结果                                                           | 记录                                              |
| ---------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| `pnpm verify:static`                                 | 330 文件、1759 passed、4 skipped；Svelte 0/0、全部类型检查通过 | `/tmp/seedlands-s6-static2.log`                   |
| `pnpm build`                                         | source/artifact fingerprints、Pack 构建与生产 bundle 通过      | `/tmp/seedlands-s6-build1.log`                    |
| 生产 preview，change 全部 E2E                        | 10/10，1.7min                                                  | `/tmp/seedlands-s6-browser-prod1.log`             |
| dev，既有完整 regression                             | 21/21，43.9s                                                   | `/tmp/seedlands-s6-browser-dev-regression1.log`   |
| dev，木剑体验场、PR15 模型资产、#25 双向 parity/诊断 | 5/5，14.8s                                                     | `/tmp/seedlands-s6-browser-dev-integrations1.log` |

独立点击转换使用真实构建和校验的 ESM 字节，普通 Headless 采集后经 Browser 选中槽合成、真实右键放置，再还原至 Headless 核对库存/地形。建造样例没有 Combat/Needs/生态也能开局、使用创造目录。工位成长截图核对铁镐 250/250、木镐 57/60、石镐 120/132，图标解码正常；死亡提示说明掉落与复活后找回路径。36 项浏览器断言全部通过，没有 pageerror；启动日志有浏览器默认 favicon 404，不影响 Pack/世界资源。

运行产物分别保存在 `/tmp/seedlands-s6-prod1-artifacts`、`/tmp/seedlands-s6-dev-regression1-artifacts`、`/tmp/seedlands-s6-dev-integrations1-artifacts`，不把旧截图当当前结果。两份历史外观快照测试在 dev 环境通过；它们动态导入源码，先前在 preview 的失败没有当成产品缺陷。测试产生的历史 loading 截图已恢复原版本。所有本任务 dev/preview 已停止，4173 端口确认释放。

CI 增加独立的 `pnpm test:composable-gameplay` 步骤及 always evidence 上传，沿用已有 Chromium job/权限/20min 上限，不改变既有回归全集、flaky 硬失败或重试策略。该步骤显式保护本 change 的 10 项需求场景，不将它们迁入长期基线。远端结果待 PR 当前 HEAD 读回。

新 CI 步骤的同名命令和低画质配置在本机 dev 服务复验 10/10 通过（1.8min，`/tmp/seedlands-s6-browser-dev-composable.log`）；Playwright 所有者自动停止服务，4173 再次读回释放。文档中的两种独立 Headless CLI 也实际启动并在 stdin EOF 正常退出，未留下服务。正式 Git rename 已保证 `examples/readme.md` 在大小写敏感的 Linux checkout 中使用相同文件名。

## 模型视觉补充

`midscene/overworld-visual.yaml` 通过实际入口、E 背包与创造模式按钮运行；生产预览的同一实现 `50ff14c`，Chrome 1280×960。模型连通校验通过；单场景 1/1、三处 aiAssert 全部通过（39.474s），没有失败或未执行步骤。分别观察三维地形/准星/快捷栏、背包槽位/配方/中文可辨认、创造目录图标/名称/选择入口。结构化结果见 `evidence/s6-midscene-results.json`，原报告留在本机 `/tmp/seedlands-s6-midscene/midscene_run/report/`。

该运行复用现有依赖与进程中的模型配置；从独立临时目录执行，未读取仓库 .env、未写入或展示凭据。预览服务已退出，4173 再次确认释放。模型视觉补充不替代成长、权限与保存的权威状态测试，也不构成主观听感或性能结论。

## PR 首轮 CI 与冷启动修复

[PR #30](https://github.com/seedlands-game/seedlands-web-sandbox/pull/30) 首轮 head `2c21f2f`，run `34422614222`：Production build 通过；Chromium 基线 20 passed/1 flaky，被既有 failOnFlakyTests 拒绝，后续玩法步骤未执行。失败用例为旧 loading UI，首次进入后 HUD 隐藏、Seed 回到空值；不能把 retry PASS 当整体通过。

原 job 日志 `/tmp/seedlands-s6-ci-browser-job1-clean.log`；GitHub artifact `regression-34422614222-1` 保存失败 context 和 retry trace。本机 Vite `--force` 冷启动真实复现 3 passed/1 failed，`/tmp/seedlands-s6-cold-vite-red.log` 明确在首次 world Worker 导入时才发现 bitecs 并整页 reloading。

修复仅在 Web 的 optimizeDeps.include 写入 `@seedlands/game-core > bitecs`，让现有正式传递依赖在首次扫描时解析；没有增加依赖或放宽 timeout/retry/flaky 门禁。相同强制冷启动四项 E2E 4/4 通过（6.2s），`/tmp/seedlands-s6-cold-green.log` 与 `/tmp/seedlands-s6-cold-vite-green.log` 记录不再 late optimize/reload。独立 reviewer delta 复核无发现。配置改变后的完整 static/build 及远端新 HEAD 结果继续读回，尚未预填。

该冷启动配置的最终本地复验：完整 static 330 files /1759 passed/4 skipped、Svelte 0/0 与全部 types，通过；独立 build 通过。日志 `/tmp/seedlands-s6-static3.log`、`/tmp/seedlands-s6-build2.log`。配置字节与独立 delta reviewer SHA-256 一致，任务 4173 服务已停止。

首轮 static 后续完整日志补充：1757 passed/2 timeout/4 skipped，858.77s；新点击样例 5324ms > 5000ms，两日生存 225263ms > 120000ms，未报告业务断言失败。依据实际 runner 数据，只给两个 Headless 样例 15s、完整两日 360s，不改变循环、assertion 或全量 coverage/20min job 门禁；独立 delta 复核无发现。定向 serial V8 coverage 诊断 2 files/3 tests PASS，89.01s（`/tmp/seedlands-s6-journey-budget-green.log`）。该子集运行显式不应用全世界覆盖率阈值，58.3% 只用于诊断，不计全量 coverage 准出；完整 CI 仍执行原 80% world 门槛。

`43d26a0` 的中间 CI run `34423560880` 因等待预算修复而取消，不能计绿色；新 SHA 将重新执行全部 required checks。
