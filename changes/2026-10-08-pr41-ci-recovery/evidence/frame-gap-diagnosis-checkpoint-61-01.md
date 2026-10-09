# Browser61 帧外等待诊断

源 HEAD：8ea883a1ba0c7200252340257fe5c19a5e6e52fb；run ID：pr41-classic-browser61-01。identified build 实际 EXIT0，sourceDigest f27bfb98b18ed39f5a9450b04b5ea10f0b27ab68db08354e55c5d9faa435a97d，artifactDigest 41d4f632d6033029c4a72d3cf461127eebe35b11a920418180f5a147c72b07c1，284文件。生产行为未变。

原唯一完整 runner 实际 EXIT1：主9.9分钟 FAIL、Visual3.3分钟 FAIL、Modular SKIP。C0–C3 PASS；作物共享路线原45秒内未到[65.5,-0.5]，最后双owner停稳于[66.10494,-0.45169]，未执行V1/V2/C4/C5/恢复/全194。Visual beforeClick前/后两块均3，afterRelease均0、worldRevision36→38，原neighbor保持3断言失败。失败和skip保持，不能宣布产品通过。

复用原 SEEDLANDS_CLASSIC_NATIVE_TRACE=1。native metadata COMPLETE、diagnosticOnly=true、eligible=false、无丢失/错误；19:14:29.490Z–19:14:49.493Z，20003.158323ms、149242事件、原始34,609,481字节，仅C3窗口。实际page输入线程pid/tid244304含全部72次GLES2::ReadPixels：中位238.969ms、最大387.694ms，嵌套ImplementationBase::WaitForCmd中位238.778ms。首个ReadPixels232.635ms嵌在LayerTreeHost::DoUpdateLayers233.064ms；第二个214.295ms嵌在214.524ms更新。说明该窗口存在同步合成readback等待，不证明所有帧或宿主根因。

Root按精确pid/tid修正agent将同名renderer线程合并的统计：19,830.532ms观察区间中wall-span union19,809.831ms，包括等待，不能称CPU执行比例。嵌套事件不可累加。没有renderer/质量/trace阈值变更、GPU或host豁免、性能收益；组合whole-frame A/A/A/B仍未通过。

私有原始日志、trace metadata、单线程汇总、路线/鼠标调用选段分别在/workspace/pr41-recovery-20261008-root-01/classic-browser-61-01.log、browser61-classic-native-trace-metadata.json、browser61-readpixels-thread-summary-01.json、browser61-route-samples-01.json、browser61-visual-mouse-calls-01.json。canonical receipt harness/results/pr41-classic-browser61-01/classic.json为FAIL。旧产物独立保留；不复制sealed历史。19:22已接收真实PTY EXIT1，19:30环境恢复只读核验，未重跑。

19:41实际周剩83%（账户包含其他任务），停止线约60%；实际型号元数据未核实。长期docs baseline不改：只诊断现有帧循环，不改变职责或产品合同。
