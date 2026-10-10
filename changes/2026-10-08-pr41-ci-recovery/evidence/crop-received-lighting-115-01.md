# 植物同源受光接入

沿用原统一光照合同与 11:37 登记的 12:31 UTC 阶段停止/重估点，不新增玩法、性能或权限范围。植物原生产适配器反例在 `crop-received-light-red-115-01.log` 为 1 FAIL/2 PASS：原材质把 block light 写入 emissive；断言要求 self emission 为零和真实 shared lightmap/ready 接线。

候选改为借用相同 terrain R8 block/Sky 和 shared received shader。自己的 emissive 为零，实际 diffuse 通道消费 Sky+block；crop 各 stage 材质消费与 terrain 相同的当前 Pack frame。GPU feature texture 由 crop 原资源 owner 创建/销毁，借用的 R8 不销毁。每个 crop resource 对所借 chunk 注册有界 listener，在发布/失效后刷新 origin/ready；重绑定及销毁解除旧 listener，保持当前纹理所有权。真实 Null-device R8 测试检查 borrowed binding 的发布与失效同步；它不是 GPU 证据。

实际四文件 13 例 PASS，Classic types PASS。保留首次缺少新增 PC 常量的 mock 失败和后续 mock 泛型类型失败，修正测试宿主后通过。原单一 visual 的 GPU probe 将克隆实际加载的第一种 crop stage 材质，白色受控纹理/平面与原各 11 项断言相同；opaque/water 的 22 项保留，新增 crop 为总 33 项。此检验不声称覆盖所有实际 crossed crop 几何、day/night、遮蔽/跨 chunk/质量/存档矩阵或性能。

识别构建与本候选实际 GPU/原完整 visual 待运行，不能把上述单测当验收。Actor/world-item/viewmodel 与主旅程等 ledger 阻塞继续保留。长期文档 baseline 未更改，无 sealed evidence 改写。
