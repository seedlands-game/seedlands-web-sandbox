# S3 注册 Combat 实际消费检查点

状态：Implementing。此检查点证明下列消费链和验证范围，不代表 S3 完成，更不代表 S4–S6 完成。

## 结果与边界

默认 Overworld Pack 注册 Combat 及独立 before/after Ruleset。模块读取当前 actor/world 投影并返回 request/advance/resolve 候选；宿主 prepareCommit 在规则、最终结果 clone、事实构造和参与者预检完成后同步提交。命中由既有 Combat frontier 维护，Action、ECS 生命/掉落/移除及 NPC/观察效果使用各自 owner 的 prepared participant。

玩家和 NPC 的实际攻击均进入注册操作。未选择 Combat provider 时拒绝攻击且不启动旧 Combat 时钟。Browser 与 Headless 提供稳定玩家主体与普通 NPC service principal，脚本来源只可经当前宿主策略重新绑定。系统时钟不能作为 actor 来源。每个注册 system 后以及稳定快照前有界结清 pending；不能结清则拒绝保存。

修复了真实恢复预校验缺少 origin port、撤销来源后玩家 Action 残留，以及空闲 Combat system 消耗最后一个 gameplay revision 的问题。整个多 system advance 不承诺回滚；此切片证明的原子提交边界为单个注册 operation。

## 已执行证据

- 定向组合、恢复与 Headless：24 文件、149 用例通过。
- `pnpm verify:static`：295 文件 passed /2 skipped，1481 用例 passed /4 skipped；类型检查通过，Svelte 0 errors /0 warnings。
- 上项终态后 `pnpm build`：通过。既有 PlayCanvas 大包提示仍在，无新构建错误。
- 随后 `pnpm exec playwright test changes/2026-09-09-composable-overworld-playbook/e2e changes/2026-09-08-gameplay-foundation/e2e/gameplay-foundation.spec.ts`：6/6 通过，26.5 秒。覆盖真实采集合成木剑、鼠标攻击/连击、拾取保存重进、创造目录与飞行、安全切换和模式恢复、真实 Worker Pack 身份恢复、篡改 ESM 拒绝。
- Browser 日志出现 `favicon.ico` 404，不影响上述断言。Playwright 退出后 4173 无 listener，未留下任务预览服务。
- 本机临时日志（local-only）：`/tmp/seedlands-s3-registered-combat-{static,build,browser}.log`；局部 RED 包括 `/tmp/seedlands-s3-player-origin-restore-red.log` 与 `/tmp/seedlands-s3-combat-noop-red.log`。

## 未完成项

独立只读正确性复核仍在进行，其结论另行追加。S3 后续继续处理连击切换目标时 Action 与 Combat 身份恢复一致性、Mode/Inventory 取消事务迁移、脚本控制实际入口与替代组合证据。S4 工位/炉体/耐久/矿物成长实际接线、S5 替代 provider 和跨宿主 fixture、S6 完整生存旅程和人类 PR 交接仍未完成。

长期 docs baseline 已更新 `docs/code-map.md`：标明注册 Combat owner、当前主体策略与既有几何/落地适配的源码归属；架构方向与产品阶段未修改。没有性能收益声明，没有 npm 发布、PR 合并或权限扩张。
