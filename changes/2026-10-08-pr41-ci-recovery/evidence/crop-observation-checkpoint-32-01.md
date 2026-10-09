# 作物只读观测与真实旅程接线 checkpoint32

确定性检查完成，浏览器尚未运行。承接本地 checkpoint31 `fbbb60b72497f5c167845dbdc7efab3ea6b44470`；没有合并、推送 main 或生产部署。

## 改动与边界

BrowserProductHarness 的 `cropStageSnapshot()` 深拷贝、冻结 accepted Authority cropStages 和实际 GPU 批次。读取前后检查 Authority 实例、ready、runtime/rendered-world epoch 和 gameplay 引用；状态不一致返回 null。GPU 摘要从实际 Mesh.getPositions、primitive 与 MeshInstance 参数读取；仅保留派生批次 metadata，不增加作物 owner、写接口、协议或存档字段。灯光参数存在、实例 enabled 不是实际像素可见/照明证明。

唯一完整 Classic 旅程加入 `classic-support/crop-journey.ts`：在原石头走廊候选 `[67,31,2]` / `[69,31,2]` 使用正常创造目录、Pointer Lock 鼠标和动作放土、锄地、种植 0、施肥 7、收割；第二株保留进入原 C5 保存/继续并验证新 epoch、精确投影与实际 GPU 批次，再收割。收割前后均检查耕地仍为 26，创造流程须保留生存库存。旁边石头站位避免走入第一块耕地。以上路线坐标、LOS、真实输入和画面尚未经过 Browser23，不属于通过证据。

作物步骤在 V1/V2 前，原完整 V2 和 C0–C5、visual/modular 条件、900 秒超时、画质与 Pointer Lock 断言不变；不跳过既有失败或将部分作物证据标成 whole PASS。该轨道明确为 Creative 消费者验收，未替代 Survival 种子/骨粉/水化自然成长链。

## 验证

- API RED：当前 API 不含 cropStageSnapshot，1/1 失败，日志 `crop-harness-observation-56-red-01.log`（fixtures 输出目录）。
- 定向 GREEN：观测新鲜度、独立冻结、实际 GPU 计数/参数与资源清理，3 文件 12/12；日志 `crop-harness-observation-56-green-01.log`。
- 完整 Classic headless：76 文件 522/522，141.09 秒，exit 0；根输出 `crop-observation-headless-32-01.log`。修正 readonly 测试强转仅保持原冻结变更拒绝断言。
- `verify:static:ci` 首次通过 frozen evidence 5/5、全库格式/路径/lint、production types 和 Svelte 0/0，后续测试类型失败：E2E Harness 类型缺新方法与新观测 fixture 的 readonly 强转；原日志 `crop-observation-static-32-01.log` 保留，整体命令不是 PASS。
- 修正后必要续跑 exit 0：受改动文件格式/lint，agent-server、tsconfig.test/tools/classic-tests 类型，plugin 11 文件 66 测试和 CI selection 14 测试。日志 `crop-observation-static-continuation-32-01.log`。首次 Luna scoped types 发生在新 selector 注册前，不能当作该新 fixture 已被覆盖的证据。
- Kernel/stdlib/Classic 生产源相对 checkpoint31 未改；复用 checkpoint30 stdlib 153 文件 1105 通过，不重复全量测试。未运行本组 build、browser、产品/性能验收。

原始输出在 `/workspace/pr41-recovery-20261008-root-01` 与 `/workspace/pr41-recovery-20261008-fixtures-01`；未覆盖旧失败日志或 sealed evidence。只读 review 57 的恢复后耕地断言已采纳，无额外模型会话。

## 下一步与预算

构建新的精确 source/artifact build22，使用唯一完整 canonical 入口运行 Browser23，保留 stage 0/7/harvest/restore 截图及失败 trace。旧 4db dist 不适用于当前源码。完整 V2/V3/Modular/V4/194 和组合整帧 A/B 未闭环，本检查点不表示 PR 可合入。

10 月 9 日 02:41 UTC 主对话产品 UI 实际周剩余 90%，约 60% 停止线不变；没有将 token/credits 估算换算为百分比。02:45:39 云端连接核验正常，源码和输出保留，没有重装或重复构建。
