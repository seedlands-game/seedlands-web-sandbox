# Browser17 与精确 SHA CI checkpoint

- 源码：`75f6cbe2a874f1f1c4998198257df3f7bfac39a7`；build16 source digest `d9c8e5136ac87d2a6af466b244c7d7ed52257ad89433be682e4eacb0647bacc4`，artifact digest `932f8d51627e0c9ec1c023adb72c96414a65905ffa9aadc1e33284a816e7ac87`。
- 本地 `pr41-cloud-browser-17-01` 完整 wrapper 已退出：主旅程 FAIL、visual PASS、modular SKIP。主旅程达到原 900000ms 上限；失败附件明确 C0–C3 PASS。V1 阶段结束不单独证明完整需求通过。
- V2 记录 phase=wood，已放置资源并收集原木；随后 workbench 再次打开前超时。木镐、石镐、铁甲、C4/C5 与恢复均未验收。最终 player=[78.49901580810547,32.599998474121094,0.4465872347354889]，worldRevision=160，frameMs≈426.4。
- 原始 closed trace 在 `/workspace/pr41-recovery-20261008-root-01/browser-17-results/`，日志 `browser-17.log`；只读提取 `browser-17-failure-extracted-01.json`、`browser-17-api-costs-01.json`。非可加 API 分类：snapshot 2383 次累计约165.5s；PointerLock DOM 检查503次累计约6.1s。重叠时间不能求和或当性能收益。
- PointerLock guard 的末端错误发生在整体 timeout/teardown 中；现有证据不支持移除 guard。正常 keyboard down/up 已由实际 handler 即时 capture，不能再次以 render 采样缺口为此轮根因。
- GitHub run `37842043185` 已终结：Architecture、Deterministic、Classic headless、Production build、Static verification PASS；Chromium 作业被取消，预览 skipped。日志显示两个主旅程 attempt 进入 V2，第二次尚未终态即作业取消，不能记 PASS。
- 21:03UTC 主对话实际产品 UI 周剩余92%，重置约6天6小时；与初始98%的差额包含同账户其他工作。无法据此精确归因 PR，保守停止线仍为剩余约60%。Cloud 无真实 UI 读数工具，不换算 tokens/credits。

下一组已有有效 RED：真实 Classic Authority 的合法 seed use 返回 `item-no-interaction`；默认20Hz累计一秒后现有 crop tick仍0。先修 crop fractional clock 与精确存档恢复，种植正式入口另行接线；不将 helper 直调等同玩家入口 GREEN。完整 V2/V3/V4/194项与最终精确 SHA 必需 CI仍未完成，PR尚不可合入。

## 时钟修复定向验收

- 唯一 CropRuntime 累计 fractional elapsed；原 random tick、水化和 loaded 规则未变。V1 crop child 新增可选 fractionalSeconds，缺省为0，非法 finite/range 拒绝。
- 有效 RED：`/workspace/pr41-recovery-20261008-fixtures-01/crop-clock-29-red-02.log`（实际 Authority20Hz累计一秒 tick0，原合同应为1）；先前 parity-only 校准两端同为0，不是有效RED。
- GREEN：`crop-clock-29-green-03.log`，两个文件7项通过，含原3项作物runtime测试；10秒 coarse/fine 状态相等、650ms portable persistence 后 fresh Authority restore 再推进350ms到tick1、水化移除与未加载作物不增长、旧child缺fraction及非法fraction拒绝。
- Classic 类型检查：Luna `crop-clock-29-types-01.log` 与根追加正式 selector 后 `crop-clock-types-19-01.log` PASS；新时钟和原runtime测试加入正式 headless/type selectors。两次类型检查源码相同，第二次针对新增selector配置。
- 从同一已关闭 Browser17 的实际生产 trace `call@39`（world.checkpoint export）另存精确75f6cbe2 V4 composition identity：`pre-crop-v4-browser17-01.json`。这是新独立捕获，未改写历史sealed字节；尚未添加crop模块或宣称旧存档完整迁移。
- 本组未运行新构建、全量静态/确定性或浏览器。已通过的75f CI仅覆盖修复前源码；种植注册、表现、收割、骨粉与完整农业验收仍未通过。
