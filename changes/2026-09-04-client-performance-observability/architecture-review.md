# 架构复核记录

**复核方式：** 固定 Sol/xhigh，只读；运行时有效模型遥测未暴露。

**结论：** 初稿不通过，修订后等待用户对新 spec hash 审核。

## 发现与修订

- `src/app/main.ts` 的单个 timer 回调同步执行 `getChunk → meshChunk → receive`，随后连续创建、上传和挂载全部 Mesh；这是用户掉帧报告的可信候选因果链，但必须通过 profile 证实。
- `src/world/mesh.ts` 的出面和 AO 只采样一格外邻域，因此一格 halo 在空间上足够；修订要求它来自有界的派生 snapshot，禁止用 `getVoxel()` 隐式物化相邻 Chunk。
- 游戏 update 对 `dt` 做了 50 ms 限制；修订要求 frame profiler 用独立、未截断的真实时间边界。
- 异步结果在编辑、取消或中心迁移后可能过期；修订加入 taskId、scenario epoch、归属/halo revision 签名与 stale discard 计数。
- 单纯“每帧一个 Chunk”不是时间预算，单 Chunk 的多次 `mesh.update()` 仍可长帧；修订加入 Chunk 数、mesh part 数和实际时间三重预算，并以首次 `postrender` 定义 visible。
- 初稿 E2E 只等待任意 trace；修订要求 scenario epoch 隔离，并覆盖 A/B、incident、halo、stale result 和服务端权威。

## 未验证项

预置 RED 测试未执行：sandbox 中依赖重建被内部包源 DNS `ENOTFOUND` 阻断。没有将此环境失败归类为产品测试失败。
