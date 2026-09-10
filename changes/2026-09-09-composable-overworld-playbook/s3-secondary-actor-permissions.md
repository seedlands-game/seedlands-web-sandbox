# S3 跨资源操作的角色执行授权

状态：Implementing，承接已批准 D4 / T06；不新增权限种类。

Feeding 独立复核确认：主目标资源 execute 不代表可以更改仅读的 actor 状态。同样审查 Inventory pickup（物品实体 → 角色库存）及 Block place/begin/finish（体素 → 角色库存/采集状态）。要求原始 actor 的资源 execute 在调用者与当前 operation module 两层均获授权；只读观察不能隐含授予该能力。

即时操作在准备任何 owner 前检查，最终 validate 再检查。持久 Block origin 恢复和延迟完成同时重检 actor execute；撤权后不能用保留的 voxel execute 完成掉落/库存/地形变更。已有 actor identity/lifetime、主资源、观察权限和规则检查全部保留。

RED / GREEN 覆盖：调用者显式拒绝 actor execute、module 缺 actor execute 时，拾取、放置、开始采集都拒绝且完整快照/引用不变；有两个资源权限时成功。采集中撤销 actor execute 后，推进不产生完成采集的效果。数据读取、模块资源目录与普通 player/default autonomy 已有 grants 不扩权。

相同资源的不同目标也须分别授权：Combat 对受击目标 execute 不能隐含授予攻击角色的 Action/Combat execute。增加 scope=self 拒绝原始 actor、保留 any 对目标执行的反例，以及延迟命中前仅撤销角色执行权的反例；prepare、最终 validate、持久 origin 重绑定与脚本保留当前 Action 均检查此权限。

## 本轮证据

实际 RED：Inventory / Block 的五项反例已执行失败；Combat 增补两项反例执行失败，撤权后仍造成 5 点伤害。修复后权限反例 7 项、相关 Combat / Script / Logic 共 43 项通过。完整静态检查 309 文件通过 / 2 跳过，1632 测试通过 / 4 跳过，所有 TypeScript 通过，Svelte 0 error / 0 warning；随后构建单独通过。

local-only 日志：`/tmp/seedlands-s3-secondary-actor-executable-red.log`、`/tmp/seedlands-s3-combat-actor-red.log`、`/tmp/seedlands-s3-combat-actor-green.log`、`/tmp/seedlands-s3-secondary-final-static.log`、`/tmp/seedlands-s3-secondary-final-build.log`。早期拼错 operation ID 的失败不能作为 Block RED，此处只引用准确入口的实际反例。

已完成的 prior Logic / Feeding 独立复核不自动覆盖本补丁；此处是 root 的实际反例、实现和运行验证。完整阶段独立审核与 S4–S6 仍待推进。

最终冻结树 Browser 12/12（40.2s）：本 change 6 项、gameplay-foundation 5 项、木剑体验场 1 项；包括真实采集合成、连招、动画/IndexedDB、模式飞行、跨宿主脚本来源和 Pack 篡改拒绝。日志 `/tmp/seedlands-s3-secondary-final-browser.log`，测试结束后 4173 已无监听。没有新依赖安装，项目 npmjs 配置实读不变。
