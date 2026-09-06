# 玩法热路径已加载 Chunk 边界进度

## 内部合同

玩法破坏、放置、拾取、玩家攻击与 Actor 权威 LOS 只读 `GameServer` 已加载的 canonical Chunk。遇到未知 Chunk 时返回明确的 `chunk-unavailable`，同时请求既有 General Worker 异步准备；事务不扣库存、不改生命或冷却、不制造世界提交，Authority 物理继续以未知区域为合成阻挡并正常积分。准备接纳完成后，客户端使用同一事务序列重新发起才可提交。

射线读取以 `clear | blocked | unavailable` 三态区分真实遮挡和缺失数据；未知一律保守阻挡。持续破坏过程中 Chunk 暂时不可用时保留动作进度并等待后续规则步重试，不把未知误判为方块已变化。

## RED 与状态

- [x] 已定义未知目标放置不生成、不扣库存、异步准备期间物理继续、准备完成后显式重试成功的 Authority 用例。
- [x] 已定义破坏目标未知及攻击 LOS 未知不改变状态的纯玩法用例。
- [x] RED 已记录：Authority 远端放置实际同步生成并成功提交、扣除库存；纯玩法破坏把 `undefined` 送入体素定义并抛错。两项均证明旧 `getVoxel → getChunk → makeChunk` 仍可从玩法热路径到达。
- [x] 已实现已加载读取、异步准备请求和三态 LOS。生产 `AuthorityRuntime` 创建的 `GameServer` 使用 `onUnknownChunk` 严格路径；无异步计算端口的纯 Headless `GameServer` 保留显式同步读取兼容入口。
- [x] 定向 8 文件 54 项 `Vitest`、源码 TypeScript 与所改文件 ESLint 通过；其中包含交互流体、Actor 规则、存档、Authority 端口和既有生存玩法回归。
- [x] 测试 TypeScript、Svelte 检查与生产 `vite build` 通过。
