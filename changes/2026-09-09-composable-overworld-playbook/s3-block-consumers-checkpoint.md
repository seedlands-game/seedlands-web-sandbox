# S3 方块实际消费检查点

状态：Implementing。该检查点只覆盖本节的方块和开发者库存路径，S3/S4/S5/S6 均未因此准出。

## 实现与原子边界

默认 Pack 注册 Block actions 与可替换的默认 Rules。真实放置、开始/取消挖掘、时钟推进和完成挖掘经过对应操作；缺 provider 的组合世界不恢复旧隐式路径。Actor/voxel/clock 采用独立资源授权，普通命令保留实际宿主 principal，持续动作保存稳定 subject 和 actor lifetime；未来效果及恢复后的效果重新按当前策略授权。旧无来源挖掘迁移时安全取消，不改已有地形与库存。

每次放置或完成的 World、ECS 库存/挖掘状态、掉落、装备相关 Action 取消和真实回执队列预先构造及校验，最终结果 clone 失败前无效果提交。公开 JSON 使用 worldRevision 引用，宿主交付自己持有的真实只读 WorldCommitResult。开发者 give/remove 保留原权限入口，改用 prepared ECS 与装备变化取消。

原子边界是单个注册 operation。Clock 先按真实 system 权限和规则提交；宿主在 lifecycle 返回后，用持久 actor 来源逐个完成已就绪挖掘。失败 finish 不清 pending、不改 world/inventory/drop；已提交 clock 的 elapsed/revision 保留，快照可保存 ready action，下一次显式 advance（包括 0）重试。多个 actor 按排序分别提交，后者失败不会回滚前者；未交付的前者回执保留至后续 advance。

## 当前证据

- `pnpm verify:static`：302 文件通过 /2 跳过，1561 用例通过 /4 跳过；core、Web、测试与工具类型检查通过，Svelte 0 errors/0 warnings。
- 上项终态后 `pnpm build` 通过；只有既有 PlayCanvas 大包提示。
- 随后真实 Browser 回归 6/6 通过（30.3 秒）：采集制作木剑、攻击/连击、拾取保存、创造目录/飞行/安全模式切换、世界入口模式、真实 ESM 身份恢复与篡改拒绝。favicon 404 未影响断言；完成后 4173 已释放。
- 脚本与恢复定向覆盖实际 subject、缺 Block grant 无副作用、换 alias 同 subject 恢复只完成一次、当前撤权不产生掉落。
- 故障覆盖 after 拒绝、暂停/否决 clock、最终 clone 失败、最终位置变化、allocator 耗尽、ready 保存/恢复重试、多 actor 后者失败与先前回执保留。
- 单 operation 时钟边界已获独立只读架构复核；整个方块实际消费者的冻结源码独立审阅仍进行中。

本机复现日志（local-only）：`/tmp/seedlands-s3-block-{static,build,browser}.log`。保留 `-static-lint-failure.log`、`-static-needs-fixture-failure.log` 与 `-clock-policy-red.log`：最后一项否决了提前消费未来 elapsed 的候选，该生产分支已删除。Needs 夹具补齐新增 clock 显式 grant，专属 schedule 夹具继续只装配被测时钟。

长期 docs baseline 更新 `docs/code-map.md`，记录方块 owner、命令接缝及既有 domain adapters 的装配归属；产品方向和整体架构基线未改。没有性能收益声明、npm 发布或自动合并。

## 接续

S3 继续审查/接通 scripted Logic batch 的真实来源，以及地面食物消费的注册 owner；默认规则与全部实际消费者仍需最终核对。S4 工位/炉体/储物、耐久和木石铁成长实际接线，S5 替代组合/跨宿主，S6 完整输入视听旅程/演示/PR 与 CI 均未完成。

## 独立复核修复（2fcce5c 后续）

只读复核发现并修复三项 P1：V4 恢复的挖掘状态使用较宽 ECS codec、浮点累计导致石块晚一帧完成、Rules 配置的嵌套掉落对象保留调用方别名。另修复 P2：零值或六位量化后为零的硬度在创建 Rules 时即拒绝。恢复先在 detached 校验中使用 canonical Block codec，再安装 live owner；计时使用与 lifecycle 相同的纳秒整数累计；规则创建时严格校验纯数据形状并复制/冻结 drop 和 instance。内容注册表相关语义（物品是否注册、工具倍率派生后的操作输入）仍在当前内容被实际消费时验证。

新增恢复负例核对完整快照、entity reference 和世界不变；48×0.05 与 3×0.8 的纯计算阈值一致，真实 GameplayRuntime 在第 48 帧完成石块且与 bulk advance(2.4) 一致；改变调用方 drop 不改变 finish 候选。有效 RED 保留在 `/tmp/seedlands-s3-block-{restore-codec,time-valid,zero-hardness}-red.log`，配置形状/别名 RED 在 `-time-definition-red.log`（其中早期计时草稿超单 clock 上限，已由 time-valid RED 替代）。定向 3 文件 35 用例通过；最终全量准出结果待后续记录。

独立 reviewer 最终给出 bounded pass：当前 Block 范围无剩余 P0/P1/P2；未运行测试，仅静态回读。最终源码 SHA256：snapshot `8fb5d140378254b254e658e620b71b71c1b4266191b7a38bde0a25b8e1eda94a`，actions `16847428b817f6b463731041b90e7f73c50350238ceb1eb30f4a1fb2b3f0f37c`，rules `3648431dd28be1361646335588fe4a7ebff820ed56a6d7d6ef92d1041cba3627`。回执 outbox 为进程内交付，不承诺崩溃后持久投递；后续 Logic/ground food/S4–S6 不在此结论范围。

本次最终静态 `pnpm verify:static` 通过（303 文件通过/2 跳过，1583 用例通过/4 跳过，全部类型检查通过，Svelte 0/0），随后 build 通过。Browser 分两次串行：组合玩法 4/4（16.4 秒），gameplay-foundation 2/2；同批额外运行旧 melee-action-showcase 用例时，受击反馈和重新布置成功，但第一次连续攻击未观察到「hit + 5 点伤害」，第 84 行等待失败。这项保持未解决，纳入 S6 演示复验，不能称全 Browser 套件通过。日志 `/tmp/seedlands-s3-block-review-final-{static,build,browser,browser-gameplay}.log`；任务服务器已关闭，4173 无监听。原有 6 项目标 Browser 用例本树均通过；额外失败未被重跑掩盖。
