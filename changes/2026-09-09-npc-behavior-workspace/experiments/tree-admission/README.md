# Mistreevous 准入实验

候选冻结为 `mistreevous@4.3.1`。实验只使用公开导出 `BehaviourTree`、`State` 和构造参数；不调用静态 registry、私有节点、hydrate 或源码内部 API。

## 复现

```sh
mkdir -p /tmp/npc-tree-admission-lab
cp package.json package-lock.json /tmp/npc-tree-admission-lab/
npm ci --prefix /tmp/npc-tree-admission-lab --ignore-scripts --no-audit --no-fund
MISTREEVOUS_PREFIX=/tmp/npc-tree-admission-lab node admission.cjs > results.json
```

实际执行时从本目录运行第二条命令。仓库不安装候选依赖，不保存 `node_modules` 或 bundle。

## 官方资料与公开 API

- npm 包页：https://www.npmjs.com/package/mistreevous/v/4.3.1
- 官方仓库/README：https://github.com/nikkorn/mistreevous/tree/v4.3.1
- 包内 `dist/index.d.ts` 公开：`BehaviourTree`、`State`、`convertMDSLToJSON`、`validateDefinition`。
- `BehaviourTree` 公开实例方法只有 `step`、`reset`、`getState`、`isRunning`、`getTreeNodeDetails`；静态 `register/unregister/unregisterAll` 是进程全局能力，本适配禁止使用。
- 构造 options 公开注入 `getDeltaTime`、`random`、`onNodeStateChange`。官方 guard 会逐步复核 RUNNING 节点，并在中止时触发 exit callback。

## 最小接入结论

准入通过，但必须使用薄适配而非直接把 Mistreevous 节点状态当权威存档：

1. 权威树定义保留 `version/revision` 和稳定业务 node ID；编译时把 node ID、skill、参数作为 action 参数传给 Mistreevous。库生成的调试 node ID 每次重建不同，不能持久化。
2. Authority 技能表按稳定 node ID 保存 `signature/actionId/status/progress`。action callback 只做幂等 `start-or-poll`；已完成节点返回原终态，RUNNING 返回同一个 Action。这样树重建会重新遍历，但不会重放发言、物品或伤害。
3. 热替换先比较 `node ID + skill + args`。保留兼容执行；取消并清理删除或变更的 RUNNING 技能；随后构造新树。全程无需私有 hydrate。
4. 普通 selector 记忆 RUNNING 子节点，不会主动回看高优先级分支。低优先级长动作必须带 guard；guard abort 后树先进入终态，适配只在确认发生 abort 时额外 `step` 一次，使高优先级分支同一 Authority tick 接管。额外遍历严格上限 1，不能对普通 SUCCESS/FAILURE 自动重跑。
5. 与共享协议对齐，`definition.monitors` 是同一 executor 内的有界、纯条件列表。每次 Authority tick 先做边沿去重并发出非阻塞 `RequestRejudge`，再推进生活 root；monitor 不启动身体动作、不是第二棵策略。实验验证 root 连续 RUNNING 五步时 monitor 仍逐步检查，两个上升沿只产生两次请求。
6. 生活 root 的一次普通终态只标记一轮结束。下一 Authority tick 先推进持久 `activationSequence`、清理该轮 terminal ledger，再利用公开 `step()` 的自动 reset 开始下一轮；实验验证三轮各执行一次。guard abort 的同 tick 补步不推进生活轮次。
7. 持久 wait、随机选择及 sequence 已完成进度应进入世界技能/执行 ledger；Mistreevous 内建 wait/composite 状态没有公开恢复入口，不作为权威 checkpoint。

无需比较 XState：公开 API 配合世界持有的技能 ledger 已覆盖本次准入，未出现需要私有 hydrate 或修改库核心的阻断。
