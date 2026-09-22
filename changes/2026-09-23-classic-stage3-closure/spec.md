# Classic Stage 3：玩法与验收债务

状态：Delivered。该 change 由用户授权按 Stage 1 → 2 → 3 → 4 连续完成。十六色羊毛扩展 voxel schema 与存档可接受值；块光改变渲染派生状态 owner，整体按 Breaking 变更管理。交付证据见 `delivery-snapshot.md`。

## 用户结果

1. 16 种羊毛不再只是库存资源：每种都可放置、采集、掉落、保存、恢复，并在世界、手持、掉落、目录和缩略图中保持颜色一致。
2. 当前 v11 Classic 的 C0–C5 有一份可执行、同 artifact 身份的生产浏览器合同；未运行项不能写成通过。
3. 缺失的历史 checkpoint fixture 由确定来源生成并验证，可执行旧 composition/迁移测试，不伪造 provenance。
4. 用户在外观中心编辑、保存并“应用”的外观，下次进入世界后同时影响世界材质、物品视觉和已应用缩略图；草稿不影响游戏。
5. 方块光的逻辑派生不以当前相机 64³ 为唯一 owner。放置、移除、跨 Chunk、卸载/重载后保持确定性；WebGL 仍可上传相机附近的有界 64³ 纹理。

## 范围与非目标

- 保留白羊毛 Voxel.Wool=60；追加 15 个颜色 voxel 与 15 个 FaceMaterial，避免重解释旧存档字节。
- 不引入 metadata voxel、不压缩颜色到 bit field、不改变 chunk codec 格式；Uint16Array 容量充足。
- Classic 贴图沿已确认的低饱和像素色板；不为未来 Modern 预建 PBR/材质变体系统。
- C0–C5 只恢复现有唯一生产浏览器线路，不扩大为移动端、多浏览器、真实模型服务或性能基准。
- 块光不改 WebGL2 后端。渲染纹理保持有界；新增状态必须是可重建派生数据，不成为第二权威世界。

## 技术决定与待证伪假设

### 十六色羊毛

推荐：保留 60 为白羊毛，追加 74–88 对应其余 15 色；FaceMaterial 在 TorchFlame 之后追加 15 层。复用现有 woolColors、物品资产、纹理数组和方块网格。

否决：让 16 个物品都 placesVoxel=60。它无法在世界/存档中区分颜色。否决在 voxel value 中塞 metadata：当前权威、codec、mesh、Rust 和 Harness 都以紧凑数值 ID 为合同，接入总成本更高。

### C0–C5 与 checkpoint

推荐：保留 v10 historical canonical，v11 使用独立 scenario；恢复当前唯一 classic-runtime.spec 生产 artifact 路线。checkpoint fixture 由仓库内确定脚本捕获/规范化，记录 source identity 与 gzip 内容合同。

### 用户外观

推荐：复用 AppearanceProject 的 draft/applied/previous 和现有 IndexedDB。旅程固定为编辑一个代表体素材质 → 保存草稿确认游戏不变 → 应用生成缩略图 → 重新进入世界 → 核对世界、物品和缩略图三面。

### 完整块光

推荐：把已加载 Chunk 的块光作为 world/runtime 派生缓存，由 Chunk revision/邻接边界失效并可按需重建；相机 64³ 只是 GPU 上传窗口。先证明跨边界放置/移除/卸载恢复与玩法采样一致，再选择缓存粒度。

待证伪：若完整 chunk-light cache 的准备/失效成本明显高于按查询点/相机体积重建，采用“按需 chunk + 15 格 halo”的稀疏缓存，而不是全世界预计算。该选择不宣称性能收益，只有正确性与有界资源合同。

## Given / When / Then

- Given 任一旧 v2–v11 chunk/save，When 新版本加载，Then 0–73 的 voxel 语义与 bytes 不变。
- Given 任一颜色羊毛物品，When 放置、采集、保存并重开，Then voxel ID、掉落 itemId、世界材质和物品色一致。
- Given draft 外观尚未应用，When 进入游戏，Then 游戏仍使用 applied；Given 应用并重进，Then三种消费面使用同一 applied revision。
- Given 发光块在 Chunk 边界或相机 64³ 外，When 相机移动到该处或 Chunk 重载，Then照明按相同世界 revision 重建；移除后不残留，墙体仍遮挡。
- Given C0–C5 运行，When 任一阶段缺状态/真实输入/mesh consumed/restore freshness，Then整体不通过；单项历史证据不补绿。
- Given 历史 checkpoint fixture，When digest/definition map/codec 被改，Then恢复在替换 owner 前拒绝；原 fixture 可恢复并执行既有迁移。

## 实施前 RED 与测试设计

1. 羊毛：16 item 均 placesVoxel 且唯一；16 voxel/material/texture 完整；放置→采集掉落→snapshot restore；v10/v11 旧 chunk hash 不变；TS/Rust mesh material 等价。
2. checkpoint：当前缺失 fixture 的测试先稳定复现 ENOENT；新增 capture/verify 脚本后运行全部 checkpoint 迁移用例。
3. appearance：纯逻辑 draft/applied revision；浏览器使用 agent-browser 打开外观中心、修改、保存草稿、应用、重进；截图/DOM/IndexedDB readback 分层。
4. block light：跨 Chunk 源与遮挡、移除、加载缺口 fail-closed、重新驻留恢复、相机窗口外后再进入；缓存容量/失效范围有精确计数，不用功能测试耗时冒充性能。
5. C0–C5：production build 单次产物、v11 scenario、同 runId、真实 Pointer Lock 输入、WebGL2/Wasm/Worker、save-return-continue、空 error ledger。

### C0–C5 RED：retired settler 夹具

2026-09-23 首次执行当前 v11 production artifact 时，视觉合同通过，C0–C5 在初态准备稳定失败：`WORLD_REQUEST_INVALID: Unknown actor profile: settler`。生产拒绝行为正确；用户已明确要求 Classic 删除早期自定义 settler，错误在 canonical scenario 仍创建该角色。修复验收合同：不恢复生产 settler；C0 明确断言 `npcCount=0`，C4 保留真实跨四个 Chunk center、资源上界、Wasm Worker → mesh commit → postrender trace，C5 保留新 epoch、authority/checkpoint/derived 方块、库存、工作台和真实输入恢复。NPC/外部模型服务不再属于 Classic C0–C5。

## 工作量与预算

传统工程量 8–15 PD。Agent 活跃 30–60 小时；阶段内四路只读/独立写入并行，关键路径正常 24–40 小时、保守 60 小时；20% buffer 后 72 小时。沿用总 Goal 的 4,000,000 token budget。各模型 credits、API 等价费用、账户额度分母与实际 token 分类不可得，均记 unknown；不伪造换算。预计分工：主线程集成与存档/光照 owner；机械测试/素材接线使用较低成本 worker；阶段末高智能独立审阅。Blender N/A，本阶段没有新模型生产。

## 任务状态

- [x] 冻结五项责任与验收合同。
- [x] 实现并验证十六色羊毛世界闭环。
- [x] 恢复 checkpoint fixture 与迁移测试。
- [x] 完成用户外观真实应用旅程。
- [x] 实现完整块光派生 owner 与跨 Chunk 回归。
- [x] 执行当前 v11 C0–C5 production browser 合同。
- [ ] 独立审阅、提交推送。
