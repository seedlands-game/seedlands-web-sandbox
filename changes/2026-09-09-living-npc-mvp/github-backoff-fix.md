# 事件退避恢复修复

冻结父提交：`7c36c43`。GitHub review `5152630270` 的退避事件丢失为有效 P1。

Root 先用 fake clock 和真实 CognitionRuntime 复现：首次模型 transport failure 后，在 1 秒退避中分别收到 dialogue-heard / attacked；推进到退避截止，两例仍只有一次调用，得到 RED。

Runtime 将可重试的退避与缺观察、暂停、等待 Authority 回执等不可立即重试状态分开，返回相对 retryAfterMs。Scheduler 保留原事件集合并在该截止时间重排；新事件合并，不提前轮询，实际开始决策才重置兜底窗口。pause/dispose 继续控制唯一计时器。

GREEN：两个 Runtime 例均在退避截止重新调用，发出的 intent 使用最新 cursor；Scheduler 另验证事件合并、不到期不重试、暂停/恢复、实际派发重置 fallback 和 dispose 后零计时器。认知服务全部10文件41测试通过。无真实模型调用。
