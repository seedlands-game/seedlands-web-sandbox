# 块光 brick A/B 合同

状态：Correctness accepted；A/B 未执行，不作性能结论。

## 对照

- A：单一相机 64³ R8 体积；相机每跨 8 格或覆盖区块 revision 变化时全量重建。
- B：每个实际渲染 chunk 一份 64³ R8 brick（32³ core + 每边 16 格传播 halo）；MeshInstance 覆盖共享材质的 sampler/origin/size；每帧最多重建一个，按相机距离排序；资源销毁即释放 texture。

唯一改变轴为 GPU/Browser 派生光的覆盖与缓存粒度。光学规则、权威 canonical、存档、WebGL2 材质和 worldgen 不变。

## 正确性否决项

- 已加载邻接未知时必须 fail-closed，不把未知当 Air。
- 跨 Chunk 光源/遮挡、移除、baseline 到达、释放与重新加载后与 buildBlockLightVolume core 投影一致。
- 远处仍被渲染的 chunk 不得因超出相机单体积而恒为 0。
- water transition、普通/透明/cutout/emissive mesh 均绑定自己的 brick；非 chunk 预览使用零光 fallback。
- cache 不进入存档、world edit 或 Kernel 权威状态。

## 资源与时延门槛

Medium 质量当前最多约 5×5×2=50 个可见 chunk。R8 brick 每个 64³=262,144 bytes，50 个理论上限 12.5 MiB；门槛为 GPU brick bytes ≤13 MiB、单帧重建 ≤1、无 texture 泄漏。High 7×7×2 理论上限约 24.5 MiB，须记录但不自动判定为所有设备可接受。

性能使用相同 production artifact、seed、quality、相机路径，先 A/A 再交错 A/B。主指标为 frame p95，B 相对 A 恶化不得超过 10%；次指标为加载完成时间、brick rebuild count、allocated bytes、JS heap（可用时）。普通 Vitest、构建耗时和截图不作为性能结论。

## 本轮结果

候选 B 通过功能与资源门槛：Medium 实机为 50 bricks / 12.5 MiB，stream center 迁移后数量与 bytes 不增长；远处放置/移除触发 rebuild，水面临时实例与 Chunk 销毁由定向测试覆盖。没有保留旧 A 的可执行分支，也没有取得同身份 A/A 与交错 A/B，因此不能判断 p95、加载时间或 JS heap 改善/恶化。本次保留 B 的依据是修复远处已渲染 Chunk 恒为 0 的正确性缺陷，而不是性能优越性。
