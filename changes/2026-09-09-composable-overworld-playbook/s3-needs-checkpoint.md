# S3 Needs 与 Prepared Combat 中间检查点

当前仍为 S3 Implementing。Needs 已接入默认 Playbook 和真实 Gameplay，Browser/Headless 传入显式 system policy；完整 Combat 注册消费、普通攻击来源在宿主间重绑定和 Place Ruleset 仍待下一切片。S4–S6 未准出。

## 已有定向证据

- 实际玩家 damage/starvation 与 NPC 掉落耗尽旧漏洞有 RED，并改为 prepared ECS；Action result clone 在全部终态写入前完成。普通 legacy needs 的半点生命恢复现在封顶 maxHealth。
- world-target 状态支持显式有界 partition，地址/身份保留分片，不合法 partition 在 owner.read 前拒绝。readOriginal 保留事务首次观察供 after 规则检查。
- ECS series 一次预检最多 192 个、每片最多 128 条的 actor/drop/despawn 变更，共享 allocator；跨片末尾耗尽和稀疏数组在第一次写前拒绝。
- 注册 Needs 7 项实际测试 GREEN：规则 profile 节奏、无模块不消费、混合模式、保存恢复小数 phase、旧 V3 NPC phase 迁移、128 玩家跨片死亡末尾耗尽全部 ECS/Combat 不变，以及饥饿死亡同时取消 incoming Combat 和 Action。日志 `/tmp/seedlands-s3-needs-migration-green.log`。
- 扩展 composition 回归初次发现旧 schedule fixture 隐式带入新增 Needs，却没有对应授权。该 fixture 已明确只组合其测试需要的机制，维持单 interval system 的原验收口径；4 项复验通过，日志 `/tmp/seedlands-s3-needs-schedule-green.log`。

- 扩展真实方块回归发现调度次序影响失败边界：挖掘掉落分配失败前，Needs 已提前提交 hungerAccumulator。保留旧路径的方块前置次序：组合世界先完成该步既有 block preparation，再推进注册系统；失败不提前消耗 Needs。测试断言保留，后续 Break/Place 注册迁移仍待完成。

## 准出状态

Combat 实施者归还所有路径后，首次冻结执行 `pnpm verify:static`：285 files passed / 2 skipped、1433 tests passed / 4 skipped，coverage、所有类型检查和 Svelte 0 errors / 0 warnings 通过；日志 `/tmp/seedlands-s3-needs-static.log`。随后串行 `pnpm build` 通过，日志 `/tmp/seedlands-s3-needs-build.log`，仅原有 PlayCanvas 体积 warning。

真实 Browser 组合/创造模式 4/4（20.7s）通过，日志 `/tmp/seedlands-s3-needs-browser.log`；真实采集、木剑合成、输入战斗、拾取、保存重进与连招 2/2（14.9s）通过，日志 `/tmp/seedlands-s3-needs-journey.log`。仅已有 favicon 404，任务服务器退出后 4173 无监听。无性能采样或收益宣称。

只读独立 review 已完成并确认修复。长期架构责任未改，代码地图更新实际落点。S3 尚未完成：普通攻击要经注册操作 capture origin，zero-windup request 也必须进入 prepared frontier，延迟命中经当前宿主重授权后以 ECS/Combat/Action 联合候选结算；无 Combat provider 时禁用实际攻击。Place/Break 与 S4–S6 继续按已批准合同推进。

## 独立复核后的修正

- 根复核以实际 world 20 Hz vs bulk 5s 测试复现浮点 phase 晚触发：100×0.05 原为 4.99999999999999。Needs 三类 accumulator 加/减现在与逻辑调度同用 1e-9s 精度。RED `/tmp/seedlands-s3-needs-phase-red.log`，8 项 GREEN `/tmp/seedlands-s3-needs-phase-green.log`。该修正后 full static 1434 passed / 4 skipped、build 和 Browser 6/6（25.7s）分别通过，日志 `needs-final-static/build/browser.log`（同 `/tmp/seedlands-s3-` 前缀）。
- 独立 reviewer 发现 P1：超过 512 retained actors 的存档先恢复成功、首次 Needs 推进才失败。Autonomy detached restore 现在在任何 owner 安装前拒绝超限；真实 512 成功、513 V3/V4 原子拒绝且保留旧引用已 GREEN。RED `/tmp/seedlands-s3-needs-restore-limit-red.log`，2 files /9 tests GREEN `/tmp/seedlands-s3-needs-restore-limit-green.log`。该修正后再次串行全量准出通过，见下文。
- 其余当前切片未发现有证据的 P0/P1/P2。未单独覆盖 no-Needs NPC 负例、V1/V2 phase fixture 和超过 128 Action settlement 的 Needs 集体死亡组合；这些不替代未来 S5/S6 的矩阵验收。

最终独立复核为 bounded pass，43/43 source SHA 匹配，无剩余 P0/P1/P2。最后修复后 `pnpm verify:static` 为 286 files passed / 2 skipped、1435 tests passed / 4 skipped，所有类型与 Svelte 检查通过；日志 `/tmp/seedlands-s3-needs-reviewed-static.log`。随后 `pnpm build` 通过，日志 `/tmp/seedlands-s3-needs-reviewed-build.log`；Browser 6/6（25.3s）通过，日志 `/tmp/seedlands-s3-needs-reviewed-browser.log`。构建仍仅既有 PlayCanvas 体积 warning，浏览器仍仅 favicon 404；4173 无监听。
