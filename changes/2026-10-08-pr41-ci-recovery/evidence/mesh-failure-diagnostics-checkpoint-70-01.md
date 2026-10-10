# 网格失败 trace 字段 checkpoint70

## 范围及行为

在5790da0基础上扩展既有trace mark属性：真实请求的priority/state/visibilityBarrierRevision，accepted worker结果的partsTotal/taskId/chunkRevision，以及PlayCanvas adapter实际resource.meshes长度partsCommitted。属性在记录时复制冻结，导出使用真实traceId/traceName覆盖同名属性。未完成trace仍可导出mark。scheduler原WorkerGeneration/WorkerHaloSample记录原样抽到职责helper；请求优先级、取消、新鲜度、World提交、帧预算、attach/postrender边界保持。

仅诊断，不宣称修复门或V2，也无性能收益结论。CI68下层门authority126/render125与两个part提交只能证明快照尚未发布；缺part总量、priority/barrier，不认定producer缺陷或starvation。

## 可追溯验证

private根目录 `/workspace/pr41-recovery-20261008-root-01`，所有日志独立命名，失败未改写。

- `mesh-diagnostic-red-70-02.log`：真实属性导出RED，1FAIL/6PASS；首次错误Vitest项目为No tests found，不作行为RED。
- `mesh-scheduler-diagnostic-red-70-01.log`：真实scheduler请求/结果字段RED，1FAIL/14PASS。
- `mesh-diagnostic-green-70-02.log`：七份相关测试41PASS。涵盖未完成trace、采样时复制、身份覆盖以及实际scheduler零/非零part结果。
- 新增诊断使原文件触发500行门槛，保持规则，抽出mesh-task-telemetry.ts和独立diagnostics测试；旧scheduler测试恢复原字节。
- `mesh-diagnostic-static-70-02.log`：完整verify:static:ci通过，生产/测试类型、格式、lint、paths、ESLint66项及工程16项通过；sealed evidence5/5原字节验证。
- `mesh-diagnostic-headless-70-01.log`：113文件，703PASS/1FAIL，既有classic-plank-building第一例超过原5秒，保留失败。
- `mesh-diagnostic-plank-isolated-70-01.log`：原两项隔离2PASS，未改源码或门槛。
- `mesh-diagnostic-headless-70-02.log`：最终串行完整复核113文件704PASS/EXIT0，175.35秒；首轮703PASS/1FAIL保持原记录。两轮时长不是性能证据。

CI69绑定旧5790da0：五项非浏览器SUCCESS、ChromiumFAIL、部署SKIP。两次主旅程都耗尽原900秒，停在V2铁资源路线；VisualPASS，Modular互斥SKIP。结果/trace及完整HTML分别240438738/251229792 bytes成功上传，未传入环境核验ZIP内容。此结果不证明未提交70候选的真实浏览器字段输出。

## 局限及交付

真实浏览器失败console中的新增字段尚未验收；现有trace tail仅256事件，早期metadata仍可能被截断。未改trace保留或质量，无whole-frame性能结论。未新增权限、外链、凭据或owner。长期产品docs不更新，仅代码地图记录新helper。

传统0.15PD保守×120%=0.18PD；AI20分钟保守24分钟，23:48–次日00:11完成本地验证约23分钟，含返工及失败复核；远端新SHA仍待验收。实际模型/credits/API不可核实，不换算周额度。真实UI最新23:09剩82%/5d3h，刷新请求待答，约60%停止线不变。PR仍Draft、不可合入。
