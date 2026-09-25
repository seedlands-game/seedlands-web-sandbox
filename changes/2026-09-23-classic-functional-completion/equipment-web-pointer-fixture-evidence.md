# V2 Web Pointer Fixture 收口证据

阶段：V2-WEB-POINTER-FIXTURE-CLOSE-01 + GIT-22-RESTORE-REGRESSION
基线：`e0594e0260b54274db1e570f632ae4a9b9042152`
状态：fixture 收口 GREEN；原 Web pointer suite `9/9` 已真实进入并通过行为断言。

## 已授权修改

`gameplay-inventory-pointer.test.ts` 的 integrity resources 从固定 presentation 单项改为
`(pack.manifest.resources ?? []).map(...)`，沿用 dummy digest。resources-only 中间候选 SHA-256 为
`d9a5b0d46c7f9d3f06120331557f5c5e972e6e61969f53794a22309b3326aeb8`；包含两个授权 host seam 的最终
fixture SHA-256 为 `a67c6e01fcc4223b7b5961654e451cb3157fdd2bfc7e05df336bea2e027a21d9`。未修改九项行为断言、权限、
事务、timeout、Pack 或 production validator。

## GREEN 尝试与新 RED

已归档的旧 RED `v2-equipment-web-pointer-regression` 是 `1 file / 9 failed`，全部在
`assembly.ts:153` 的 Pack resource path 精确一致性校验失败。应用唯一 resources hunk后，该错误不再出现。

随后单次窗口 `v2-web-pointer-fixture-green` 为 `FAIL/exit 1`，仍是 `1 file / 9 failed`；九项全部进入
`GameplayRuntime` 构造后，在 `createRegisteredGameplayMedia` 因缺少 `callbacks.getLoadedCell` 抛出
`Registered Media host loaded-cell port is unavailable.`。栈顶为
`packages/stdlib/src/server/gameplay/gameplay-media-runtime.ts:31`，仍未进入 pointer 行为。

这说明本次 hunk 准确关闭首个 blocker，并暴露第二个独立测试宿主缺口。production 对完整 Classic Media
composition 强制要求 loaded-cell 端口是正确边界，不应放宽。仓库内
`gameplay-composition-checkpoint.test.ts` 已有把同一个 `readCell` 同时提供给 `getVoxel` 与
`getLoadedCell` 的测试模式。root 随后明确授权本 fixture 增加等价 seam：只读 `readCell` 保持原 workbench
voxel 规则并返回 `fluid: 0`，两个端口消费同一结果。原 resource FAIL 和本次 Media setup FAIL 均保留，
后续 GREEN 不回写历史结果。

应用该 seam 后，窗口 `v2-web-pointer-fixture-green2` 仍为 `FAIL/exit 1`、`1 file / 9 failed`。Media host
错误已消失；新的共同首因是 `createRegisteredGameplayStructure` 在 runtime 构造期要求
`getLoadedCell + prepareVoxelEdits`，而当前 fixture 只有按原合同保留的、调用即抛错的单格
`prepareVoxelEdit`。栈顶为 `packages/stdlib/src/server/gameplay/gameplay-structure-runtime.ts:31`，仍未进入 pointer
行为。production 对完整 Structure capability 强制真实批量事务端口同样是正确边界。

root 明确裁决本 suite 不包含 Structure 放置/破坏旅程，因此同一 setup 增加严格 fail-closed
`prepareVoxelEdits: () => { throw new Error('unexpected voxel edit batch'); }`。它不返回虚假成功对象；任何实际
批量世界写都会使测试失败。窗口 `v2-web-pointer-fixture-green3` 随后为 `PASS/exit 0`，结果
`1 file / 9 tests`，说明九项均已进入并完成既有 pointer/crafting/station/cursor/restore/mode 行为，且没有触发
单格或批量 voxel edit 的异常边界。

## 停止与边界

- 本片不会修改 production/Pack、删除 Media capability 或伪造第二世界 owner；loaded-cell seam 仅按 root
  授权加入同一个 test setup。
- `prepareVoxelEdits` 仅是 root 授权的 fail-closed capability seam，不是实际 Structure host 或第二世界 owner。
- 已准出 restore test与其 26-entry evidence manifest保持不变；没有重跑 restore 4项。
- 未 stage、commit、push、更新 PR；未运行 build、Browser、Cua、CI、deploy。专属 test tree保留，原 V2
  acceptance tree/dist未修改。

最终相关门禁：root test types、Classic test types、fixture ESLint/Prettier/scoped diff 均 PASS。GIT-22 只交付
已冻结测试/合同/证据/状态，不扩展 production。

测试与合同已通过自然 hooks 提交为 `e6a25d5739608038657c093faa1eb99fcd4e7bea`，commit tree 为
`728f4861dbb8c67d27d680bd434dbb439d7a481c`；该提交只含两个测试和两份合同。
