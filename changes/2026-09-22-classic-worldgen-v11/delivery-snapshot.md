# Classic worldgen v11 交付快照

状态：Delivered。实现提交 932eb13ad0dcc6c9e5c5c6d4b136515cb343efa5。

## 交付行为

- 当前生成器升级为 v11；Classic provider identity 为 11.0.0 / seedlands:classic-terrain-g2-g11。
- v11 森林树源降低、树干增高、树冠分层；平原/森林重复高草降低，稀有花/蘑菇和 dry/wet 标志性阈值不变。
- v11 在原点半径 16 内按六格通路、近树、低顶、距离和稳定坐标评分；非碰撞植物可穿行，逐格允许上下一级。近区完全无安全点时按旧顺序在半径 20–64 找首个安全列。
- v2–v10 仍走原树形、植被和首安全列算法；v10 worldId、玩家坐标与历史 provider identity 不被静默迁移或覆写。启动页、世界目录和 F3 显示实际版本。
- 原 v10 canonical fixture 保留；当前 C0–C5 入口使用独立 canonical-runtime-v11.json。

初始视角朝向没有进入本切片；现有 Authority/协议没有独立的安全朝向恢复合同，位置改善已交付，朝向留作后续独立 change。

## 自动证据

- pnpm test：Kernel 28/28，stdlib 598/598。
- pnpm verify:static:ci：格式、路径、ESLint、全部生产/测试类型、Svelte（0 错误/0 警告）、架构边界 66/66、CI 选择 8/8 通过。
- Rust world-kernels：12/12。
- v2–v11 标准 TS / staged / scalar Wasm / SIMD Wasm：6/6 逐字节等价。
- Classic provider 定向测试：3/3；版本选择与 SSG/应用层定向测试：33/33。
- metrics.json：A/A 通过；A、B1+B2、B3 共 72 行固定 seed 原始记录，裁决见 experiments.md。

## 生产与浏览器证据

Exact-head 生产构建：

- source SHA：932eb13ad0dcc6c9e5c5c6d4b136515cb343efa5
- source digest：9cf89e5cc66dd4da2f5d1ed4473a5c3b062349516a7c8402301249fc5faf72a0
- lock digest：44db46fb0f159ebe6d88435c8cfb5d46127d1c7f363a50d19217d454c30e1169
- artifact digest：be23fcacd435c426072708e3559e6a00b5f0758bb95febcacf5cb28e0658fce1
- 文件数：274；builtAt：2026-09-22T16:33:26.486Z

同一 artifact 字节的生产预览由隔离 agent-browser 0.33.2 会话读回：F3 Generator v11；Wasm simd · matched，1001 调用/0 trap；控制台仅 Tone 正常日志，页面错误为空。开发态推荐 Seed 获取 Pointer Lock、真实 W 移动和转头前后两帧；生产首帧与说明见 reports/2026-09-22-classic-completion/phase2-browser/。

## 独立只读审阅

- spawn 审阅发现远区 fallback 合同、低顶碰撞语义、Worker 读取上界与通路测试不足；已明确 fallback，低顶改为仅统计 solid，并让指标直接复用生产通路 helper。Worker 读取上界由半径 16 和测试中的最大读坐标约束；极端 fallback 未作为性能收益声明。
- version 审阅发现 canonical v11、ApplicationShell v10 旧档和 provider v11 覆盖不足；均已补齐。其关于占位 hash 的观察基于读取中的旧快照，当前测试已填入实际固定 hash 并通过。
- 无残留 P0。阶段末高智能全局 P0/P1/P2 审阅仍按总计划在 Stage 4 执行。

## 已知边界与长期文档

- wet/cold 没有进入本次 24-seed 出生样本，不宣称其画面分布已量化；对应装饰阈值未改。
- 开发态/生产浏览器是视觉与运行时证据，不替代确定性、存档与 artifact identity。
- 长期 docs baseline 不更新：本次行为由版本化 provider、当前 change spec 和实验记录完整约束，没有改变可组合架构、CI 边界或产品长期方向。
