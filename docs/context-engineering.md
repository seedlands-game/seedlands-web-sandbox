# 上下文沉淀与 skill 晋升

代码、测试和代码地图是默认上下文。只把难以从源码重建的私域决定、已反复验证的排错顺序和可恢复边界沉淀为 docs；不要复制通用工具教程，也不要为目录层次预造抽象。

当前成熟候选是 **Seedlands Harness、多层证据与性能诊断**：它有固定脚本、浏览器/Harness 关联 run id、证据不能互相替代的边界，以及多次出现的错误样本（例如把历史浏览器结果当作当前证据、把 readback 采集时间当作帧性能）。因此项目内 skill 位于 `.agents/skills/seedlands-evidence/SKILL.md`；它渐进披露并链接现有脚本和本页，不复制通用 Vitest、Playwright 或 Git 教程。

长期目标、普通源码导航和单次方案通常留在 docs 足够，不晋升 skill。每个 change 的 Delivery Snapshot 写明本页或其他 baseline 是否更新及理由。
