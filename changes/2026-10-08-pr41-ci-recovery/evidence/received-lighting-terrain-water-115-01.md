# 地形与水的实际受光接入

旧材质在精确本地诊断源 `20e5a6fa` 的真实 WebGL2 反例：Sky-only `[58,79,97]` 而固定线性期望 `[64,64,64]`；block-only、combined、多项 unknown 为 `[255,255,255]`；self-only `[122,143,161]` 混入环境受光。两类材质的 18 项原像素与失败日志均保留于 Cloud 私有 `received-lighting-red-html-115-01`、`received-lighting-red-115-01.log`。正常构建产物身份已校验；测试在像素断言 6.6 秒失败，未宣称原完整 visual 通过。

候选修复启用实际 PlayCanvas lightmap 通道，禁用该材质重复的解析受光；只在线性空间合成 sky radiance × visibility + block irradiance。方块光从 self-emission 移出，原材质自己的自发光单独保留；水的默认假发光移除，平面反射转入独立 received 合成，不改反射质量开关。绑定、发布及失效均写真实 ready 门控，未知时 received 为零，自己的发光不受此门控影响。

顶面边界由同一完整列证明导出额外 32×32 上边界行，上传 Sky R8 纹理为 32×33×32；原 32³ 体积与 CPU 开放度语义保留。上边界也包含当前依赖/原子发布，不猜天空、不截断世界列。新 CPU 缓存统计包含额外 1024 字节并克隆其所有权；World 注册上限随真实数据体积收紧为 992，最大缓存仍低于原 32 MiB。新增真实像素断言覆盖顶面明亮与上方阻挡两种情况，原 18 项断言保留（共 22 项），原 visual gallery/输入/时限继续执行。

Pack profile 的严格校验、Classic/Modular 差异配置与旧 schema 明确缺省，由单个 Luna 有界子任务实现，实际定向 18 例及其 lint/format PASS；Root 完成 renderer frame 和固定 scene exposure/tone mapper 接入，相关 Web 7 文件 53 例、范围 lint PASS。生产类型首次误接 CameraComponent.exposure，保留失败后按安装版本改为 Scene.exposure；后续 Web/Svelte 0 error/0 warning 与 Classic types PASS。独立资源数据和 profile 都不等于性能收益或整个产品验收。

2026-10-10 12:12 UTC，本组精确源 `068ff4d3613b3b617b79bb3ec540083cb9d9cf2f` 的识别构建 PASS：sourceDigest `24a3c457985b0c6a93f362a199ff54bb036403eb505e19f85b5152208c45cecd`、artifactDigest `61cc9d89584bcd38abe821e1d4768e8dea581ded049c73654e2066678705444a`、289 文件。原唯一入口 visual 运行 `pr41-received-lighting-green-115-01` PASS（2.1 分钟），NON_MAIN、无冲突；它包含原 gallery、连续帧及真实单击破坏，未改变原时限。两类材质各 11 项实际 GPU 像素全部符合：sky-only/block-only/self-only/self-unknown/upper-boundary-clear `[64,64,64,255]`，combined `[128,128,128,255]`，unknown、invalidated 与 upper-boundary-blocked `[0,0,0,255]`。Cloud 私有 raw `received-lighting-green-pixels-115-01.json`、receipt `received-lighting-green-receipt-115-01.json`、完整 HTML 和日志保留。SwiftShader WebGL2 是功能 readback，不代表物理显卡或性能证据。Pack composed self-emission 的超限反例另有 1 FAIL/9 PASS RED，入口拒绝 color×intensity 超过共同 sample 上限 16 后，两文件 19 例 GREEN。

此前远端 `ade3d57f` 的 CI run `38048715633` 已结束：五个静态/确定性/构建任务、原 visual（1.3 分钟）与原 native cart（35.5 秒）通过；主旅程初次及 retry 均触及原 900 秒上限，停在 V2 装备资源路线，Modular 未运行、preview 跳过。末尾诊断为 `[94.5,-0.5]` 返回路线、physicsTick 59661、onGround false；这不是已证实原因，也不能把两个局部 PASS 当主旅程准出。

Crop、actor、world-item、viewmodel 的共同 SurfaceLightingSample 与原 day/night、室内、跨 chunk、质量、存档矩阵尚未完成；主旅程/194内容/装备死亡/其余交通/最终精确 SHA CI 仍按交付 ledger 保留。此记录不能把局部静态/构建通过替代原需求准出；没有改写 sealed evidence。长期文档 baseline 未更改，本组是原统一受光合同实现。
