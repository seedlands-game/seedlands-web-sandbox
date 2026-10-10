# Browser23 作物局部证据与路线修正 checkpoint33

Browser23 绑定 build22 / 7a675c507cafcd3eb8a7722eb6168e2333b321f4；完整 correctness 1 失败、1 原视觉测试通过、1 Modular 条件跳过。整体 receipt 为 FAIL，reservation 的 measurement 为 NOT_RECORDED；这不是性能 A/B。C0–C3 通过，作物步骤在第二田失败；V1/V2/C4/C5 与作物恢复未运行。

`observations.json` 为三个原始观测附件：第一田 [67,31,2] 正常创造目录/鼠标操作完成种植 0、白色染料施肥 7 和收割；实际 GPU 均为 8 vertices / 12 indices，收割后 Authority 投影与 GPU 批次为空。三张原始截图可见夜间幼苗、成熟与移除；仅证明该视点呈现，不代表全面照明/自然生长/Survival 资源链通过。参数存在和实例 enabled 不等于像素可见。JSON 与图片从原始 trace 精确提取，新图片 SHA-256 记在 diagnosis；原 trace/log/receipt 未覆盖。

第二田支撑 [69,30,2] 的真实瞄准连续 12 次空目标。failure 双端停在 x≈65.329、z≈0.4998、y≈32.6，速度零、onGround true、无碰撞。新 helper 固定 KeyS；原 reachedRouteTarget 按 S 使用 xDelta≤0，因此尚在目标 x=67.5 左侧就被当作进度已到，后续瞄准没有到达原站位。这是新消费者调用方向错误，不能靠放宽 aim、修改物理/方向语义或超时修饰。

仅 crop-journey 初次/恢复路线改用现有 walkEquipmentRoute，复用 fresh heading 方向选择、双端邻域/到达、ground/collision、tick/ACK 和 drift 等待，不修改原 helper/Authority 或瞄准断言。

必要检查 `crop-route-static-33-01.log` exit0：受改动文件 Prettier/ESLint、tsconfig.test 与完整 Classic types；原路线六文件 48/48 通过。没有生产源/新 fixture 变化，复用 checkpoint32 76文件522 headless 和静态门禁覆盖，不重复全量。正常提交后以新 build23 / Browser24 唯一完整入口验证，不能复用旧产物或把局部证据记作 whole PASS。

完整原始输出和恢复诊断在 `/workspace/pr41-recovery-20261008-root-01/browser-23-results`、`browser-23.log`、`browser-23-reservation.json` 与 `browser-23-failure-32-01.json`。源码封锁持续到完整三项 terminal，随后才修正；没有并行 CPU 测试、合并或生产部署。只读 mesh path report59 不构成每 Chunk Wasm 分支或整帧性能证据。

预算最后主对话实际 UI 02:41 UTC 周剩90%，约60%停止线。完整 V2/V3/V4/Modular/194 和组合整帧 A/B 均未闭环。
