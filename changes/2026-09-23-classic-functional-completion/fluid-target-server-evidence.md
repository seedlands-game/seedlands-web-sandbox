# V1 流体来源目标服务端证据

状态：`FLUID-SERVER-FRESH-CLOSE-01` 实现与定向验收已获 root 准出，交 `GIT-12-FLUID-TARGET` 合并。

Owner：Paseo `4a5710a7-3644-43f3-a42a-5647711ac047`。

行为、类型与源码静态检查的有效运行时间范围：2026-09-25T00:49:11.505Z 至
2026-09-25T01:15:57.287Z（UTC）。后续文档候选恢复与检查持续至 `01:39:12.722Z`，只证明文档完整、
格式与 scoped diff，不外推为新的代码行为验证。

## 结论与边界

- `ItemInteractionDefinition.voxelHitPolicy?: 'fluid-source'` 已按严格 definition snapshot 复制并冻结；仅 `trigger='voxel'` 合法，definitions-ready 要求 selector item 存在且声明 `{ type: 'fluid-container', fluid: 'empty' }`。
- 缺省路径仍要求当前 composition 已注册且 `targetable=true`；声明策略时仍要求已注册，并只额外接受 Authority `getFluidCell(hit)` 返回 `source=true && level=8`。通用 stdlib 不识别 Classic item、Water/Lava storage ID 或 operation ID。
- Authority 从当前 server 注入必填 `peekLoadedVoxel`、composition `voxelSemantics` 与 `getFluidCell`，无 optional fallback。校验顺序为 selection/binding、正交、可信 body 派生 eye origin 下 hit/adjacent 各 5 格、两端 loaded、registered semantics/policy、共享面内偏 `1e-6` LOS、adjacent center LOS、operation。未修改全局 `traceVoxelRay`。
- Classic 仅空桶 binding 声明 policy；water-bucket/lava-bucket 走缺省策略。使用 Browser-04 真实 body `[65.34008376511767,31.000001,2.602567930028762]`（eye y=`32.600001`）的 Authority 集成测试中，Water/Lava 均经正式 route 完成放置与收回。每个动作响应含 1 个 world commit，world/gameplay revision 各 `+1`，创造库存不变；全局 `commitSequence` 精确 `+2`。后者来自 `prepared-world-commit-metadata.apply -> owner.commitWorldRevision` 与 `block-host finalize/changed -> GameplayRuntime.touch -> owner.commitGameplay` 各执行一次 `nextCommit`，不是重复 world commit。
- schema 与运行链证据分开：`isItemInteractionTarget` 严格拒绝客户端 target 中额外 `voxelHitPolicy`；该断言不声称触发 dispatcher。dispatcher 的 default/flow/non-full/unregistered/unknown/range/stale/wall/backface/非正交负例用实际注入的 `invokeActor` spy 证明零调用；Authority 的 occupied、空桶点 solid、full inventory、world-no-op、stale selection/transaction 用 inventory、world/gameplay/commitSequence 与响应 commits 证明零写。
- 未运行 production build、browser、Cua、dev server、CI、全量 deterministic 或完整 Classic headless；因此不称产品可玩、Browser GREEN、合并 GREEN 或可发布。旧 Browser-04 仍是 artifact `23069d71...` 上的失败历史；本层已获 root 定向准出，后续仍需唯一 Git writer 提交、新 clean artifact 与唯一 browser 复验。

## RED / GREEN

### 继承的产品 RED

Browser-04 原始回执只记录首次 water-bucket 放水被 Authority 以 `blocked` 拒绝，空桶取水未触达。
后续使用 Browser-04 真实 body 的 Authority 集成夹具证明共享面修复后放水可达；继承的中间 checkpoint
再记录空桶面对 non-targetable Water source 返回 `invalid-target`。该中间取水 RED 没有可定位的独立原始
回执，因此这里只保留 provenance，不称 Browser-04 实测，也不伪造一次“撤销实现”的新 RED。Browser-03
曾把 Harness 的 eye 坐标再次当 body 加 `1.6`，不能作为本次正式几何复现。

### 恢复基线与测试校准 RED

首次恢复基线：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/item-interaction-security.test.ts --maxWorkers=1
```

- UTC：`2026-09-25T00:49:11.505Z` 至 `00:49:12.305Z`；window `104ca6e5-5a34-407e-8550-6b74d9c25dcd`；PASS，`1 file / 26 tests`。
- 这只证明接管时已有局部门禁通过，不替代最终组合证据。

接管时两条 composition suites：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/integration/runtime/server/composition/item-interaction-spine.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts --maxWorkers=1
```

- UTC：`2026-09-25T00:50:19.014Z` 至 `00:50:24.452Z`；window `fda84dd8-5ddb-4997-8d10-1f58e4a537a8`；PASS，`2 files / 24 tests`。
- 随后把 Browser-04 正式 Authority round-trip 参数化为 Water/Lava，并补 response commit、revision、commitSequence 与 inventory 断言。首次运行 UTC `2026-09-25T00:55:28.649Z` 至 `00:55:34.194Z`，window `d7fe976a-e2a1-4054-8cf0-78e980f06341`：`2 failed / 23 passed`。两例仅失败于新增测试错误预期 `commitSequence +1`，实际为 `+2`；Water/Lava 行为、响应单 world commit、world/gameplay revision 与库存断言在该失败点前均已通过。该 RED 是测试设计校准，不是 production 缺陷，不计为生产修复。
- root 读回两条实际 commit 来源后批准把预期改为 `+2`；未改 production。

最终行为 GREEN：

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/server/item-interaction-security.test.ts --maxWorkers=1
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/web test apps/web/tests/integration/runtime/server/composition/item-interaction-spine.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts --maxWorkers=1
```

- Security：UTC `2026-09-25T00:55:07.024Z` 至 `00:55:07.746Z`；window `9431fb75-357c-43a4-8216-5cabc91451cf`；PASS，`1 file / 26 tests`。
- Registration + Authority：UTC `2026-09-25T00:58:52.540Z` 至 `00:58:58.005Z`；window `32ca0c7f-62d1-482b-af0a-a29300c2c510`；PASS，`2 files / 25 tests`。
- 覆盖：严格定义/selector schema、accessor 不求值、unknown item、trigger/capability mismatch、仅 Classic empty bucket policy；六方向 exposed face、Browser-04 body、current composition semantics、Water/Lava full source、default/flow/non-full/unregistered、unknown hit/adjacent、range、stale、墙/背面、非正交、客户端 policy schema；使用 Browser-04 body 坐标的正式 Authority 集成测试覆盖 survival/creative、Water/Lava place/pick、空桶点 solid `not-fluid-source`、occupied/full/no-op/stale 原子失败。

## 类型与静态验证

以下每条均独立位于默认 benchmark window；没有用 `&&` 把后续命令放到锁外。

```sh
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/stdlib typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.test.json --noEmit --pretty false
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm --filter @seedlands/playbook-classic typecheck
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec tsc -p tsconfig.classic-tests.json --noEmit --pretty false
node scripts/benchmark-window.mjs --wait-timeout-ms 600000 -- pnpm exec eslint packages/stdlib/src/server/gameplay/modules/item-interaction-module.ts packages/stdlib/src/server/authority/authority-player-action.ts packages/stdlib/tests/server/item-interaction-security.test.ts playbooks/classic/src/item-interactions.ts apps/web/tests/integration/runtime/server/composition/item-interaction-spine.test.ts apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts
```

- stdlib typecheck：window `34386fe5-f8a2-4ee4-b64d-444c89138762`，UTC `00:59:57.868Z..01:00:00.088Z`，PASS。
- root test typecheck：window `da71cb95-f722-4220-aa7a-95ab1acd9f98`，UTC `01:00:11.864Z..01:00:14.880Z`，PASS；历史 `security.ts:126-130` TS7024 在当前源码关闭。
- Classic package typecheck：window `7e1216a0-1b13-4532-8996-09d81dfbf27e`，UTC `01:00:26.226Z..01:00:28.953Z`，PASS。
- Classic test typecheck：window `7e4c2a26-fd7f-40ca-a9db-a37b59938fe5`，UTC `01:01:52.626Z..01:01:55.893Z`，PASS。
- 定向 ESLint：window `1baa900e-24a5-48a0-9664-b6c6610d7427`，UTC `01:02:24.205Z..01:02:25.838Z`，PASS。

首次定向 Prettier check（window `9e89a4ef-ea5c-4ccd-8d11-dae82977d37a`，UTC `01:02:40.422Z..01:02:40.981Z`）准确失败，指出 3 个 TS 与 `execution-state.md` 未格式化。获批的四文件 write 只改变排版；抽查 diff 后按用户要求复用此前行为、类型与 lint，不因纯格式变化重跑。最终源码/合同的锁内 Prettier check 为 window `63e89b52-93b9-4615-afcb-880b9fca21e9`，UTC `01:15:37.980Z..01:15:38.529Z`，PASS；scoped `git diff --check` 为 window `4c394388-b490-42fc-b9ac-6deadbbc1dfa`，UTC `01:15:56.796Z..01:15:57.287Z`，PASS。后述 state 恢复后又对独立候选取得锁内 Prettier PASS。

## 基础设施与文档恢复

- 一次最终 Prettier retry 等待 `600` 秒后以 exit `75` 结束：receipt `harness/results/performance-windows/d2ccf3e4-8a5f-4af9-ab06-fd6748cf6eb2.json`，UTC `2026-09-25T01:03:55.434Z..01:13:55.442Z`，错误为 stale owner `2c2c32a1-11b3-4d3d-9d71-e9ab7ddfccab`。这是性能窗口基础设施失败，不是 Prettier 或代码失败。
- root 独立核实 owner PID `90948` 已不存在、无 benchmark/prettier 进程、owner receipt 不存在；先保存原 owner 至 `/tmp/seedlands-fluid-server-stale-lock-2c2c32a1.json`，再只 unlink 精确 `owner.json` 并 rmdir 空 reservation 目录，无递归清理。恢复后获批 retry PASS。
- 被中断的 Prettier write 曾把 `execution-state.md` 截断为 0 字节；当时针对空文件的后续 check 不计有效证据。恢复没有使用 checkout/reset：Python `subprocess.run(['git','show','HEAD:<path>'], stdout=PIPE, stderr=PIPE, check=True)` 只取 stdout，先断言标题、非空、完整 GIT-05 SHA，并用 `git hash-object --stdin` 与 `git rev-parse HEAD:<path>` 证明基线 blob 同为 `b60fc7b14b0e64c2c8cc5b55d6c930bb3bfc57fa`。
- 独立候选只施加更新时间/current owner/server结果/最新未验证边界；格式化后为 33,438 bytes / 124 lines，历史 40 位 SHA 多重集 `36/36` 与 HEAD 相同，diff 只有 5 个获准区间，且不含 fnm/git/Xcode 错误文本。候选锁内 Prettier PASS 后原子 rename；原路径独立读回 SHA-256 为 `72ae8e28349543a1d8cb5b82e5891ee8db3fe960164e88cc0b04462ddf7b8bd1`，临时候选已消失。
- 三份最终文档候选首次格式化因临时后缀 `.md.format-candidate` 无法推断 parser 而失败：window `8b041b6f-9609-4089-a61c-0c88a73e3b65`，UTC `2026-09-25T01:35:33.443Z..01:35:33.803Z`，exit `2`；候选未被改写。显式 `--parser markdown` 后 window `7fd1dce3-adb2-46f6-8976-d7c227e64969` PASS，再以去空白内容相等、digest 多重集相等和无错误日志污染为门禁原子替换。最终三文档 format check 为 window `ef293e67-7cf2-4190-8bd8-948d8933c221`，UTC `01:38:58.506Z..01:38:58.923Z`，exit `0`；最终本域 scoped diff check 为 window `1a691913-6d52-40f5-b97e-98b2ec58d309`，UTC `01:39:12.701Z..01:39:12.722Z`，exit `0`。两份 receipt 都记录 `status=PASS`、`measurement.status=NOT_RECORDED`；它们是 worker checkpoint 的历史回执，不是本次隔离 staged-tree 的最终门禁。

## 最终文件身份

下列 hash 在最终源码/测试格式化后取得；四个 transport 误写路径不在本成果中。`execution-state.md` 已完成本 evidence 路径与最终状态的窄更新；evidence/state/contract 的最终 hash 在 checkpoint 单独报告。

```text
45c075e7468ab7c3e0552cd5ec757374f5d5b03a8fb7d8c7bc9d688a7edccabc  packages/stdlib/src/server/gameplay/modules/item-interaction-module.ts
52aed5fa58e3d28c1665fa8f7e6ccf552ead275dc1a4fa3c1237891e08168573  packages/stdlib/src/server/authority/authority-player-action.ts
7bc23bd16d139e73c6168e3fc1ed6b9844ea08ba85f01814e10ef089b50fb9a3  packages/stdlib/tests/server/item-interaction-security.test.ts
60358a84f61550ef3c9280714ff13cd778447bfe819bc1e2d377a5ce37861493  playbooks/classic/src/item-interactions.ts
0cd9e682c9efae382c0ab55e591bd9f7d18699c7382763b6512aa5b059090628  apps/web/tests/integration/runtime/server/composition/item-interaction-spine.test.ts
e4450056a73fd36b904f49b835037a9cdd9fd4644ec13956fa8e03e1d522918d  apps/web/tests/integration/runtime/server/composition/classic-fluid-interactions.test.ts
94bcd951c71353795bfb59154cceef259ca18e89d5364317b360948adf4c8e1d  changes/2026-09-23-classic-functional-completion/fluid-target-server-contract.md
```

排除且未修改/未回滚：`packages/stdlib/src/server/gameplay/modules/route-definition.ts`、`packages/stdlib/src/server/gameplay/modules/transport-motion-model.ts`、`packages/stdlib/tests/server/transport-motion-model.test.ts`、`packages/stdlib/src/server/composition/mod-api.ts` 中的 transport export diff。它们不是 fluid 成果；本阶段未遇到其 type 阻塞。

长期 docs baseline 未更新：本次是当前 change 冻结合同内的局部服务端闭环，没有改变仓库长期架构或治理规则。
