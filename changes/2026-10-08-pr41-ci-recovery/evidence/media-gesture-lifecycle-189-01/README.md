# World media 手势生命周期189

实际RED2FAIL/1PASS：已有唱片每次手势再次resolve/decode，loading原解码被新generation替换。修复保留正常audio.resume和许可/代际校验；active同source不重启，当前loading generation由对应finally清理，旧异步结果不能清除新generation。真实pause仍retire旧source，合法恢复创建新source；不缓存decoded音频，不改资源、协议、输入、路线或时限。

新owner反例含同source stop/disconnect/dispose所有权、pending decode、一次许可拒绝后再许可及真实pause重启。原owner全回归与runtime/audio adapter/consumer定向6files46unique PASS，Classic类型、定向lint及17个测试选择合同PASS。第一次类型检查发现既有fixture推断`() => undefined`与正式`() => void`监听器不匹配，仅添加显式类型；保留真实失败。两owner文件加入原headless与Classic类型，无删减选择。

183完整native窗口明确audio.decodeAudioData owner，但该诊断main仍FAIL；CI425同旧head五非Browser检查PASS，完整main两次C4 global限时FAIL，visual/native PASS。它们不是新source产品PASS或受控性能收益。新identified产物原无optional主旅程及最终精确CI尚未运行，不宣称可合入；136/144与完整需求矩阵仍开放。长期docs基线不更新，恢复现有单owner生命周期。原始输出位置、bytes和SHA见validation.json；历史sealed evidence未修改。
