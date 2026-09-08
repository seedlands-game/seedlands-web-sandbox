# 动画实现 RED

命令：`pnpm vitest run tests/client/glb-model.test.ts tests/app/glb-model-resource.test.ts`

2026-09-08 实现前观察：

- 缺少 `apps/web/public/models/voxel-settler-animated.glb`；
- 缺少 `app/gameplay/model-animation.ts`；
- 校验器在检查 skin 有效性前拒绝所有动画；
- 旧外观项目没有归一化的 `animationBindings`。

结果：4 项失败，7 项通过。
