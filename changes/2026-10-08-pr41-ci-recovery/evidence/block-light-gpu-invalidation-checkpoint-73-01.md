# Block-light GPU立即失效 checkpoint73

基线本地78fb17d0、远端66467feb。原cache只把失效brick排入重建，terrain/water/crop借用的R8纹理可能继续给出旧光值。现有同一owner sink新增必需failDark：首次失效先清零原纹理并unlock，再记录待重建；重复通知幂等，成功重建继续原apply。World drain在mesh/crop发布前显式刷新当前Authority halo revision，diagnostics保持只读。原重建优先级、aging、帧预算、纹理引用和生命周期保持。

实际cache反例取得有效RED；同revision控制、不通知的source变化、另brick优先重建、暗化失败重试及实际World drain均保留。实际R8清零函数使用mock texture端口验证262144字节归零及原texture/origin/size引用保持；此项不是真实GPU像素证据。adapter释放cache发生在texture销毁前。

独立private日志位于 `/workspace/pr41-recovery-20261008-root-01`：

- `block-light-gpu-red-73-01.log`：有效2FAIL；`block-light-gpu-red-73-02.log`：有效3FAIL，包含World实际接线缺失。
- `block-light-gpu-green-73-01.log`：六文件38PASS/EXIT0。
- `block-light-gpu-headless-73-01.log`：完整116文件726PASS/EXIT0，222.79秒；类型检查完成后串行执行，无并行重跑。
- `block-light-gpu-web-types-73-01.log`：完整Web/Svelte/production/tools EXIT0，0errors/0warnings；`block-light-gpu-classic-types-73-01.log`：Classic测试类型EXIT0。
- 相关lint及paths EXIT0，git diff --check通过。package/type确定性比较仅追加新测试，其他字段及原测试保持；工程合同及最终文档格式另记录。

每次新失效清零256KiB并unlock，render边界扫描当前halo；这些成本尚未测量，无性能改善声明。sky visibility与统一SurfaceLightingSample未生产接入，全局sun/ambient仍有效；无新的真实WebGL像素、identified build或完整Browser PASS。不要将本片宣称为统一光照或整PR验收。

00:25开始，00:36完整本地验证闭合；传统0.25PD×120%=0.3PD、AI20min×120%=24min，仍在00:49有界checkpoint内。最新主对话真实UI读数00:09UTC剩82%/5d2h，约60%停止线保持；实际模型服务元数据未核实，不换算tokens/credits/API。长期产品docs不改：失效端口仍属于现有cache owner。

CI71在旧精确66467feb自然结束：五项非浏览器SUCCESS，Chromium首轮C0 start card 10秒FAIL、重试V1门体5秒FAIL（期望[0,0]、实测[-1,-1]），VisualPASS、ModularSKIP、部署SKIP。尚不能证明屏障释放缺陷；PR仍不可合入。新源码精确SHA CI和真实玩法尚待验证。
