# 交付快照

日期：2026-09-23。状态：代码、本地验收与独立审阅完成；等待推送并读取远端 CI。

## 已实现

- Pack 注册并冻结 namespaced voxel semantics；紧凑 `Uint16` storage ID、solid/targetable/renderable、光照、mesh kind、六面材质和 render category 由同一 registry 投影到 Authority、Gameplay、Browser、TS/Rust/Wasm mesh 与块光。
- actor archetype 改为有界字符串；Pack actor profile registry 是组合世界的唯一准入，旧 Classic 名称作为明确 legacy alias。
- presentation JSON 与每个外部 texture/model/icon 都必须在 Pack resource lock 中，经过同源、路径、大小、schema 与 SHA-256 校验；Blob URL 在失败和 Application 销毁时释放。
- Authority、compute、persistence Worker 各自从同一个已锁定 Pack 组装 worldgen provider；provider identity 在任务与存档边界复核，旧存档兼容规则由 provider 自己声明。
- host-owned `host-admissions.json` 在 ESM 执行前批准 Playbook/extension 的 exact identity、integrity 与权限；stdlib/Web 不枚举替代 Playbook ID。
- `sample:modular-world` 只经公开 API 提供 storageId 500、发光/碰撞、actor、worldgen 与 presentation，构成无 Classic 内容依赖的第二 Playbook。
- 旧“94%”停止使用；`classic-progress-ledger.mjs` 只按本 change 冻结任务与证据核销，未全部完成时拒绝 100%。

## 本地证据

- `pnpm verify:static:ci`：PASS。
- `pnpm test:deterministic:ci`：Kernel 28/28、stdlib 606/606 PASS。
- 定向 Web：Pack loader/admission、presentation、第二 Playbook、compute/persistence、actor/mesh 共 45+ 项 PASS；Wasm mesh equivalence 6/6 PASS。
- Rust：`world-kernels` 12/12 PASS；`world-kernels-wasm` crate PASS；`pnpm wasm:rust:build` fingerprint PASS。
- 第二 Playbook production smoke：唯一 `classic-runtime.spec.ts`，production WebGL2 artifact 启动、storageId 500 可见、保存移除并重开仍为 0、无 page/network error，PASS。
- Classic production：同一 artifact 的 C0–C5 与视觉回归 2/2 PASS；run `d26e60e3-3313-4388-9229-e947b431e2bb`，`sourceDigest=ad9a32c9c0443c86fb571293427c7d93b35043409f8fdb17675e18e35888539a`，`artifactDigest=17beb0c47357a03c42daf21d3a3c25574b690abb38a4601c2e5f54412b76d349`，279 files。
- 第二 Playbook production smoke：`SEEDLANDS_PLAYBOOK=modular-world` 的 artifact 使用同一 `sourceDigest=ad9a32c9…`，`artifactDigest=977b79af9d0623056fc4fcd06b0cc55a6e259d7d3505471b1bf7578359d631a1`；唯一 Playwright spec 的定向 smoke 1/1 PASS，包含保存、reload 与同一 storageId 读回。

## 独立审阅

审阅 `830e26f7..cb5d3ef` 发现两个 P1：voxel 注册上限高于 mesh lookup，以及 presentation 资源在完整分配后才校验大小。修复提交 `312119b` 将注册上限统一为 0–4095，并改为流式 1 MiB 限额读取；精确复审 `cb5d3ef..312119b` 确认两项关闭，未发现新 P0/P1/P2。初次大 diff 审阅覆盖关键高风险切片而非 150 个文件逐行穷尽；修复范围复审完整。

## 证据边界

- 第二 Playbook smoke 是启动/worldgen/mesh/presentation/persistence 的有界证明，不宣称其具备 Classic 完整内容旅程。
- 当前 material slot 固定为 1–92；外部 voxel topology 支持 cube/water/glass/ice。Pack 自定义 model geometry 尚未纳入本期，装配时显式拒绝。
- V1 注册 storageId 为 0–4095，与有界 mesh semantics lookup 一致；底层 Chunk 存储继续使用 Uint16，不重解释 Classic bytes。
- 未宣称性能提升，因此没有新增性能 A/B。远端 CI 与 PR gate 在推送后读回。

## 文档与预算

长期 `docs/code-map.md` 已更新，因为 registry、Worker Pack loader、host admission 与 presentation 生命周期是跨 change 复用的职责边界。用户目标、实现假设、验收分层和 V1 限制保存在本 change spec。传统估算维持 12–20 PD；Agent 实际 credits/token/API 等价费用与额度分母不可得，记 unknown，不伪造为 0。
