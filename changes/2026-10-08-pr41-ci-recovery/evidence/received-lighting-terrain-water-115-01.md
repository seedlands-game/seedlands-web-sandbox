# 地形与水的实际受光接入

旧材质在精确本地诊断源 `20e5a6fa` 的真实 WebGL2 反例：Sky-only `[58,79,97]` 而固定线性期望 `[64,64,64]`；block-only、combined、多项 unknown 为 `[255,255,255]`；self-only `[122,143,161]` 混入环境受光。两类材质的 18 项原像素与失败日志均保留于 Cloud 私有 `received-lighting-red-html-115-01`、`received-lighting-red-115-01.log`。正常构建产物身份已校验；测试在像素断言 6.6 秒失败，未宣称原完整 visual 通过。

候选修复启用实际 PlayCanvas lightmap 通道，禁用该材质重复的解析受光；只在线性空间合成 sky radiance × visibility + block irradiance。方块光从 self-emission 移出，原材质自己的自发光单独保留；水的默认假发光移除，平面反射转入独立 received 合成，不改反射质量开关。绑定、发布及失效均写真实 ready 门控，未知时 received 为零，自己的发光不受此门控影响。

顶面边界由同一完整列证明导出额外 32×32 上边界行，上传 Sky R8 纹理为 32×33×32；原 32³ 体积与 CPU 开放度语义保留。上边界也包含当前依赖/原子发布，不猜天空、不截断世界列。新 CPU 缓存统计包含额外 1024 字节并克隆其所有权；World 注册上限随真实数据体积收紧为 992，最大缓存仍低于原 32 MiB。新增真实像素断言覆盖顶面明亮与上方阻挡两种情况，原 18 项断言保留（共 22 项），原 visual gallery/输入/时限继续执行。

Pack profile 的严格校验、Classic/Modular 差异配置与旧 schema 明确缺省，由单个 Luna 有界子任务实现，实际定向 18 例及其 lint/format PASS；Root 完成 renderer frame 和固定 scene exposure/tone mapper 接入，相关 Web 7 文件 53 例、范围 lint PASS。生产类型首次误接 CameraComponent.exposure，保留失败后按安装版本改为 Scene.exposure；后续 Web/Svelte 0 error/0 warning 与 Classic types PASS。独立资源数据和 profile 都不等于性能收益或整个产品验收。

本组 GPU GREEN 及原 visual 结果待实际验证另记。Crop、actor、world-item、viewmodel 的共同 SurfaceLightingSample 与原 day/night、室内、跨 chunk、质量、存档矩阵尚未完成；主旅程/194内容/装备死亡/其余交通/最终精确 SHA CI 仍按交付 ledger 保留。此记录不能把局部静态/构建通过替代原需求准出；没有改写 sealed evidence。长期文档 baseline 未更改，本组是原统一受光合同实现。
