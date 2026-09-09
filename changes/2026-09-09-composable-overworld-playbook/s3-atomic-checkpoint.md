# S3 原子参与者检查点

当前为 S3 中间切片，未完成 needs/Combat 注册迁移、致死多 owner 结算或 S4–S6。

## 修改与证据

- 有界 ECS participant 支持完整 actor health/component 候选、world-item 分配和精确 lifetime 删除。五文件 23 项测试及 core/test 类型检查已通过，见 s3-entity-atomic-evidence.md。
- drop/pickup 的实际 RED 复现分配耗尽先扣库存，以及一次掉落递增两次 gameplay revision。改为完整 ECS 准备提交，六文件 38 项 GREEN；日志 `/tmp/seedlands-s3-atomic-inventory-red.log`、`/tmp/seedlands-s3-atomic-inventory-green.log`。
- 实际生存挖掘 RED 复现删除方块后掉落分配失败。改为 World + ECS 预校验提交，保留失败时原方块和 breakAction。`/tmp/seedlands-s3-atomic-block-red.log`。
- GameServer 单编辑准备复用现有结构事件、collision delta、流体 byte 与 bounded frontier/rescan。未知 chunk、版本耗尽、新鲜度、重复使用、未经 validate 的 apply 均拒绝；真实水体放置/移除结果与原路径等价。真实玩家放置消费与挖掘掉落通过；七项 `/tmp/seedlands-s3-world-player-green.log`。
- 五文件 22 项集成 GREEN，`/tmp/seedlands-s3-atomic-integration.log`；迁移中一次误删旧 Combat spawnDrop 回调被测试和类型检查捕获，已修复。world wrapper 曾允许未 validate 直接 apply，负例捕获后修复，失败日志 `/tmp/seedlands-s3-world-validation-red.log`。
- 抽取原 melee 定义校验注册表，保持原导出；避免新增容量预检触发文件行数门禁。代码地图已更新。

## 冻结验收

本切片 verify:static 通过（278 files passed / 2 skipped；1398 tests passed / 4 skipped，coverage 和全部类型检查通过），日志 `/tmp/seedlands-s3-atomic-static.log`。随后串行 build 通过，日志 `/tmp/seedlands-s3-atomic-build.log`，仅既有 PlayCanvas chunk 体积警告。真实 Browser 组合场景 4/4（15.9s）通过，日志 `/tmp/seedlands-s3-atomic-browser.log`；真实鼠标采集、合成木剑、战斗、拾取和保存重进，加连续攻击连招 2/2（15.2s）通过，日志 `/tmp/seedlands-s3-atomic-journey.log`。Browser 仅已有 favicon 404，任务服务器 4173 退出后无监听。未做性能实验，不声称性能收益。长期架构基线未改，代码地图只记录本切片的新职责。
