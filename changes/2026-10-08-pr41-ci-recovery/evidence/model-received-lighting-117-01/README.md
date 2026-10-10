# 模型共同受光：局部交付

2026-10-10 13:29 UTC，仍不可合入。生产源与产物身份、原始私有文件哈希和分层结果见 [validation.json](validation.json)。未推送本组时，远端仍cdd6e1fb，CI413现已自然结束FAIL；本组随后正常feature push，不用新push取消前驱证据。

角色、world-item、手臂和工具使用同World Sky可用性/visibility与当前revision的block volume，以及同Pack环境frame生成SurfaceLightingSample。unknown received为零，自己的emissive颜色/intensity/map独立保留，不再把block光加入自身发光。每mesh-instance使用自有clone；资源目录与UI纹理继续借用。clone、damage clone和每owner的feature lightmap在原移除/换工具/dispose边界释放；异步GLB拒绝/prepare失败释放lease。手持独立相机跟随主相机已有gamma/tone mapper，固定Scene曝光政策不改。

旧生产消费者有效反例2FAIL→本组9files73PASS，补充lease清理改动后两文件13PASS；Null PC材质/Engine窄夹具不冒充真实GPU或实际GLB加载。Web/Svelte0errors0warnings和production/tools types、Classic测试types、范围ESLint500行、格式/路径、原CI/冻结保护17项与正常commit hooks通过。新identified build289文件通过。

原visual在精确d237b27e PASS1.4分钟，原240秒、真实四chunk Sky20秒、画廊closeup/日夜/连续帧/单击破坏保持。原33像素入口保留；画廊内从真实生产消费者拥有的材质取clone，六类各11case合计66个不同固定像素全部符合64/128/0、tolerance3，自发光unknown仍64。模型白色控制面使用明确independent intensity1/无emissiveMap，生产材质字段不改。首6230运行的world-item/viewmodel self=0是probe继承非发光源intensity0的设置失败，完整FAIL/raw保留，不称有效生产GPU RED，不降断言。

Root实际查看本次day-gallery、有八类源的夜间、sources-removed原始PNG：手臂/手持物随世界源变暗，源移除后不独自亮，UI图标保持可见。六类控制面readback不代表每种模型/材质所有几何、室内/跨chunk/高中低/存档完整矩阵，SwiftShader不证明物理GPU或性能。原native31.2秒PASS，真实右键、键盘、Shift右键、同存档恢复/PointerLock和当前呈现断言保持；仅直线普通矿车纵向。

完整主旅程、194内容/装备死亡/save、其他交通、照明完整矩阵和非驻留持久Sky源、Modular与最终精确head CI/review/冲突仍未准出。CI412主旅程FAIL不被上述NON_MAIN代替；CI413两轮在V2返回后C4 outbound失败，visual/native PASS，Modular/preview SKIP，见[终态](../ci413-terminal-117-01.json)。code-map更新实际owner路径，长期架构/安全政策与sealed evidence不改。本片12:59开始，13:29检查点约30分钟，未用墙钟换算额度；13:27真实产品UI周剩75%，约60%停止线保持，账号共享降幅不等于PR精确用量。请求Luna/medium只承担两个文件、三单测，实际模型元数据不可核实。
