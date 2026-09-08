# PR #15 主干同步与准出修复

状态：Active。用户明确授权接手 PR #15 冲突并推进至可合并；范围仅为现有三包基础的集成与评审修复，不自动合并，不修改 PR #17。

## 范围与决定

- 普通 merge 同步 main 9c04598，保留已发布 Node 历史和资产工坊功能。将新增 Web 源码、静态资产与 HTML 入口放入 apps/web，跨包引用经 game-core exports；不重写冻结历史证据。
- 核实并修复 PR 上两条持久化评审：检查点可达文件回收，以及避免启动时串行读取所有 Chunk blob。持久化修复必须保留 CURRENT/PREVIOUS、锁、durable 顺序、损坏拒绝和崩溃恢复合同，不改变磁盘格式。
- 既有单一运行时、权威规则、Wasm 默认与 TS fallback 不变。对引用、资产路径、构建入口和源码导航作必要同步。

## RED 与测试设计

初始 RED：GitHub #15 CONFLICTING，合并 main 后出现目录迁移冲突，以及 voxel-materials 和 code-map 内容冲突；存储评审问题先用确定性测试复现。

| Given / When                    | Then                                                                       |
| ------------------------------- | -------------------------------------------------------------------------- |
| 合入主干资产工坊后启动/构建 Web | 工坊入口、GLB、缩略图、游戏外观可访问；core 不引入浏览器依赖               |
| 普通合并 main 并推送 #15        | 发布历史保留；最新 SHA 必要 CI 通过、无冲突、ready for review              |
| 多次提交与崩溃遗留文件          | 仅回收 CURRENT/PREVIOUS 均不引用的已知存储文件，保留恢复链和正在使用的数据 |
| 启动大索引世界及按需读取 Chunk  | 启动不逐一读 Chunk 内容；按需加载保持尺寸、hash、身份/版本校验与失败语义   |

验证：pnpm verify:static、pnpm build、pnpm build:server；受影响 Node 持久化与进程测试、真实 Chromium regression，以及本 change 对资产工坊的集成旅程。冻结后独立复核存储修复，再读回最新远端 SHA、CI、冲突与评审项。

## 任务状态

- [ ] 合并主干并完成目录/入口冲突
- [ ] 修复和验证存储评审
- [ ] 静态、构建、真实浏览器回归
- [ ] 推送、CI 和 PR 最终读回

## Delivery Snapshot

待验收。长期 docs baseline 将同步资产工坊在三包中的导航和相关存储行为；历史验收记录保留原源码绑定，不冒充本次证据。
