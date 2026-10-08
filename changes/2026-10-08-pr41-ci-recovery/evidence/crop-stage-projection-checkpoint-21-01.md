# 作物阶段公开投影 checkpoint

正式种植组已正常推送 `bdb856198a359b8bfdc81c2e1ee92ef554425401`。run37849776083 的 architecture、deterministic、Classic headless、build 与 static 已PASS；Chromium尚在运行，不能宣布可合入。

阶段投影有效RED：`crop-view-red-21-01.log` 为15PASS/1FAIL，实际 Authority.view 缺 cropStages。候选只从唯一 CropRuntime.list 派生 position/stage，保留可选协议字段兼容原 fixture，生产始终输出数组，不新增 state owner、存档版本或冻结 network reference 字段。

`crop-view-green-21-01.log` 与补充实际 Worker 链的 `crop-view-worker-21-01.log` 均16/16PASS：正式 seed action 后stage0、Authority正常推进后成长、旧view独立且不泄漏subSeconds，实际 AuthorityTickPublisher→structuredClone→BrowserAuthorityClient 收到新阶段。Classic完整types、stdlib生产types与三路径ESLint通过，格式与diff check通过。本子片未重跑完整1090项/完整headless；上组精确bdb已由远端必需作业通过。尚无新build/browser/mesh或正式收割验收。

Browser17诊断补证：独立20秒read-only CDP capture使用仍在4274的精确75f生产产物（artifactDigest932f8d51627e0c9ec1c023adb72c96414a65905ffa9aadc1e33284a816e7ac87），不声称其为当前bdb验收。输出 `diagnostic-gpu-profile-21-01-{trace,state}.json`、cpuprofile与reservation在独立root证据目录。frame p50≈255.3ms；world-worker TimerFire aggregate thread CPU约12.37s，CrGpuMain Scheduler aggregate wall约19.985s但thread CPU很低。嵌套span不可相加，driver等待不可当GPU执行耗时；仍需确认worker具体phase，不能据此盲目改性能路径。该诊断reservation是NOT_RECORDED，非正式性能结论。

原 Browser17 primary failure 为900000ms旅程超时，PointerLock异常在取消/页面teardown时出现，不能倒置为先发根因。历史FAIL/原deadline保留。本Cloud未增加网络权限，未改sealed evidence。22:00UTC主对话产品UI确认周剩余92%，约6天5小时后重置；初始98%之差包含同期其他用量，不归因本PR，原停止线仍约60%。

长期docs baseline仅补实际公开投影职责，不改变产品目标或验收口径。
