# Browser22 路线快照候选撤回

源码 `4db1a0bdd86e8a8e2422b829d422fc560896bd78`，source digest `2b398860becde378fd624b8af681485600afadba385b5c6fdeaf4306ab58af43`，artifact `096d567ba795426cc7cac83673ebdbe4d01917ee1b41317c81a08c2c029b2a1c`，window/run `pr41-cloud-browser-22`。

窗口 FAIL / NOT_RECORDED，实际Playwright 1 FAIL / 2 SKIP。C0启动step 13.7s；随后主旅程在测量资格处失败，未完成C1–C5。既有benchmark合同跳过视觉诊断，modular属于另一Pack artifact；均不是PASS。

20次观测含4warmup、8对A/A。实际输入事件数全部0，固定姿态/world/profile身份唯一；同任务完整与路线投影包括tick/ack精确等价。新输入事件合同未触发身份/clock/cleanup失败，但A/A左右median为53.69309150000481与62.12084249999316ms，偏差15.696155249297933%超过预注册15%线。未进入A/B，没有性能收益结论，不因接近门槛而放宽或重采。

API、消费者切换、工程probe/测量及对应测试与selector全部恢复到远端cd5的生产与canonical源码；限定路径 `git diff --quiet cd5 -- apps/web package.json tsconfig.classic-tests.json docs/code-map.md` 已通过。旧候选33合同测试及58定向回归PASS只能证明测试范围，不使本次资格通过。候选29未推送。

`measurement.json` 是真实TestInfo attachment的格式规范化副本，`summary.json` 是窄字段摘要；原始attachment SHA256为 `4e387e37339b4d174d307c968e3e119e877ec67ded87ee6e413c4828e2d024cd`。原始文件、trace、HTML和窗口回执位于 `/workspace/pr41-recovery-20261008-root-01/browser-22-*`，未改写。规范化副本不声称字节等同，原elapsed仅用于本轮A/A否决，logical JSON bytes不是CDP/network bytes。

当前同条件read-boundary实验停止。后续工作继续原PR正式V2/V3/V4/194及实际玩法、CI、组合frame验证；本记录不表示任务完成或可合入。未合并、未自动合并、未推main、未生产部署或新增权限。
