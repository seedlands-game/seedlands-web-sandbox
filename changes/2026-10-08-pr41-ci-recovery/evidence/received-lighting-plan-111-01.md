# 原统一受光验收计划与暂停恢复

本工作于 2026-10-10 10:39 UTC 登记，10:57 因 CI410 新浏览器回归暂停；只读像素探针接线及其类型检查已保存在 stash，未构建、未取得 GPU RED、未改材质/profile、未推送。接线于 11:37 在精确源 ade3d57f 上恢复：该源实际新增任务量及取消反例 5 FAIL/7 PASS，经修复四个相关 Web 文件 38 PASS，原 visual 与 native 局部验收 PASS，已正常推送且 CI411 正在运行。保留此前所有失败，局部通过不关闭主旅程或整个 PR。

原需求的生产缺口：地形/水把方块光加入 dEmission，实体及掉落实例只增加 emissiveIntensity，手持物未使用共同受光样本；Pack-owned lighting profile 尚缺失。实际权威 source、当前 per-chunk R8 Sky 资源已运行，但没有真实 shader 受光像素验收。

先用恢复的只读 renderer GPU probe 在原 visual 唯一用例内取得真正 WebGL2 RED，再接入线性空间唯一 received light（visible sky radiance + block irradiance），把 surface self-emission 独立保留。探针克隆真实生产材质，调用真实 R8 写入/失效 helper，读取有限的 18 个像素结果；无 Authority 写入、输入替代或新浏览器 runner。已知、未知、失效及独立自发光均有固定数值断言；原 gallery、夜间、单击、恢复及全部原时限继续执行。探针的无 tone/gamma 线性读回只验证数学，不改变生产相机配置。

本组目标沿用原统一光照合同：严格 Pack metadata profile、Classic 与 Modular 明确不同配置、环境关键帧与固定曝光/tone mapper；同一 frame 给 terrain/water/crop 与 actor/world-item/viewmodel 的共同 SurfaceLightingSample。只复用现有资源/环境/材质 owner，不新增 RGB flood/WebGPU、世界高度上限、全局调色假光或权限。Root 负责生产接入/实际验收；唯一 Luna 子任务只改互斥的 profile 校验、loader、配置与相关测试。全仓源身份构建和浏览器期间两方均冻结写入，恢复原检出，不新建 worktree。

合入证据仍需实际 GPU RED→GREEN、语义/材质回归、相关类型/静态检查、精确产物、原浏览器与像素矩阵。合成像素不能代替原 day/night、室内遮蔽、跨 chunk、质量及存档矩阵，未完成行明确保留。主旅程、194 内容、装备死亡与其他运输仍为单独的原需求阻塞，不能因本组 shader 通过而宣布整个 PR 可合入。

11:37 恢复后 Root AI 预算 45 分钟 +20%=54 分钟，12:31 UTC 停止并据新证据重估；11:42 前必须得到有效 GPU 反例或明确阻塞，12:00 为 terrain/water 与 profile 接入的中间决策。传统估算沿用 1PD+20%=1.2PD。最新实际 UI 11:00 UTC 剩余76%，已请求刷新；共享账户下降含其他任务，约60%或用户停止要求立即保存停止，不将时间/token/credits/API估算换算成周额度。实际模型及费率无元数据则未核实。

不触发生产 main、merge 或 auto-merge；只在新正确修复/验证后正常 feature publish。长期文档 baseline 未更改，原静态合同不能被像素诊断或构建替代。
