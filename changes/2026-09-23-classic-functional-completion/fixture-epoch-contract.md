# V1 Fixture Epoch 身份域闭环合同

阶段：`V1-FIXTURE-EPOCH-DOMAIN-CLOSE-01`
状态：fixture 修正与静态验证已获 root 准出，交 `GIT-15-FIXTURE-EPOCH` 合并；Browser GREEN 待后续独立验收。

## RED 基线

Browser-07 唯一正式窗口 `e28f49a7-1346-4b0d-ae03-d324449ca752` 在两格门提交、geometry descriptor 与两个 Chunk 的闭门薄轴 mesh 到达后失败：fixture 期望 `seedlands:classic-canonical-runtime-v11:1:world:0`，Browser Harness 返回 `seedlands:classic-canonical-runtime-v11:1`。机器诊断 SHA256 为 `342f7cab1e49a66fd0e4c935d29c8233f9f7057e3551cf1dcdcd8557d10bad57`。Browser-07 保持 FAIL，不重跑、不改写原始证据。

`…:world:0` 来自 developer `world.identity()`，属于 persistence/world owner 身份；`…:1` 来自 Browser Authority `runtimeEpoch`，是冻结 Harness 合同给 rendered mesh、media controller 与 audio 使用的当前实例身份。两者各自有效，但不能跨域比较。Browser-07 artifact 后验的实际 window runId 是 `9d4a2ab8-fd30-47db-b444-5cdc879b0048`；`7e4328c4…` 是其归档文件 SHA256，不是 runId。

## 可验证行为

1. `v1-slice.ts` 从既有 `mediaSnapshot().worldEpoch` 读取 Browser Authority runtime epoch；值必须是非空字符串，否则硬失败。
2. 若同次 media snapshot 已有 audio，`audio.epoch` 必须与 `worldEpoch` 精确相等，否则硬失败。
3. 在任何门交互前捕获一次 pre-save runtime baseline；全部 closed/open mesh 的 `worldEpoch` 与 media snapshot `worldEpoch` 都与该 baseline 精确相等。不能在每次 mesh 断言时从被测 mesh 反取期望。
4. C5 继续以 developer `world.identity()` 的 before/after 不等证明 persistence/world owner 自身换代；该值不再传入 V1 runtime 验证。
5. restore 后从相同 media snapshot 观察面捕获新的 runtime baseline，严格要求它不同于 pre-save baseline；恢复后的 media `worldEpoch` 必须与新 baseline 精确相等。
6. 既有门 pair、descriptor、mesh vertex/index/axis/epoch、碰撞/toggle、media revision、resumePending、lastForwardedBatch、audio phase、C4/C5 与保存恢复断言全部保留。

## 禁止与证据边界

- 不修改 production、Harness API、坐标、地形、timeout 或行为流程；不截断/拼接 epoch，不剥 `:world:*` 后缀，不硬编码 scenario epoch。
- 不新增源码正则、调用次数或实现镜像测试；现有 `game-harness-observability.test.ts` 只可作为 production owner 同域合同回归，不能替代 Browser。
- 本阶段只运行 Classic/root test 类型、两个 fixture 文件的 ESLint/Prettier/scoped diff，以及必要的既有 Harness owner 合同测试。
- 静态与 owner 测试通过只表示 fixture 修正完成。真正 GREEN 必须由 954 生成新 identity artifact 后，通过唯一 canonical Browser-08 继续验证门碰撞/toggle、媒体、C4/C5 与保存恢复。
