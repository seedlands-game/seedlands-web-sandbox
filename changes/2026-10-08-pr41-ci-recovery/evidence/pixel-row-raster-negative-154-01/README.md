# 行内rect候选154负结果

精确local0ff82ec7，原visual一次FAIL68347ms。130图标260case，105个16px候选/控制不同，32px全零；paper source A/A456channel异常。冷存档sky未到达，main151未启动，未推送。

152 path与154行内rect的fresh候选260个hash全部相等，控制260个hash也全部相等。这一新事实不能支持几何合并为差异原因；两候选未采用，原实现资源/上下文A/A仍需核验。保留严格零差异断言与全部负样本，不作性能准出。
