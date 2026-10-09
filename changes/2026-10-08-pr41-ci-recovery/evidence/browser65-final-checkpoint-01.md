# Browser65 实际终态

21:33:19UTC取得原PTY79193实际EXIT1。runId pr41-classic-browser65-01，source da2a2ed6c6df162efc1c4ccd8a5a0e456d1c9c42，唯一原完整runner14.3min：main11.7min FAIL、visual2.5min PASS、Modular SKIP。正式failure attachment绑定同source/run，C0–C3 PASS；新mining handoff后的采集已完成，但crop第一条[65.5,-0.5]原45秒route在harness252/equipment-resource-route191/crop-journey91/spec295失败，未到V1/V2/C4/C5/death/save/194。中间attack poll第二击false是被后续成功覆盖的poll sample，不是最终C3错误。

keyboard attachmentCOMPLETE，116可信edges、0 dropped，当前document限定，diagnosticOnly/eligible=false。最后S80/S80/W80的eventStamp间隔86.7/83.1/83.0ms，页面callback间隔311.5/314.5/319.3ms；用户事件生成与主线程回调之间有延迟，不能将API delay当实际Authority消费，也不支持盲改late policy/lead/physics。与前后停稳pose结合只说明端到端输入消费的漂移现象，尚不能把单个渲染/协议路径宣布唯一根因。

最后路段实际停稳：67.77787→66.35874→64.93990→66.35874，目标65.5，z对应-.29039/-.41954/-.55191/-.41954；ACK/tick前进、grounded/noncollision、server velocity0，两个owner位置一致。两次S80/W80的约1.425单位运动跨过原.06/ .08邻域，最终corrected yaw84.59但原45秒耗尽；不能放宽到达/超时或伪造位置。

保存：classic-browser-65-01.log、production-build-65-01.log、browser65-route-input-observations-01.json（只流读0-trace metadata）、browser65-keyboard-timing-01.json与browser65-keyboard-pairs-01.json（只精确resource d055ce49bfb90143d787dc6b0b2e779728a15c3b）、browser65-runtime-failure-01.json（精确resource96af031539af34c358226c38972873bcdae3a8f0）。原trace/error-context/results/report完整保留，canonical receipt FAIL。未读DOM/resources全量、未重跑、未编辑运行中source。

Group65已有validRED、76项回归、static、106文件673项headless、identified build和有界审阅，normal commit/push均EXIT0。精确CI65 run37992680474五项SUCCESS、Chromium仍RUNNING，不取消。PR Draft/open/unmerged，mergeable不等于可合入。最近实际UI21:10剩83%/5d5h重置，约60%停止线保持。统一lighting、正式transport全链/非空V4、正常Modular/194、完整主旅程及组合整帧性能未准出。

Task126只读计划发现Modular已有通用block actions与sentinel-glass place:500/Creative UI，目前缺实际玩家入口证据。下一片可先检查真实Authority已有路径（如原来GREEN不得凑RED），并扩展原唯一90秒smoke的正常输入。当前继续授权工作，本文不是最终交付。

21:54 UTC补充远端精确CI65自然终态：五项SUCCESS、ChromiumFAIL、部署SKIP。两次主旅程在V2铁装备craftArmor的正常inventory gesture等待耗尽整体900秒，spec303；未到C4。Visual1.5minPASS、ModularSKIP。与本地Browser65 crop45秒失败分开，不从V2步骤耗时宣布通过。
