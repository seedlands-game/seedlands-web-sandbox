# S3 库存与 Mode 消费检查点

状态：Implementing；独立复核已收敛。本文件记录 S3 的中间结果，不代表 S3 或 S4–S6 完成。

## 实现范围

普通 select/move/consume/craft/drop/pickup 与创造快捷栏均调用注册操作；真实命令使用其调用者绑定。Inventory actor 与地面 item 分资源授权，宿主重算候选并把 ECS 库存、装备、需求、掉落/拾取和 Combat 取消纳入一次预提交。跨角色 transfer 同样预备取消当前装备的攻击。

Mode 变更先构造模式、目录、飞行、安全落点、速度和 Action/Combat 中断候选，最终结果 clone 成功后才应用。旧 V3 Action 的重复目标被规范化，由 Combat 的当前连招目标在查询/观察边界投影。脚本攻击和 start-action 使用实际绑定；持续攻击保存恢复沿当前宿主策略重新授权。意外 resolver/allocator 错误保留待结算状态并上报，只有明确拒绝或来源失效才取消。

## 现有验证

- 可执行 RED 覆盖真实库存规则拒绝/缺 provider、脚本借权、武器 transfer 取消、Mode 陈旧计划和结果分配失败、连招换目标恢复、Needs 致死结清玩家 Action、Combat mutable request 与误吞基础设施错误。原始本机日志保留在 `/tmp/seedlands-s3-*.log`（local-only）。
- `pnpm verify:static` 通过：299 文件 passed /2 skipped，1528 用例 passed /4 skipped；core/Web/test/tools TypeScript 通过，Svelte 0 errors /0 warnings。第一次检查的 4 个失败来自调度 fixture 未批准新增 inventory-item 资源，补齐显式 read/execute 后通过；未更改权限门禁。
- 上项结束后 `pnpm build` 通过；既有 PlayCanvas 大包提示仍在。
- 随后 Browser 6/6 通过，25.7 秒：真实采集合成木剑、攻击连击、拾取和保存重进、创造目录/飞行/安全切换、新世界模式、真实 Worker ESM 身份与篡改拒绝。favicon 404 不影响断言，4173 端口在测试后已释放。
- 本机证据（local-only）：`/tmp/seedlands-s3-inventory-mode-{static,build,browser}.log`；首次夹具失败保留为 `/tmp/seedlands-s3-inventory-mode-static-fixture-failure.log`。

## 后续范围

独立只读复核已回读最终修复，未发现剩余 P0/P1/P2；复核范围不含下列后续工作。S3 继续迁移 Place/Break 的注册操作、持续来源与时钟，以及开发者 give/remove 的原子提交。S4 工位、箱子、冶炼、耐久与木石铁成长尚未完成；S5 替代 Pack 和跨宿主恢复、S6 完整旅程/视听/PR 准出仍未完成。

长期 docs baseline 更新 `docs/code-map.md`，记录 Inventory、Mode prepared owner 和 Action 目标投影；产品方向与架构责任不变。没有性能收益声明，也没有 npm 发布或 PR 合并。

独立复核已发现并修复两类问题：craft 门面返回 committed recipeId 对应的配方；最终结果 clone 后再次校验 pickup 几何与 survival 安全落点。两组真实入口 RED 合计 4 个失败，修复后 Mode/Inventory 聚焦 22 用例通过；最终 static 与 build 已再次通过；修复前门禁保留为 pre-review 日志，Browser 最终复验 6/6 通过（25.7 秒），4173 已释放。

复核回读的关键源码 SHA-256：registered-inventory-runtime `c546de37c2ea5073829f9dcb1ff149a47a2e7e0b60c48a969bf265b925272df4`；mode-runtime `d6b3f504f456cf448ef796b873bb6a49d75296fb2ae1798f03b4aa25ecc20d54`。root 最终校验时与该身份一致；reviewer 未自行执行测试。
