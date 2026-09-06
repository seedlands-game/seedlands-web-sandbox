# 切后台时的模拟与音频暂停

**状态：Delivered。**

## 背景与目标

父合同要求后台不继续模拟或积压声音。现有用例验证GUI暂停、调度器和离开世界，但未直接覆盖真实浏览器标签切换。代码复核发现Shell在visibilitychange同步暂停，WorldAudio只在游戏update处理淡出；如果隐藏标签停止requestAnimationFrame，存在声音继续播放的风险。先验证真实情况，不先认定故障。

## 范围与明确不做

真实Chrome两个标签切换时，世界时间与输入暂停，现有音乐停止并淡出环境，回前台保持暂停，用户继续后恢复。不改乐谱、音色、存档、AI调度或增加后台Worker。

## 决策

如果现有路径失败，使用现有Game.setPaused同步通知WorldAudio，不依赖下一次可见帧；复用现有调度/淡出而非新增AudioContext。用户已授权父Goal自主SDD。

## 行为

Given 已解锁音频、内置Cue播放、锁鼠并按住W，When 激活另一个真实浏览器标签，Then document.hidden为真、暂停覆盖层出现、worldTime保持、Cue停止，短声不继续积压。When 回前台，Then 仍暂停、旧W不驱动移动；点击继续后时间恢复。

## 测试设计

`e2e/background-world-pause.spec.ts` 使用headed Chrome和实际标签激活，不重定义document.hidden、不手工派发visibilitychange。若出现预期RED，记录具体失败断言后修复；若全部通过，只记录验证补充。固定等待仅用于已确认暂停后的不变性采样，不替代事件条件等待。

## 验收与证据

- [x] Playwright-change：真实隐藏、音乐与时间暂停、前台恢复且无旧输入。
- [x] Static：完整静态234 tests passed / 4 skipped，world95.03%、Svelte0/0。
- [x] Build：最终生产构建通过，入口JS2,445.25kB / gzip649.22kB。
- N/A：视觉与听觉审美不在本修复范围；父Midscene和音频试听仍独立记录。

## 任务与当前状态

合同和真实标签用例先行，得到有效RED后修订Game.setPaused，同步调用既有WorldAudio更新/暂停路径；不新增音乐播放器或后台循环。

08:17 得到有效RED：真实document.hidden已为true、暂停覆盖层已显示，但5秒后Cue仍为meadow。确认音频暂停依赖已停止的渲染帧。前面几轮普通Playwright context保持强制focus emulation，两个标签都报告visible，不能计为产品RED；最终使用独立临时Chrome profile、Playwright公开connectOverCDP的noDefaults选项，保留真实标签可见性。浏览器仍由当前Playwright需求用例管理，不新增独立CDP runner，也不使用用户日常profile。

## 交付快照

单独真实后台用例GREEN12.8秒，随后后台+Shell4项+生产音频专项共6项全部通过37.6秒。隐藏时Cue立即停止、声音计数和worldTime不变；回前台保持暂停，继续后时钟恢复而旧W不移动玩家。仅改Game的同步通知和WorldAudio对空生命周期输入的早返回；Game仍符合500有效行边界。

固定48d2dd2的60分钟长测不含此同步后台通知；它证明前台混合游玩及反复会话回收，此项真实隐藏/恢复由上述新生产代码专项证明。两类证据按各自source记录，不重写旧长测来源，也不把旧版本当成后台修复验收。
