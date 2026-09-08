# Node 产品退役实施报告

## 变更

- 从 pnpm workspace、TypeScript references、根脚本、Vitest 配置和 CI 删除 `apps/node-server` 产品包及其构建、运行、隔离校验和 Active Node 门禁；`CI=true pnpm install` 成功并报告 `Scope: all 3 workspace projects`，锁文件不再包含 Node 产品 importer。
- 删除 Node 专属测试、Web↔Node 可玩 E2E 和 remote traversal 可执行测试，保留既有 change 的 spec、delivery、independent validation 与 evidence。PR17 的浏览器近战用例原先从退役 E2E 目录导入通用画质选择函数，现已在该单人用例内使用 `SEEDLANDS_BROWSER_E2E_QUALITY`，CI 继续以 Low 画质运行该路径。
- 删除浏览器的 Connect Node、remote URL/key、`RemoteAuthorityClient`、remote mesh mirror、network baseline consumer 和 remote playable 组合入口；默认启动页及 `Game` 只组合 `BrowserAuthorityClient` 和本地 authority worker，并重新生成 SSG 启动页。
- 删除无通用消费者的 `packages/game-core/src/server/dedicated`、`packages/game-core/src/server/compute` 及专项生命周期测试。保留平台无关的 authority、protocol、persistence、checkpoint/save 与 action reference 合同。
- 将 Headless CLI 所需的 Node 平台端口从退役 app 搬到 `scripts/headless/node-core-platform.ts`；`scripts/server-headless.mjs` 改为加载该实现，命令和行为保持不变。
- 更新 ESLint package boundary：活跃包只包含 Web 与 game-core，同时保留对 `apps/node-server` 相对导入和 `@seedlands/node-server` 包导入的拒绝。新增退役合同测试，固定 Node 包、Dedicated/compute 生命周期、专项脚本、CI 门禁和浏览器 remote 产品入口不得回流。
- `.prettierignore` 忽略本 change 的 dispatched contracts，派发合同 SHA-256 复核为 `31b0a6040f957347d068d8dee30d6110c4be3b823a83087e42b47d6cb4d59496`。

活跃引用审计对 `apps packages scripts tests package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig*.json vitest*.ts playwright.config.ts eslint.config.mjs .github .ls-lint.yml .prettierignore` 执行 `rg`。剩余 `apps/node-server` / `@seedlands/node-server` 字样只位于 ESLint 拒绝规则和治理负例断言；`apps/node-server/package.json`、core Dedicated/compute sentinel 和三份专项脚本均不存在。`find apps/node-server packages/game-core/src/server/dedicated packages/game-core/src/server/compute -type f -not -path '*/node_modules/*'` 无输出。

文档同步清单由主任务处理并已出现在工作树：`AGENTS.md`、`README.md`、`README.zh-CN.md`、`docs/product-positioning.md`、`docs/code-map.md`、`docs/repository-structure.md`、`docs/living-world-alignment.md`、`docs/living-world-sources.md`、`docs/playbook-roadmap.md`、`docs/change-archive.md`。最终 Delivery Snapshot 仍应由主任务回填本报告和远端 PR/CI 结果。

## 验证

### RED / GREEN

- 首次直接运行 `pnpm exec vitest run tests/governance/node-product-retirement.test.ts` 在 pnpm 自动重建依赖时因非 TTY 报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，改用项目要求的 `CI=true` 后取得可执行 RED。
- RED：`CI=true pnpm exec vitest run tests/governance/node-product-retirement.test.ts`，1 个文件内 2/2 失败：Node app 仍在活跃 workspace；Headless scripts 平台端口尚不存在。
- GREEN：同一命令最终 1 个文件、2/2 通过；断言同时覆盖 Node app、core Dedicated/compute 生命周期、专项脚本、workspace/root/CI、Headless 平台端口和浏览器 remote 入口。

### 确定性门禁

- `CI=true pnpm verify:static` 最终通过：SSG check、Prettier、ESLint、ls-lint、coverage 和全部 typecheck 均通过；231 个测试文件中 229 通过、2 跳过，1137 项测试中 1133 通过、4 跳过。覆盖率为 statements 95.37%（907/951）、branches 90.42%（463/512）、functions 96.93%（95/98）、lines 96.89%（780/805）；Svelte 0 errors / 0 warnings。
- `CI=true pnpm build` 通过：Rust source/artifact fingerprint、SSG、Web typecheck 与 Vite production build 成功，2523 modules transformed。构建仅保留既有大 chunk warning，无失败。
- `git diff --check` 通过。

### Headless

- `CI=true pnpm exec vitest run tests/server/server-headless-cli.test.ts`：1 个文件、4/4 通过。
- `printf '/seed\n/setblock 1 -20 1 wood\n/inspect voxel 1 -20 1\n/tick 0.1\n/save\n' | env CI=true pnpm --silent server:headless -- --seed retirement-smoke --json`：退出码 0；依次返回 seed、1 voxel mutation committed、Wood (4) inspect、0.1 秒推进和 3 个 dirty chunks 保存成功。

### 浏览器单人路径

- `CI=true pnpm test:e2e:regression` 首次仅因 sandbox 禁止监听 `127.0.0.1:4173` 失败；在获批本机监听环境重跑同一命令，Chromium 20/20 通过，覆盖启动/加载、hydration、资源工坊、浏览器权威玩法和确定性 world regression。测试覆盖的历史 `changes/2026-09-07-loading-performance/evidence/world-loading.png` 已恢复为 HEAD 原件，本 change 未记录或提交新的历史截图。
- `CI=true pnpm test:pr15:integration`：Chromium 2/2 通过，确认 CI 保留的资产包浏览器单人集成路径。
- `SEEDLANDS_BROWSER_E2E_QUALITY=low CI=true pnpm test:pr17:integration`：首次暴露已退役 Web↔Node helper 的活跃导入并在本范围修复；最终 Chromium 1/1 通过，确认 CI 保留的木剑动作体验场单人路径。CI 使用相同的 `SEEDLANDS_BROWSER_E2E_QUALITY=low`。

## 风险

- 本地生产、Headless 与 Chromium 门禁均通过；Linux GitHub Actions、Pages artifact 与远端 PR 状态仍须由主任务创建 PR 后取得终态证据。
- Node Dedicated 的实现和可执行 E2E 已退出当前树，恢复能力依赖主任务已建立并验证的 archive tag 及历史 spec/evidence；本报告未独立执行远端 tag 验证。
- 通用 protocol/persistence/checkpoint 合同仍保留在 game-core，未来如再次引入 Node 产品，必须经过新的 change，并会先触发现有 package-boundary 和退役合同测试。
- 工作树中的忽略目录可能因依赖安装留下物理空目录或 `node_modules`，但没有可版本化的 `apps/node-server` 产品文件；退役合同以 package manifest、源码 sentinel、workspace/lockfile/CI 与导入边界为版本化判据。

## 实际成本

- 执行模型：GPT-5.6 Sol，high。
- Agent 墙钟约 0.7 小时，低于合同 3 小时上限；包含依赖恢复、RED/GREEN、产品与无消费者代码清理、两轮完整静态门禁、构建、Headless 和 23 项 Chromium 验收。
- 未增加第三方依赖。模型 credits、token 和 API 等价费用未由当前运行环境提供，因此不伪造数值。
- 外部写入为 0；未提交、推送或合并，未读取 `.env` 或密钥。

## 首次远端 CI 证据

[run 34269805082](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34269805082) 固定 head `4601a732e9eea80bec9df10268ebf89b5450b6c9`：静态检查、生产构建、Chromium 基础回归和 PR15 资产集成通过；近战集成失败。三次既有 Playwright attempt 分别在累计 DOM evidence 的第一击、第二击、第一击断言上超过 5 秒（`melee-action-showcase.spec.ts:84/96`）。不是编译失败，也不能仅凭该日志认定攻击未执行或只是测试抖动。

该 run 的 artifacts API 返回空数组，没有可下载截图/trace，不能声称检查过 CI 画面。保留失败记录，由独立诊断确定最小修复范围后才提交修正；不直接重跑碰运气。后续终态以修正提交的新 run 为准。

### 修订与定向复验

Terra/high 独立只读诊断沿 `AuthoritySession.wake → advanceGameplayRules → CombatRuntime.advanceActor → worker gameplay view → BrowserGameplay.consumeCombatResult` 核对：合并推进可跨过 80ms hit 相位，命中 lastResult 与当前 active phase/combo 不具有同帧保证。修订只解除近战 E2E 的同帧耦合，仍要求真实按住输入产生 5/7 点命中反馈，最后 Authority 查询中央目标为 null；攻击与产品源码不变。

新增 `tests/server/gameplay-foundation.test.ts` 的合并步进用例，直接验证第一击已在 recovery 而结果为 5、第二击 active 已 null 而结果为 7，以及 health 20→15→8 与单调 result sequence。`CI=true pnpm exec vitest run tests/server/gameplay-foundation.test.ts` 12/12 通过。`SEEDLANDS_BROWSER_E2E_QUALITY=low CI=true pnpm test:pr17:integration --repeat-each=2 --retries=0` 连续 2/2 通过（11.8s，功能测试耗时不是性能结论）。同次输入的两张原始截图已检查：第一张在收招/衔接阶段仍有目标，第二张显示 7 点命中且中央目标消失；不声称截图证明所有 tick 合并时均显示中间挥剑相位。

本轮定向复验启动时 pnpm 的自动依赖检查在 sandbox 内重建 node_modules，因 registry EPERM 失败；随后通过已批准的网络环境按原 lockfile 恢复，再运行上述测试成功。未新增依赖或改变锁文件。

### 第二次 CI 与软件渲染复现

[run 34272866705](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34272866705) 固定 `d33da14ce2a6c4f4774137e59b1e0deec645546c`：静态、构建、基础浏览器/资产再次通过，近战仍失败，其中一次 attempt 在受击提示短窗口失败。因此此前的相位/回执耦合修订只解决了一个不成立的断言，不能称为全部失败的根因修复。

本地原默认使用系统 Chrome；为接近 CI 软件渲染，固定项目已有 `SEEDLANDS_E2E_FULL_CHROMIUM=1 SEEDLANDS_E2E_SWIFTSHADER=1`、Low 和零重试。加入失败时 DOM 历史/Harness 记录后直接复现真实 `5 + 5 + 2`：第一次连击未接续，重新起手后目标剩 2HP，故第二段实际回执为 2 而非预期 7。只移除中间截图的单变量对照仍 1/2 失败，未采用该删除。

保留截图，改为在场景创建与重新布置后先确认生成/网格/计算队列为空，再确认连续 8 帧间隔小于 100ms（15s 有界失败），之后才进行短窗口输入验收。同一软件渲染环境、`--repeat-each=2 --retries=0` 2/2 通过（25.8s）。这定义的是稳定可玩场景的测试前置条件，不是性能改善声明，也不能据此宣称冷启动掉帧时按住连击或所有短暂 HUD 反馈已得到无条件保证。没有延长原命中谓词超时、增加 retry 或改产品规则。

提取的真实反馈序列、失败/通过结果、原日志 hash 与测试变体见[软件渲染诊断证据](evidence/melee-software-rendering.json)。截图删除候选被否决并恢复；失败日志不覆盖。失败时测试输出诊断 JSON，后续 CI 即使未上传 artifacts 也能从日志获取状态。

### CI 软件栅格的功能夹具边界

[run 34274457994](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34274457994) 固定 `c872ef3503f9373f739cde512e6c98280f798b6b`：静态与构建再次通过；近战在新增的队列就绪断言失败，尚未进入攻击观察。三次失败诊断分别记录 generationQueue 3/1/3，compute running/queued 均 0，瞬时 frameMs 150.7/212.2/161.4。该数据只解释本次功能夹具没有满足前置条件，不作为性能采样结论。

最终将本条近战功能夹具的 `deviceScaleFactor` 固定为 0.5，CSS 视口仍为 1280×720，Low 与所有玩法/反馈/终态断言保持。队列加载采用单独 30s 截止；连续稳定帧仍为 15s 截止，原命中结果 5s 断言不延长。本地完整 Chromium + SwiftShader + Low、零重试连续 2/2 通过（27.5s），终态截图已检查。这个夹具不声称原像素密度的软件渲染具备同样的输入窗口保证；其他浏览器基础回归与实际产品分辨率不变。

### 指针捕获与短暂反馈的夹具合同

[run 34275512285](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34275512285) 固定 `458e46baff5ca33ce84347ba7c7531472ed01583`：静态/构建与其余浏览器集成通过；近战仍有首击未发生或受击瞬时提示缺席。失败记录中已出现 queue=0 且 frameMs 10.3/45.5 的样本，不能继续仅归因于未预热；两次首击失败的页面历史只有 ready，interactionAttempts=1，未有命中/挥空回执。大量 prediction resync 是同时存在的状态，源码核查确认 resynchronizeInput 只重置预测，不清除按住攻击，不能以关联冒充直接因果。

本条展示夹具进一步明确在 Pointer Lock 获取、场景稳定后，用现有 Harness `setView(0,-15)` 固定训练射线；攻击仍由真实鼠标按住触发，未直接提交攻击命令或修改目标。受击提示、vitals 高亮和视角冲击在页面 MutationObserver 内分别记录实际出现，再验证累计证据和已有音频记录，避免把跨进程读取时提示仍未消退当作合同。受击后截图命名为 after-player-damage，不称为某一瞬间的画面保证；两次攻击截图与中央目标 null 断言保留。

相同完整 Chromium + SwiftShader + Low + 0.5 像素密度，零重试连续 2/2 通过（27.5s）。此修订是明确夹具视角与观察时机，不声称已在 CI 直接测得鼠标位移的具体来源，也不新增产品行为。

## 最终通用浏览器配置修复

进一步对照归档基线 `ec77fdd`：其 [run 34264904944](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34264904944) 与 [run 34264775875](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34264775875) 均通过；原 CI 的近战步骤明确保留 `SEEDLANDS_E2E_FULL_CHROMIUM=1` 和 `SEEDLANDS_E2E_SWIFTSHADER=1`。本次退役清理误删除了这两项通用配置，因此此前本地带这两个开关的复验与远端默认 headless shell 并非同一浏览器配置。这是已由源码 diff 确认的本次配置回归，不能称为原主线已知失败。

最终恢复两项浏览器开关；Node步骤不恢复。近战夹具像素密度恢复默认1，保留既有1280×720 CSS视口与Low。完整Chromium/SwiftShader/Low/原像素密度，`--retries=0 --repeat-each=2` 2/2通过（27.5s）。0.5像素密度候选已撤销；第二轮移除中间截图也仍1/2失败，已撤销。保留场景就绪、固定瞄准、页面内短暂反馈观察和完整5/7/目标终态断言。

最近失败 [run 34277022413](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34277022413) 的三次记录均证明受击text/vitals/camera出现、Pointer Lock存在、首击5成立而第二击未出现；这些都是恢复通用浏览器开关之前的配置，不能代替最终配置的CI验收。最终PR以恢复配置的新SHA检查为准。
