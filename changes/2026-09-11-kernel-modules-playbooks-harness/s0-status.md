# S0 实际执行与交接

状态：**S0_PREPARING / AWAITING_HASH_REVIEW**。此记录只证明旧实现的基线和审核准备；S1–S5 未开始，不是整体交付。

## 身份

- Base/main live readback：`c18a890c7f97f76421e13565ec628d8c50a942da`。
- 分支：`codex/kernel-modules-playbooks-harness`；开始时 detached HEAD、工作树干净。
- 附件在执行期间被外部整理到 Downloads 的 `_sorted/documents/`，重新定位后读取；原文件未改。原文 SHA 见 [源清单](s0/source-inventory.json)。
- 只新增本 change 内方案/捕获器/证据；未修改生产源码、CI 或全局配置；没有 commit/push/PR。

## 已执行

| 项目                  | 结果及边界                                                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 远端 main / CI        | main 未前进；[CI 34572838751](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34572838751) Static/Production build 成功，Chromium 失败，Pages skipped                                                               |
| 既有浏览器失败        | `gameplay-foundation.spec.ts:269` 连续攻击连招用例：20 passed、1 flaky，exit 1；后续浏览器 job steps skipped。记录为 `KNOWN_BASELINE_FAILURE`，未本地复现或修复，不据此宣布旧主线全绿                                                    |
| 本地 `pnpm build`     | PASS：Web SSG/typecheck、Rust source/artifact fingerprint、Vite production 及 Agent bundle；不是浏览器验收                                                                                                                               |
| 定向 characterization | 4 files / 20 tests PASS；composition checkpoint、prepared host commit、module lifecycle、character behavior runtime。无 coverage 声明                                                                                                    |
| 通用入口依赖 RED      | [源边界探针](s0/source-boundary-probe.mjs)：assembly 的静态闭包 242 文件，139 个具体 gameplay/simulation 文件；正常解析后 exit 1，反例见 [记录](s0/source-boundary-red.json)。它证明当前边界不成立，不等于最终 gate 或裸 Kernel 运行测试 |
| 正式 Pack / 旧存档    | [捕获器](s0/capture-baseline.mjs) 消费本地生产 dist 的真实 Pack；Headless 公开 checkpoint export→wire encode/decode→restore 通过                                                                                                         |
| 旧存档 roundtrip      | 已验证编辑体素、3 个 berry、wood-axe 耐久 41、运行中的 hold、speech 恰好一次；[精确身份/摘要](s0/base-checkpoint-receipt.json)、压缩样本 `s0/base-checkpoint.json.gz`                                                                    |

Pack ID `seedlands:overworld`，version `1.0.0`，当前 manifest digest `e3c199e87d101672c1635d481771972edbf39deb43c336063ab3753d0b01bb89`，entry digest `924d61fc72f253c85e191caa79f1c7ff51f83bc6237ad613a7c0c5595c2c169f`。这是正式构建实际字节，不是测试中重复 a/b 的伪摘要。样本只在新 change 内写入，没有接触用户存档或 PG 卷。

第一次定向调用误写 `pnpm test -- <files>`，Vitest 因双横线未按预期筛选；观察到无关测试被启动后主动停止，退出 130，状态 `ABORTED`，不计 PASS。随后使用下方正确命令得到 4 files/20 tests。探针首轮未解析 `mod-api` 包 export 返回 `PROBE_ERROR` exit 2；修正为读取当前 package exports 后得到上述真实 RED，不把探针错误计作目标反例。

## 当前缺口与下一步

独立 Sol/xhigh 只读复核结论为原附件暂不可冻结：缺唯一组合根、组件注册/恢复、组合分面/身份、跨线程生成器 provider 四份合同，六小时估计不足。集成 owner 已把这四项补入 spec §21.1–21.4，保留其正反例与失败边界；没有再次调用 reviewer 或声称补充稿已经独立通过。Luna/medium 的只读 Harness 盘点已去重整合到执行拆解，工坊/IndexedDB/DOM 等不能下沉为无浏览器等价验证。

1. 用户审核最终 spec 精确 SHA-256 后才开始生产迁移。`docs/development-governance.md:11` 明确规定 Breaking 先写 spec 与用例，再审核 hash。
2. S0 尚缺工位在途产出的真实存档 fixture、PG/认知配对 fixture、Classic C0-C5 可执行固定路线与故障反例。它们继续阻止 S0 完整准出；已有样本不能声称覆盖全部 T05/T18。
3. 最终逐断言迁移账本尚未完成，地图、工坊、hydration、诊断等浏览器专属断言仍需具体取舍，不静默下沉或删除。
4. 新 Kernel/stdlib/Classic 包、全部目标命令/CI/Skill 规则均尚未实施。新架构恢复、唯一生产旅程、PG 与实体 GPU 性能均 NOT_RUN。
5. 长期 docs baseline 未更新：目标尚未实现，先保留现行规则，待 S1–S5 验证后同步更新。完整 `verify:static` 未重跑；S0 只需验证本次新增审核材料/脚本，不冒充迁移验收。

## 复现

S0 材料校验：两份新增 `.mjs` 的 ESLint、Node 语法检查通过；本 change 全部可格式化文件的 Prettier 检查通过；压缩样本与原 wire SHA-256、相对文档链接验证通过。格式化后重新执行依赖探针，exit 1 且 JSON 与已保存 RED 完全一致。生产构建的 70 个文件摘要见 [产物清单](s0/base-build-artifacts.json)，基线 CI 的精简 live readback 见 [CI 记录](s0/base-ci.json)。

在冻结 base 的仓库根目录（保持源、锁和 Pack 构建输入不变）：

```sh
pnpm build
pnpm test tests/server/composition/gameplay-composition-checkpoint.test.ts tests/server/composition/prepared-host-commit.test.ts tests/server/composition/module-lifecycle.test.ts tests/server/character-behavior-runtime.test.ts
node changes/2026-09-11-kernel-modules-playbooks-harness/s0/source-boundary-probe.mjs
```

探针预期 exit 1 / RED。捕获器仅在旧 base、无相关生产 diff 时运行，使用排他写入保护已保存 fixture；再次运行前需选择独立的审核输出位置，不能覆盖这份样本。迁移后 fixture 应进入稳定测试 owner，并使用新公开入口恢复；旧捕获器仅留历史 source 证据。
