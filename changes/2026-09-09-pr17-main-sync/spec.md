# PR17 冻结后同步 main

状态：Delivered（实现与本地验收完成，提交 PR17；最终 CI 与合并由 PR 门禁负责）。类型：Agile，已交付功能的集成与冲突修复；用户明确要求冻结本期、不做后续优化、同步 main 并解决冲突。

## 来源与边界

- 冻结点：PR17 `2214a49c29e2fdfd7c9c2fdd006b858a6ba2dcfd`，已通过本地正确性验收与用户实际试玩。回退分支 `codex/pr17-frozen-20260909` 同步至 origin。
- 目标：main `a3509ef2ccd2e07027242998caa6dd5621e6a151`；共同祖先 `840f4fbf482f987aa5432953ef4ccc3852b74291`。增量是 #21 木剑权威近战、骨骼动画/模型工坊与动作体验场，共 119 个文件。
- 保留 PR17 的单一 Node Authority、受限公开协议、远端可玩闭环和三项试玩缺陷修复；保留 main 的玩法、资产、表现和本地体验场。仅修复合并与集成所需接缝，不新增性能优化，不处理 PR15，不自动合并 PR。
- 用户本轮明确授权同步和解冲突；不扩大公网、多人、管理 RPC 或资产执行权限。main 已有合同不重新设计。

## 行为、RED 与验收

1. 先执行非提交 merge，保存实际文本冲突；类型与定向测试暴露语义冲突，不使用整文件 ours/theirs 覆盖。
2. 远端登录、输入预测、挖放、durable 保存、关页重连、Node 重启和连续跨区块仍通过；保持缓存接管释放及取消迟到页处理。
3. main 的本地木剑体验场和模型工坊仍可进入并运行。体验场的传送/造景属于本地管理能力，不能因合并开放给远端浏览器。
4. 检查新增 combat 字段在 core → Node publication → Web decode → UI 的完整传递；若 merge 后静默丢字段，以确定性 RED 约束修复，并增加受影响真实浏览器观察。
5. 既有旧存档兼容与模型资源生命周期保持；确定性测试、独立 static / Web build / Node build，以及原有和受影响新增浏览器旅程分别报告。
6. 最终 commit + push 至 PR17 当前分支，更新 PR 来源与验收，检查最新 HEAD CI 与冲突状态后交人类审核。

## 任务与记录

- [x] 冻结、备份分支并读取 main feature 与 spec。
- [x] 合并与逐处解决文本/语义冲突。
- [x] 定向 RED/GREEN、受影响浏览器闭环与本地门禁，失败及修正分别记录。
- [x] commit + push、更新 PR17，并将最终 HEAD 的 CI 与人类审核交接至 PR 门禁。

不改历史 Delivered change 的结论；本集成证据归本目录。长期 docs baseline 按最终职责变化决定是否更新。

## 实际 RED

6 处文本冲突：ApplicationShell、Game、两端独立提取的 GameSaveQueue、生成的开始页 HTML、package scripts、Shell 测试。生成 HTML 由合并后的 Svelte 重新生成。

合并后新增的 4 项网络/玩法接缝测试全部 RED：木剑前摇返回无 damage 导致回执投影报 `Invalid damage`；`buffer-full`/`combo-window-closed` 被旧原因白名单拒绝；Web 丢弃 player.combat。修复保留旧同步 damage 回执，新增动作 ID/缓冲白名单字段，不伪造尚未发生的伤害；core 复用 combat 白名单复制供 Web 读取，HUD/实体表现继续只消费权威事实。本地体验场按钮在远端模式隐藏，公开管理命令仍拒绝。

## 集成检查点

- 本地体验场浏览器通过；远端 worker-thread 木剑真实 Pointer Lock 输入显示前摇、5 点首击及 7 点连击，连接不中断，durable 保存后文件恢复保留木剑及目标受损状态（9.7 秒）。
- 新测试造景先因字段名错误失败，修正后发现平台 y=80 超出当前 Web scheduler 的 cy=0..1 范围；将合成场景改为 main 体验场同样的 y=57 后通过。未扩大生产世界高度范围，也未延长加载超时。
- Shell 迟到本地启动不得给新远端造景的回归通过。地图 UI 控制移交给既有 game-runtime-controls，满足两分支合并后的 500 有效行门禁；代码地图同步该职责。
- 新增 `pnpm test:pr17:integration` 并纳入 Chromium CI。完整 static、build、原远端连续旅程与最终 CI 仍待准出，当前记录不代表这些门禁已经通过。

补充集成 RED：本地体验场返回菜单后连接 Node，Shell.experience 未清除，远端仍显示本地造景面板。连接 Node 时清空该状态；单元测试先失败再修复，真实浏览器旅程增加“本地体验场 → 返回菜单 → Node”切换以验证面板隔离。

旧试玩存档连续探索首次停在死亡面板，等待 Pointer Lock 而总用例超时。新增真实 UI 的可选复活前置，随后再记录移动窗口；不通过管理命令治疗、改存档或放宽探索断言。该改动只完善当前复跑的准备流程，不重写原 Delivered 性能/正确性结论。

CI `34260122925` 的真实失败证据：Linux 4 核显示“性能提示”，两个体验场用例未点击“仍然进入”；按已有 startHarnessWorld 的真实 UI 前置补齐。取消分页用例一轮观察到 descriptor→cancel 为 13,255 ms，因为 15 秒生产计时从请求开始，服务端准备耗去其余时间；改为有界记录同 requestId 的 interest-update→cancel，并独立保留 descriptor 后实际扣留时长，不修改生产 timeout，也不降低 14 秒验证线。main 已有连击用例一轮未观察到 7 点伤害、重试通过，保留 CI 原始结果，不以自动重跑掩盖失败。

最终本地准出：20 项浏览器回归、3 项原远端闭环、268 米旧存档往返、35 项 portable Active Node，以及修正 CI 准备后的 3 项完整 Chromium 用例通过。详情见 [交付快照](delivery.md)。PR 首轮失败及测试准备修正已保留；最终 HEAD CI 以 PR17 实时检查为准，不自动合并。
