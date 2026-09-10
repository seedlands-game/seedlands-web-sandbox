# S2 集成交付快照

状态：实现与基础门禁通过，独立审阅待完成；不是整个 change Delivered，也不是 Browser 产品验收。

## 结果与范围

- 已批准的 bitECS 0.4.0 成为真实每世界实体/actor 组件 owner；旧 EntityStore/PlayerState 门面转发同一份状态。
- V4 组件存档保存稳定 ID、领域 lifetime、库存/装备/需求/控制和玩家状态；V1/V2/V3 有显式迁移 fixture。新 Action/Combat v2 合法在途阶段恢复到新 epoch，旧 combat v1 保留取消语义。
- Authority 观察、逻辑意图、物理执行、玩家输入与异步动作接入身份复核。末份食物消费后目标消失的完成路径已取得 RED 并修复。
- 项目 `.npmrc` 固定 npmjs 公共源；安装包 87 个文件 SHA-256 与获批 receipt 一致。锁文件仅新增精确依赖。

## 实际验证

2026-09-09，当前 S2 集成工作树：

1. `pnpm test tests/server`：85 文件通过、1 跳过；540 tests 通过、3 跳过。
2. 首次 `pnpm verify:static`：格式通过，因 GameplayRuntime 超出既有 500 逻辑行限制 1 行而停止。将已有恢复协调自然移到同职责 snapshot 文件，保留行为及限制。
3. 第二次 `pnpm verify:static`：中间工作树 exit 0；250 文件通过、2 跳过；1249 tests 通过、4 跳过；格式、lint、路径、覆盖率与 core/Web/test/tools 类型检查均完成。
4. 上述命令结束后单独 `pnpm build`：exit 0；保留既有大 chunk warning，不声称性能改善。
5. 第二次检查期间子任务补齐候选 EntityStore 在成功/失败验证后的 dispose；该次结果存在源码时点竞态，不能绑定最终 S2。交还并冻结全部源码后第三次 `pnpm verify:static` exit 0，仍为 250/2 文件、1249/4 tests 的通过/跳过结果；随后最终 `pnpm build` exit 0。最终 39 个源码/配置/测试文件的 SHA-256 与 `evidence/s2-source-receipt.json` 完全一致，检查至构建间无漂移。
6. `git diff --check`：通过。源码摘要随本阶段单独记录，阶段提交后独立 reviewer 从冻结 Git tree 读取。

## 文档基线

已更新代码地图和目录规范，明确 ECS actor owner、身份引用、V4 codec 与 Authority 接线职责。长期产品方向和已批准架构合同不变；未将源码细节重复写入架构基线。

## 未完成边界

- S3：标准模块的真实注册/调度/事务消费者、第一方 Pack/Playbook、每世界定义、组合身份 codec、生存/创造。
- S4/S5：完整基础循环、替代 Playbook、跨宿主旅程及错误恢复。
- S6：真实浏览器/视听、最终独立审阅、PR/CI/mergeability。基础静态/构建不能替代这些验收。
