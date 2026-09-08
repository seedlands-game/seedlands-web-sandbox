# 灯笼实例化 A/B（实验记录）

结论：本期不启用。修正后的候选通过孤立场景视觉一致性检查，显著减少重复几何缓冲；但没有减少现有 Chunk 合批的 draw call，也未取得实际游戏整帧收益、跨 Chunk 编辑和资源回收的充分证据。生产保留 Chunk Mesh，物品采用共享几何与材质缓存。

## 口径

实验文件仅位于本 change 的 e2e，不接入生产。baseline 使用 `meshChunk` + `batchMeshData`；候选使用同源单灯笼网格和矩阵 VertexBuffer，两条路径都使用实际体素材质、UV、AO和WebGL2。固定640×360画布、相同光照和相机，0/1/64/256盏分别测试视锥内和转向视锥外；每组8次预热后采集30个RAF间隔，截图在计时之后。

bytes 是实际创建的顶点、索引和实例缓冲容量，不包含纹理、驱动分配、应用堆和总显存。初始化及移除准备只计同步CPU，未包含GPU上传和编辑到可见延迟；RAF间隔不是GPU计时或游戏帧耗时。

## 本机结果

| 数量 | 合批 / 实例化缓冲 bytes | 合批 / 实例化 draw call | 合批 / 实例化 RAF p50 ms |
| ---: | ----------------------: | ----------------------: | -----------------------: |
|    0 |                   0 / 0 |                   0 / 0 |              16.7 / 16.9 |
|    1 |             9360 / 9424 |                   2 / 2 |              16.6 / 16.7 |
|   64 |          599040 / 13456 |                   2 / 2 |              16.7 / 16.7 |
|  256 |         2396160 / 25744 |                   2 / 2 |              16.7 / 16.7 |

视锥外16组合中的对应行均为0 draw call。64盏两张截图SHA-256相同：`aef0e881a8ba794630d38e2fffbd5b393a459a97929d698d7e2bb24364577ea2`；各有4309个非背景像素。原始数据与截图位于[evidence](evidence/lantern-instancing.json)。采集测试通过仅表示实验运行完成，不等于通过性能采用门禁。

早期实验曾有重复引擎模块及VertexBuffer参数错误，错误阶段的空白图与计时已作废。最终版本使用同一Vite模块、当前VertexBuffer构造参数、整体保守AABB，显式销毁矩阵缓冲。当前范围只证明孤立场景的可行性，不将压低的几何bytes推导为整帧提速。

## 复现

```sh
SEEDLANDS_E2E_PORT=4185 pnpm exec playwright test changes/2026-09-08-asset-appearance-center/e2e/lantern-instancing-ab.spec.ts --project=chromium --workers=1 --output=test-results/lantern-instancing
```

后续只有在灯笼密度足以构成实际瓶颈时，再单立实游戏A/B，补齐相同世界、编辑到可见、阴影/边界剔除、资源回收及多次采样。当前不为该候选改世界、Chunk或材质协议。
