# S3 Logic 与地面食物消费者检查点

状态：实现与当前完整门禁已通过，独立复核收尾中；S3 / S4 / S5 / S6 仍未整体准出。

## 行为

脚本 Logic 的实际 Harness principal 进入 Authority 和注册 Combat/Feeding；逐 actor 的 world.action execute 在接纳 wish/Action 前检查。默认开发者采用稳定 subject，当前宿主 alias 与 policy 决定恢复后的执行；自定义策略不被扩权。已有 Combat 只能由相同来源保留，未来命中继续重授权。

地面食物消费形成一个预备事务，覆盖 ECS needs、同身份 world-item 减量或删除、Eat 终态和 Combat/自治效果。缺模块、拒绝、规则 veto、clone、容量或空间条件失败不提交这些 owner。调用者与 operation module 都须具备 actor execute 和 item execute；仅读 actor 不允许消费。旧 pending Eat 无持久授权来源，在隔离恢复验证中取消，食物/needs 保持不变。

## 当前证据

- RED：脚本无 Combat 权限/来源借用、默认开发者来源、Feeding 缺 provider/grants/veto/最终 clone、旧 pending Eat 恢复、调用者或模块缺 actor execute 均有实际失败记录。
- 最新定向：Logic + Feeding 入口 22 项；追加 actor execute 两项后 Feeding 宿主 14 项通过。纯候选 8 项、prepared ECS/Action/Feeding 各自测试通过。
- `pnpm verify:static`：307 文件通过 / 2 跳过；1622 测试通过 / 4 跳过；所有 TypeScript 与 Svelte 0 error / 0 warning。
- `pnpm build`：单独通过。静态与构建未并行运行。
- Browser：9/9，包含本 change 6 项、gameplay-foundation 2 项和木剑体验场 1 项。真实脚本跨宿主恢复/current revoke、disabled developer、ESM 篡改拒绝、创造切换/飞行/恢复保持通过。
- 体验场回归两次失败的 trace 定位 retired EntityId 复用；改用实例 UUID 后，重置等待新目标就绪，真实双段 5+7 伤害、目标死亡、受击 HUD/音效全部通过。已实看第二段截图，其 HUD 显示第 2 击与 7 点伤害；未以截图代替动作断言。
- 验证结束后任务拥有的 4173 监听已释放。

local-only 日志：`/tmp/seedlands-s3-logic-feeding-review-static.log`、`/tmp/seedlands-s3-logic-feeding-review-build.log`、`/tmp/seedlands-s3-logic-feeding-review-browser.log`；早期失败与修复日志保留。此次无依赖安装，本项目 registry 实读仍为 npmjs。

## 复核与后续

独立 reviewer 的 Feeding actor execute P1 已有两个 RED / GREEN 修复，最终回读待返回。Root 另记录同类 Inventory pickup / Block 跨资源 actor execute 待核实和修正，不能将此检查点等同完整权限准出。

长期 docs baseline 更新代码地图，记录实际注册适配与 owner 归属；产品路线和架构责任不变。仍需默认内容归属收尾、S4 实际工位/工具成长、S5 替代 Playbook 与完整跨宿主合同、S6 正常输入旅程及 PR/CI。未推送、未创建 PR、未合并。
