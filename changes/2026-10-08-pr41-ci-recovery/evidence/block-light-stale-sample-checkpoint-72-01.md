# Block-light消费者陈旧读 checkpoint72

## 生产路径与反例

基线66467feb：Game传入AdvancedVisualEffects.sampleBlockLight，代理WorldRuntime.sampleBlockLight/15，最终调用ChunkBlockLightCache.sample；GameplayEntityPresenter据此更新普通entity/drop材质。原sample只检查snapshot存在，Authority halo revision变化后仍给旧光值；invalidateAround只标记待重建。只读Task134最初误写WorldEnvironment代理，Root精确源码核对后已更正私有报告和spec。

用真实缓存、正式buildBlockLightVolume及Classic voxel semantics建立三类反例：光源删除后显式失效、revision先于mesh通知变化、区域卸载为unknown。三类旧实现都实际返回13而预期0；同revision读回13的控制成立。新sample复用chunkBlockLightNeedsRefresh校验当前revision，陈旧或缺缓存返回0；重建后按真实新体积恢复读回。没有改变源数据、重建、优先级、sink/GPU纹理或帧预算。

## 验证与边界

独立private日志 `/workspace/pr41-recovery-20261008-root-01`：

- `block-light-stale-red-72-01.log`：3FAIL/10PASS，有效旧光13→预期0反例。
- `block-light-stale-green-72-01.log`：五文件32PASS/EXIT0；原region等价、unknown阻光、替换释放、重建顺序及crop/fluid/preparation相关回归保持。
- `block-light-stale-web-types-72-01.log`：完整Web生产/Svelte/tools类型EXIT0，0errors/0warnings。
- `block-light-stale-classic-types-72-01.log`：Classic正式测试类型EXIT0；相关lint/paths通过。
- 确定性package/tsconfig比较：仅追加原block-light-volume测试到headless和类型集合，所有原字段和测试保留。

本片只闭合entity/drop的CPU采样新鲜度。terrain/crop GPU立即失败暗化尚未完成，sky visibility/统一SurfaceLightingSample未生产接入，全局sun/ambient仍有效。没有新Browser或WebGL2 pixel PASS，不宣称统一光照完成或性能改善；每次采样按既有27个halo chunk revision合同核对，其成本尚无整帧性能证明。

精确66467feb的CI71五项非浏览器SUCCESS，Chromium自然运行；本片将在其终态后才正常推送，不取消现有取证。无需再运行未受影响的Kernel/stdlib全量或重复完整headless；后续精确SHA CI仍须实际通过。长期docs不改，缓存owner及合同保持。

传统0.1PD保守×120%=0.12PD，AI8分钟保守9.6分钟，00:19开始，00:22本地检查闭合约3分钟，保存/提交另记。真实额度最新23:09为82%/5d3h，刷新待答；约60%停止线，型号/credits/API未核实，不换算周百分比。PR仍Draft/不可合入。
