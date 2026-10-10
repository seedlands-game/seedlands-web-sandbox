# 植物同源受光接入

沿用原统一光照合同与 11:37 登记的 12:31 UTC 阶段停止/重估点，不新增玩法、性能或权限范围。植物原生产适配器反例在 `crop-received-light-red-115-01.log` 为 1 FAIL/2 PASS：原材质把 block light 写入 emissive；断言要求 self emission 为零和真实 shared lightmap/ready 接线。

候选改为借用相同 terrain R8 block/Sky 和 shared received shader。自己的 emissive 为零，实际 diffuse 通道消费 Sky+block；crop 各 stage 材质消费与 terrain 相同的当前 Pack frame。GPU feature texture 由 crop 原资源 owner 创建/销毁，借用的 R8 不销毁。每个 crop resource 对所借 chunk 注册有界 listener，在发布/失效后刷新 origin/ready；重绑定及销毁解除旧 listener，保持当前纹理所有权。真实 Null-device R8 测试检查 borrowed binding 的发布与失效同步；它不是 GPU 证据。

实际四文件 13 例 PASS，Classic types PASS。保留首次缺少新增 PC 常量的 mock 失败和后续 mock 泛型类型失败，修正测试宿主后通过。原单一 visual 的 GPU probe 将克隆实际加载的第一种 crop stage 材质，白色受控纹理/平面与原各 11 项断言相同；opaque/water 的 22 项保留，新增 crop 为总 33 项。此检验不声称覆盖所有实际 crossed crop 几何、day/night、遮蔽/跨 chunk/质量/存档矩阵或性能。

2026-10-10 12:23 UTC，本候选精确源 `fb6ab514ae83fa24e8c0109cae71456c8523e606` identified build PASS（289 文件）：sourceDigest `7ea4368582fe56141966012d26a5e620cff46006a734b83bdea798ed423825d6`，artifactDigest `a81397f7dc84f4c2e0d038ba8bdf8c4ad79c7e9b2e4202a62609f7b3db92298f`。原唯一 visual 用例 `pr41-crop-received-light-green-115-02` PASS（1.7 分钟），NON_MAIN、无冲突；33 项 GPU 像素全部符合既定 64/128/0 和 self-unknown=64 断言。实际 crop 11 项与 terrain/water 22 项均保留在私有 `crop-received-light-green-pixels-115-02.json`、receipt `crop-received-light-green-receipt-115-02.json`、HTML 和日志。原 gallery、连续帧与真实单击破坏仍通过，时限未变。SwiftShader 不代表物理显卡或性能。

12:23 阶段重估：11:37 计划的地形/水/profile/植物单元已完成实际验证，用时 46 分钟、未到 54 分钟停止点；实体/掉落物/手持物与完整场景矩阵尚未完成，不以本组替代。下一有界阶段另登记 sample 接口、材质 owner/释放、固定相机配置、反例与实际像素目标，再继续。Actor/world-item/viewmodel 与主旅程等 ledger 阻塞保留。本候选未推送，不为重启而取消正在运行的 CI412。长期文档 baseline 未更改，无 sealed evidence 改写。
