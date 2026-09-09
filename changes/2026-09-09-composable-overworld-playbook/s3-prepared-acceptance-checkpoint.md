# S3 攻击接受与 owner 容量检查点

此检查点仍属于 S3 Implementing。Action 接受和 Combat 请求具备 detached prepare/validate/apply 接口，真实注册 Combat、持久来源的宿主绑定以及延迟命中协调尚未接通，不能用本检查点替代阶段准出。

## 行为

- Action 新动作预备时完整构造替换终态、动作 ID、返回对象；放弃、旧动作变化、恢复 frontier 或 allocator 耗尽不改变当前 Action。apply 不再 clone 或查询 ECS。
- Combat 请求支持外部 Action ID 和独立 current/buffered origin；zero-windup 只形成 durable pending hit，预备和安装均不调用 damage。旧直接调用保持既有行为。
- 注册库存批量提交共用 prepared ECS owner，先检查所有候选和玩法修订号容量，再替换库存；失败不发 committed fact。
- 正时间推进在修订号耗尽时先拒绝；一次推进中已有玩法提交时不再为时钟重复增加修订号。多步 advance 不承诺整批回滚。

## 证据

- Action RED 3 个缺失 API 失败；最终 Action 相关 3 files / 14 tests GREEN，含放弃、恢复、替换、clone 和容量边界。
- Combat RED 4 个缺失 API 失败；5 files / 33 tests GREEN，见 [请求证据](s3-prepared-combat-request-evidence.md)。
- 注册库存 RED 实际表现为上限处仍接受转移并生成不安全修订号；修复后 5/5 GREEN。
- 时钟 RED 2 个失败：最后一次 Needs 提交后越界、耗尽时仍推进；相关 Needs 10/10 GREEN。
- 冻结生产代码后 `pnpm verify:static` 通过：288 files passed / 2 skipped，1446 tests passed / 4 skipped；类型检查通过，Svelte 0 errors / 0 warnings。
- 随后 `pnpm build` 通过（既有 PlayCanvas 大 chunk 提示）；再运行 change E2E 与 gameplay-foundation 组合 Browser 回归，6/6 通过，25.9 秒。覆盖实际鼠标采集/合成/战斗/拾取/保存重进、连续连招、创造目录及飞行/模式恢复、Worker ESM 启动和字节篡改拒绝。任务 4173 监听已释放。
- 日志 local-only：`/tmp/seedlands-s3-prepared-static.log`、`/tmp/seedlands-s3-prepared-build.log`、`/tmp/seedlands-s3-prepared-browser.log`。

长期架构责任基线未更新：该切片落实既有原子参与者合同，没有新增模块概念或改变产品方向。没有性能收益声明。
