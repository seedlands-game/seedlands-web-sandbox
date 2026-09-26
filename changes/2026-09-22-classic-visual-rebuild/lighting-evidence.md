# Classic 方块光照证据

状态：S1/S2 源码、确定性和静态接线完成；真实 Browser 暗室画面、移除和遮挡操作仍由主线程在 S3 读回，本文件不将其写作已验收。

## 已实现的合同

- `voxel-light.ts` 定义八类 Classic 发光方块：火把、辉光石、熔岩、火焰、南瓜灯、燃烧熔炉、发光红石矿、灯笼；采用按光级下降 bucket 的有界 flood，容量按体素格数而非点光源数决定。
- 完整固体方块阻挡传播；玻璃、树叶、水、冰和小模型方块按其传播成本处理。`undefined`（Browser collision baseline 未到）按封闭未知区块处理，不能把默认 Air 当作跨区块漏光。
- WebGL2 使用 64³ `sampler3D` R8 光体积；相机所在的中间 32³ 是有传播 halo 保证的有效域，四周各有 16 格 halo。体积外的 block-light sample 为 0，不能据此声称整个已渲染世界都具有完整方块光；8 格锚定使相机在当前网格内距内域边界至少 8 格。
- stdlib 的 0–15 光级上传 R8 UNORM 前统一编码为 `level × 17`，因此 shader 的 0–1 采样值精确等于 `level / 15`；不再把最大光级错误压缩为 `15 / 255`。
- 体积只在相机跨 8 格锚点或其覆盖区块 revision/可读性变化时重建；远处 world revision（例如 fluid）不会无谓重建。无编辑的区块 baseline 到达/释放也会失效缓存。空 R8 体积在材质创建时已初始化，避免预览期间采样未定义纹理。
- 所有 chunk 材质都绑定初始 R8 光体积并在更新时接收同一 origin；非透明材质和水体反射 emission 都采样该体积。水体的用户 emission 和平面反射保持原有叠加，再附加块光；发光方块仍有各自的表面 emission metadata。火焰和三种轨道已一致使用 cutout+alpha，火焰也保留 emission；分类仅由 TypeScript mesher/compute 消费，Rust/Wasm 未持有该枚举，无生成物重建需求。
- 发光表面不再使用统一橙色常量覆盖像素：shader 以原贴图 `dAlbedo` 为主色，并按每个发光面在线性色彩空间的亮度阈值仅增强热像素。燃烧炉和发光红石矿额外要求红色优势，灰石基底不进入自发光；火把木柄和南瓜灯暗部同样保留。熔岩、火焰和灯芯仍整体发光。此修复尚待 Browser 截图读回，不以静态检查替代视觉验收。
- PlayCanvas 局部 omni 点光已停用：其低/中画质无阴影、且有限阴影槽不能作为可靠的方块遮挡路径。地形与动态实体都只消费遮挡后的 R8 块光体积，八类源不受 2/4/6 槽位限制。`GameplayEntityPresenter` 通过 `sampleBlockLight` 为每个呈现实例独立材质加入环境发光，避免修改共享 GLB 材质。
- `VisualEffectsSnapshot` 暴露 `blockLightReady`、`blockLightSourceRevision`（当前 `worldRevision`）与 `blockLightRebuildCount`，供 Browser 验收等待新体积而不依赖固定 sleep。

## 自动证据

| 命令                                                                                                                                                                                                                                                                                                                                          | 结果      | 覆盖                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm exec vitest run --config packages/stdlib/vitest.config.ts packages/stdlib/tests/world/voxel-light.test.ts packages/stdlib/tests/world/mesh.test.ts --maxWorkers=1`                                                                                                                                                                      | 35 passed | 八类源、衰减、封闭/开口遮挡、移除、跨 chunk、多源无点光预算上限、未知区块 fail-closed，以及 gameplay sampler 一致性      |
| `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/app/block-light-volume.test.ts apps/web/tests/unit/app/advanced-lighting.test.ts apps/web/tests/unit/app/gameplay-entity-presenter.test.ts apps/web/tests/unit/app/voxel-render-pipeline.test.ts apps/web/tests/unit/client/texture-pack.test.ts --maxWorkers=1` | 23 passed | 64³ volume、正负方向 halo、8 格锚点、revision 新鲜度、演员材质接线、所有发光面 emission 元数据、分类与既有局部光预算合同 |
| `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/integration/runtime/world/wasm-mesh-equivalence.test.ts --maxWorkers=1`                                                                                                                                                                                               | 6 passed  | 现有 scalar Wasm 与 TypeScript mesher 的 mesh 数据/分类等价；分类由 TypeScript 端决定，未重建无关 Rust 产物              |
| `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/app/block-light-volume.test.ts apps/web/tests/unit/app/advanced-lighting.test.ts apps/web/tests/unit/app/voxel-render-pipeline.test.ts apps/web/tests/unit/client/texture-pack.test.ts --maxWorkers=1`                                                           | 14 passed | 光体积、材质分类与既有反射相关路径的定向回归；水体块光的真实 shader 画面仍待 Browser                                     |
| `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/tests/unit/app/voxel-emission-profile.test.ts apps/web/tests/unit/app/block-light-volume.test.ts apps/web/tests/unit/app/advanced-lighting.test.ts apps/web/tests/unit/app/voxel-render-pipeline.test.ts apps/web/tests/unit/client/texture-pack.test.ts --maxWorkers=1`    | 18 passed | R8 UNORM CPU→GPU 光级编码、发光面热像素与红色优势掩码、光体积、材质分类与反射相关路径的定向回归                          |
| `pnpm --filter @seedlands/web typecheck`                                                                                                                                                                                                                                                                                                      | passed    | Svelte/TypeScript，0 errors / 0 warnings                                                                                 |
| `pnpm --filter @seedlands/web build`                                                                                                                                                                                                                                                                                                          | passed    | packs lock、Rust artifact fingerprint、SSG、类型和 Vite 生产构建                                                         |
| `pnpm --filter @seedlands/stdlib typecheck`；受影响文件 `eslint`                                                                                                                                                                                                                                                                              | passed    | stdlib 类型与受影响文件静态检查                                                                                          |

上述 test/typecheck/lint 均通过默认 `/tmp/seedlands-benchmark-reservation` 串行执行；预约证明机器资源协调，不是性能收益证据。

## 尚未验证

- 没有启动 Dev Server 或 Browser，未取得八类光源暗室在白天/夜间、遮挡、移除、跨 chunk 的真实帧和读回。
- 64³ 局部体积只承诺其内层有效域和 halo；相机远处方块、未加载区块、体积外 actor 不获得本轮 block-light sampler 的保证。
- 当前工作没有性能 A/B，因此不对体积刷新、R8 上传或逐演员材质的帧率/资源成本作收益主张。
