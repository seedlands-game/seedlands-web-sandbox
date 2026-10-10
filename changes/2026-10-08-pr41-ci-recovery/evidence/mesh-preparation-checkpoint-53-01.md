# checkpoint53：结构提交与异步网格准备

## 身份与边界

源码前驱 `8dceef28a35fa5a1faf8b1aeb36a4232962c8fb8`，base `fba4486e433c145db658f6b1598b70c47f759c8a`。本片只改 World 提交路由与当前 MeshTaskScheduler，保持唯一 Worker-first、Authority 新鲜度、流体首见屏障、原浏览器时限/断言/质量。未引入第二 owner 或生产部署。

CI51 精确 `4a477ad8` 的主旅程首轮跌出支撑，重试新门材质网格轴为 `[-1,0]`，最终 Chromium FAIL；这是诊断动机，不证明下述竞态就是该次浏览器失败根因。CI52 run37939071142 在本地验收时五项 PASS、Chromium 尚运行；未取消。

## 可执行 RED 与修复

- `mesh-preparation-race-red-53-01.log`：真实调度器的 worker-first 异步租约 fixture，普通编辑/流体两例 FAIL，旧 revision1 以 streaming 派发，offscreen 对照 PASS。
- `mesh-preparation-race-red-53-02.log`：仅补 World 已请求 Chunk 路由后，两例仍 FAIL，优先级正确但 revision1 旧准备结果仍被派发。
- 初版不区分路径、无界重新准备破坏了原 main-snapshot 流体反例；`mesh-preparation-race-green-53-01.log` 实际 30 PASS / 1 FAIL，不改写为 GREEN。
- `mesh-preparation-pressure-red-53-01.log`：暂时去掉 worker-first 一次刷新限制的候选，在新压力反例中出现第三次准备，违反两次准备后派发合同，实际 FAIL。该临时变体在 finally 恢复；没有保留额外生产分支。
- `mesh-preparation-client-red-53-01.log`：临时撤掉已请求 Chunk 路由后，真实 BrowserAuthorityClient 将旧准备响应拒绝，却只发出一次 prepare-mesh，不能取得 revision2，实际 FAIL。临时变体已恢复。

World 现在将 queued/preparing/failed 的已请求 Chunk 纳入既有 forceRemesh 路由；完全未请求且未呈现的 Chunk 仍不新增入队。Worker-first 首次准备期间遇到后继时释放旧租约、重新准备一次；再次遇到提交保留后继至旧 Worker 结果结算，避免无限刷新且旧普通结果不呈现。Main-snapshot 在派发时读实时 owner，保留原一次准备行为。旧任务与后继保持各自 trace，原流体首见屏障与优先级保持。

## GREEN 与静态

- `mesh-preparation-final-regression-53-02.log`：12文件60/60 PASS，覆盖新竞态、普通/流体119次连续提交、旧结果零发布、revision121接纳、offscreen、原调度/公平/租约顺序/流体/提交路由/material摘要，以及 BrowserAuthorityClient 与碰撞镜像。
- 最后把新端口回复改为真实 MessageEvent（完整 typed identity、独立 canonical buffer）后，`mesh-preparation-final-event-fixture-53-01.log` 新文件6/6 PASS。实际客户端例检查 revision2 与 voxel3 的正式镜像读回；Worker 回复由测试端口控制，不声称真实 server/browser。
- 前两次完整静态在新 fixture 的不充分类型构造处失败，日志 `mesh-preparation-full-static-53-01.log` / `53-02.log` 保留。修正后 fixture types EXIT0，`mesh-preparation-full-static-53-03.log` 完整 `pnpm verify:static:ci` EXIT0：冻结证据5/5、格式/paths/lint、全部生产/工具/测试类型、Svelte0错误/0警告、规则66/66、选择器14/14。
- 新文件及原关键流体/调度/租约顺序文件纳入既有 Classic headless 与测试类型选择器；不删除测试或放宽门禁。长期 docs baseline 不更新：owner 与职责未改变，仅修复现有异步接缝。

所有日志位于 `/workspace/pr41-recovery-20261008-root-01/` 独立路径，无 sealed evidence 改写。本片未运行本地 build/browser/performance；真实完整浏览器、运输运动与 UI、194项/保存恢复、Modular 正常玩法及组合整帧性能仍未完成。最新实际周额度为13:10 UTC剩余85%，含同期其他任务；60%停止线保持，不能把账户差值归因本 PR。13:46附近开始，传统0.25PD×120%=0.3PD、AI30分钟×120%=36分钟预注册窗口内完成本地修复验收。
