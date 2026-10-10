# 区块列内邻树缓存：分项候选证据 checkpoint82

状态：性能候选；尚未证明生产启动、浏览器或整帧收益，PR 不可合入。

Control 是 `778811f67328087463c02019de80d943a5c53078` 的三个精确源文件；可执行副本仅适配私有目录的 import 路径，身份见 identity.json。候选仅按列复用原顺序的树锚点；不跨列/区块/世界/版本持有缓存，不改生成版本或世界上界。实际输出是固定 seed2726385568/gen11 的20个canonical出生区块；计时之外验证每个完整区块的SHA256，全部一致。

采样持有 scripts/benchmark-window.mjs 独占窗口，无构建/类型/功能测试竞争，无 CPU profiler 或强制 GC。A/A五对，median2509.450271/2497.083017ms，相对差0.4940446%，原15%线保持。第一轮 AB/BA各五次：median2534.939766/259.832349ms，89.7499596%下降；p95 2556.748170/315.672084ms。首次范围 ESLint 因 voxel.ts 超过500行失败，原日志保留私有路径；简化同一分支、去掉单用局部变量后，最终源码字节第二轮AB/BA各五次：median3177.696859/282.382711ms，91.1136045%下降；p95 3768.373890/397.195942ms。两个采样全部保存，不删除较慢数据。第二轮绑定最终候选三个文件哈希，最终源码功能回归已通过：stdlib167文件1211例、Classic Headless128文件795例。

空间：每列一个惰性闭包，最多49个只读 {dx,dz,height} 锚点，1024列/区块；列循环离开后不可达，没有跨区块缓存。原Uint16区块缓冲65536B不变，无新增Worker transfer/copy，macroCache仍是原区块局部Map。对象和闭包的引擎实际字节未计量；process.memoryUsage仅作为无强制GC的同进程观测，不能分摊为候选分配成本或证明峰值/泄漏。原始before/after可见JSON。

功能：六个worldgen文件40例PASS；新增14例逐体素对照generator2–11、负坐标、高空/地下、编辑次序及重叠树优先级。范围ESLint已PASS；完整类型PASS；最终简化后的stdlib范围类型复核PASS。全stdlib1211例、Classic Headless795例均PASS，路径lint及五个冻结证据字节检查PASS。Headless结束前有一次短stdlib范围类型检查；这些功能时长不充当性能证据。生产artifact、真实矿车重载与完整Classic验收仍待完成。

本证据只证明 warm Node 20-chunk batch 分项。cold Worker、C0、门模型提交延迟、真实GPU整帧、计划共存优化的组合端到端A/B均 NOT_RUN；原CI80 Chromium失败保持。正式采用前必须补齐预注册的产品及组合门禁。长期docs baseline不更新：内部派生局部缓存不改变公共worldgen语义、权威或持久化合同。
