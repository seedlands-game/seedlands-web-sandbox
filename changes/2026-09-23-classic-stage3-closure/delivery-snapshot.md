# Classic Stage 3 Delivery Snapshot

状态：Delivered（2026-09-23）。本快照覆盖十六色羊毛、历史 checkpoint、用户外观、Chunk 块光与 v11 C0–C5；性能 A/B 不在本次准出结论内。

## 实现结果

- 羊毛：保留白羊毛 `Voxel.Wool=60`，新增 15 个颜色 voxel 74–88 与 FaceMaterial 78–92；16 个颜色物品均可放置、采集、掉落、存档和恢复。基础 `wool`、`wool-block` 与 `white-wool` 继续映射 60，白羊掉落 `wool`，染色羊掉落 `<color>-wool`。
- Checkpoint：从 Git blob `51989b626cc8f5624ad755f279dfa7dc3ca99016` 恢复 `base-checkpoint.json.gz`；SHA-256 为 `f8ef2fbdad68a16fdcd2e5bea59b0fd96cdcc76ee697daf7f0dea6bff86329cc`。只接受显式提供且精确匹配的历史 composition identity。
- 外观：用户资产上限仍为 128；派生缩略图容量独立为当前 `builtinItemBindings.length`。真实浏览器应用生成 194 张缩略图，提示改为读取实际数量；基础白羊毛也进入受限 pixel-item 准入。
- 块光：浏览器 World 持有按已渲染 Chunk 建立的可重建 64³ R8 brick（32³ core + 16-cell halo）；world commit 事件使 3×3×3 邻域失效，每帧最多重建一个，MeshInstance 使用自己的采样参数，水面过渡继承当前 brick，销毁 Chunk 时释放纹理。Harness 只有在 active brick 的 dirty 队列清空时才报告 ready/current world revision，避免视觉验收在部分 brick 仍陈旧时提前通过。
- C0–C5：v11 canonical 删除已经退出 Classic 的 settler 夹具。C0 明确要求 `npcCount=0`；C4 继续验证跨四个 Chunk center 的 Worker → mesh commit → postrender；C5 继续验证新 epoch、authority/checkpoint/derived 方块、库存、工作台和真实输入。

## 浏览器证据

手工产品旅程使用 `agent-browser 0.33.2`、隔离 session `seedlands-stage3-2c850b53f248` 和本地 production preview。证据位于 `reports/2026-09-23-classic-stage3/browser/`。

- 羊毛：在 seed `stage3-wool-20260923` 创建 16 色展墙，`flushSave` 后整页 reload，再由“继续世界”重进；`wool-after-reopen.json` 对 60、74–88 的 16 个位置全部读回匹配。截图 `wool-gallery-clean-before-reload.png` 与 `wool-gallery-after-reopen.png` 展示重开前后外观。
- 外观草稿：将“泥土贴图”色板第 1 色从 `[121,82,57]` 改为 `[47,111,159]`；保存草稿后 IndexedDB 显示 draft override、applied 无 override，游戏世界与创造目录仍为默认棕色。
- 外观应用：应用后 IndexedDB revision 3，draft/applied 相同，`thumbnailCount=194`；重进游戏后世界泥土平台与创造目录图标同时显示蓝橙纹理。
- 外观回滚：恢复上一个应用版本后 revision 4，draft/applied override 均为空、previous 保留蓝色版本；重进后世界和图标恢复默认棕色。page error 与 failed response 均为空。
- agent-browser 的 `record start` 在本版本会新建 tab，短录屏未包含游戏操作，不作为验收证据；有效证据为稳定 tab 的截图与 Harness/IndexedDB JSON readback。

正式 production contract 的最终 runId 为 `3165d99f-2dc7-441b-bbde-0168af40d262`：

- C0–C5 全部 PASS，视觉/连续帧/单击破坏合同 PASS，合计 2/2。
- artifact：source SHA `e4751cbe606b7a956cb07b94704fa15ea7622980`，source digest `af5ea1bfdcdf7690e4b9aaa7ffbbf7289436f284ce8f38d93bb1c1753ed1e554`，lock digest `44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169`，artifact digest `ec447bc09102dbf7e07d61591fdff9a8d85566235dc1e1da0ae64eae20c40ee1`，274 files。
- 运行使用实际 Headless Chromium WebGL2、Authority/logic/persistence/fluid/general Workers 与 SIMD Wasm；pageErrors / failedResponses 为空。
- 首次 RED runId `16ab9dcf-6eeb-44cb-a76d-603226a9a935` 因 canonical 仍创建 retired settler 而失败；迁移合同后连续运行通过。独立审阅随后发现 ready/source revision 会在部分 brick 尚未重建时提前报告新鲜；`e4751cb` 修复后由上述 exact-head run 再次通过。

## 自动验证

- `pnpm verify:static:ci`：PASS。格式、路径、全仓 ESLint、全部包/测试 TypeScript、Svelte、66 条 ESLint 架构规则、8 条 CI 选择器通过。
- `pnpm test:deterministic:ci`：Kernel 28/28，stdlib 600/600。
- Stage 3 Web 定向测试：Wasm mesh、块光、water transition、checkpoint、羊毛/配方/物种、外观项目等首轮 50/51；唯一失败为基础 `wool` 未进入受限 pixel-item 准入。修复后外观目录相邻测试 15/15，最终 production C0–C5 再次 2/2。
- Production build：PASS，最终身份见上。

## 块光证据边界

Medium 实机诊断观察到 50 个 active chunk brick、13,107,200 bytes（12.5 MiB），stream center 从 `[-1,0]` 移到 `[5,0]` 后仍保持同一上界；远处光源放置/移除使 rebuild count 前进。该 bytes 字段只估算 active chunk brick，不包含 replacement/water-transition 窗口内短暂并存的旧/新纹理。单元测试覆盖跨 Chunk、遮挡、移除、未知邻接 fail-closed、水面过渡绑定、dirty/ready 状态和销毁。

本次只证明正确性、生命周期与资源上界。没有取得与旧单相机体积 A 的同身份 A/A + A/B 样本，因此不宣称帧率、延迟或资源性能改善；正式 C0–C5 回执也标记 `NOT_MEASURED`。

## 兼容、回退与未覆盖项

- 旧 voxel 0–73 语义不变；白羊毛 60 不重解释；chunk codec 仍为 Uint16Array。
- 用户外观已经恢复默认，蓝色泥土只存在于 previous 快照；手工旅程使用隔离浏览器 profile，不影响用户浏览器。
- C0–C5 不再覆盖已退出 Classic 的自定义 NPC 或外部模型/PG/WebSocket；这些属于通用协议或未来其他 Playbook，不应通过恢复 settler 伪造 Classic 覆盖。
- 未覆盖实体 GPU、多浏览器、移动端、音频主观质量、三日 soak 和块光性能 A/B。

## 长期文档与实际预算

长期 docs baseline 未更新：本阶段没有改变包职责、目录规则或 WebGL2 决策；职责仍由现有代码地图与组合架构文档覆盖。C0–C5 的产品合同变化记录在本 change 与 versioned scenario。

传统工程量估算保持 8–15 PD。实际 agent 活跃工时、分模型 credits、API 等价费用和账户额度分母不可从当前环境可靠取得，记为 unknown；不伪造换算。Goal 使用量由平台单独记录。
