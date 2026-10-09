# checkpoint66 正常 Modular 方块实际验收

最终源码 `894e81529b23d8b1dab32fdeaf1a1c4aab00a7d8`，三份正常 feature commit 已于2026-10-09 22:17:57UTC推送；未force、merge、automerge或生产部署。前两次8ecc7b00/88de9337的Browser FAIL完整保留，分别诊断实际Pack缺Inventory close producer及地板64超浏览器1–63操作范围。新版sample1.1地板32不修改浏览器bounds、grants、physics、renderer、质量或时限；旧1.0迁移未验。

最终显式Modular生产build实际EXIT0：builtAt22:11:52.887Z，288files，sourceDigest `ed7999baf5a69cbf348de323f0c23d325772c9edfa7d09178454102855d51cf1`，artifactDigest `65e95582b3ac89353dc5c761f2271b48834b4baa19b000e3274a0f215ed9a948`。

唯一runner `pr41-modular-browser66-03` 实际EXIT0、canonical receipt PASS：Modular17.6秒PASS，完整Classic主旅程与visual按该Pack选择SKIP，总21.2秒。正常UI close/模式切换/自有物品选择、PointerLock/真实瞄准、左挖右放、Authority voxel与flushSave/reload持久化断言全部执行。实际HTML内附件worldRevisions `[0,1,2]`，persistedVoxel0、persistedPlacedVoxel500，挖掘命中 `[0,32,0]`，放置命中 `[0,32,1]`。成功trace按原retain-on-failure策略不保留ZIP，不能伪称存在；原HTML实际附件已提取到独立private observation文件。

候选完整static实际EXIT0及后续受影响delta lint/types/格式/15CI合同EXIT0。最终精确HEAD原完整headless110文件686项PASS/EXIT0，180.09秒。四项测试选择仅追加，且进入types，不删除原用例。可信Headless Pack摘要不等同生产字节验证；实际build/Browser补足本片字节与输入证据。

精确CI66 run37998445813截至22:31五项SUCCESS、Chromium仍执行；PR Draft/open/unmerged/mergeable，review/threads22:12为空。CI65自然终态ChromiumFAIL/部署SKIP，两次V2主900秒失败与visual PASS均保留，544MiB artifact超过512MiB下载上限，不能由日志猜测trace根因。

本片只关闭正常Modular方块纵向体验；完整Classic C0–C5/V1–V4/death/save/194、统一lighting、正式route motion/运输UI/旧非空迁移、Modular其它玩法链及组合整帧A/A/A/B仍未准出。22:09产品真实剩83%/5天4小时重置，由主对话提供，约60%停止线不变。实际模型服务元数据未知，无token/credits比例换算。长期docs无更新：此为既有样例组合及宿主支持范围修复。
