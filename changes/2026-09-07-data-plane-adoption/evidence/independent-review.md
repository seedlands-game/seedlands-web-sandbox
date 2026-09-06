# TypeScript 数据平面独立实现评审

## 评审范围与方法

本次独立检查当前未提交实现相对 `HEAD` 的差异，重点覆盖碰撞基线 buffer 所有权、fluid 独占消费与失败回卷、`EntityStore` 无返回写入、导航窗口校验/open 选择及 mesh 大数组拼接。评审同时核对 `changes/2026-09-07-data-plane-adoption/spec.md` 的“公开 copy contract 不弱化”“alias、取消/失败路径变化阻止采纳”和 RED/GREEN 证据要求。

为避免干扰正在进行的诊断性能窗口，本次只做源码与现有测试的只读审查，没有运行 Vitest、浏览器或性能采样。runner 自身此前已通过定向 Prettier、ESLint 和 Playwright `--list`；全量 test TypeScript 当时被并行新增的 `e2e/copy-cases.ts:101` 未定义 `Guard` 阻塞，不能据此声称全量类型检查通过。

## 结论

初审发现的 P1 所有权 blocker 已在复核期间修复：公共路径恢复旧 copy contract，生产 transfer 边界改用独立的显式 consume API。最终实现未发现 P1 correctness blocker；仍需补齐公共路径的对抗测试，以及下述 fluid 与 `EntityStore` 两处 P2 证据缺口。`EntityStore` 保持了旧实现的部分写入顺序，但该失败语义及其“不 touch version”副作用没有被新测试锁定。

## [已修复 P1，P2 测试待补] 可注入回调与 collision cache 的所有权

初审版本的 `acceptAuthorityCollisionBaseline()` 直接以 `options.result.canonical` 建立 view，在 `await options.accept(canonical)` 后把同一 view 放入 `chunks`。该函数的类型允许外部注入异步回调，回调可以保留并修改 view，也可以 transfer-detach `canonical.buffer` 后返回 `true`，随后缓存会被篡改或 detached。

复核版本已恢复公共 `acceptAuthorityCollisionBaseline()` 的两层隔离，并新增 `consumeTransferredAuthorityCollisionBaseline()`：生产 `BrowserAuthorityClient` 只在 compute Worker transfer 后使用新入口，新入口不把 retained view 作为回调参数；其实际回调只读原 buffer，向 Authority 发送时另造 dispatch-owned copy。公共函数和生产 consume 边界因此分开，当前实际调用安全。

`AuthorityCollisionBaselineClient` 现在默认保留旧 copy contract，只有 `BrowserAuthorityClient` 通过 `consumeTransferredBuffers` 显式声明真实 Worker transfer。测试也已改用 `structuredClone(..., { transfer })` 模拟移交，并断言发送侧 view detached，不再把普通共享 buffer 冒充 transfer。

复核期间已增加公共 `accept` 回调 detach 后 cache 不变的对抗用例。剩余 P2 是默认 baseline request 的源后改写不污染 cache 尚未被单独锁定。显式 consume API 的注释称零参回调“不能” detach retained view，这并非语言级保证，因为调用者仍可闭包捕获 `result`；准确表述应是受信生产调用约定，当前 `BrowserAuthorityClient` 遵守该约定。

## [P2] fluid 独占消费的组合回卷证据不完整

`src/server/fluid/fluid-transaction.ts:260-277` 保留纯 `computeFluidCandidate()`，仅让 `consumeFluidCandidate()` 原地复用 task-owned chunks；`src/client/browser-compute-runtime.ts:89-114` 在 main→fluid Worker 时 transfer 这些 buffers；Authority Worker→main 没有 transfer，因此 Authority 的 lease snapshot 保留独立 structured clone。Worker 在计算前后检查取消，失败通过 `onFluidFailure` 回到 Authority `abortLease()`，从源码链路看，消费中的部分写入不会成为权威回卷来源，设计成立。

新增 `tests/server/data-plane-buffer-ownership.test.ts:83-99` 只直接调用纯函数和 consume 函数，并以 `slice` spy 证明局部没有复制。它没有覆盖真实 transfer 导致 main view detached、消费后取消、TS 计算抛错、Wasm 中途失败后 fallback、Worker crash 和 Authority lease 恢复后重试等组合路径。仓库既有测试分别覆盖 pool cancel 和 Authority `abortLease()`，但没有把本次新独占入口贯通起来。至少应增加一个无需浏览器的组合测试：构造 Authority lease，structured-clone transfer 到 Worker 侧，消费后模拟失败/取消，断言原 Authority lease 数组未变、frontier 被完整恢复且下一次候选与纯参考一致。

## [P2] `EntityStore` 失败时的部分写入语义未被锁定

`src/server/gameplay/entity-store.ts:107-130` 的新 `updateWithoutSnapshot()` 仍按 position→physicsVelocity→health 顺序逐项校验和写入。若 position 合法而后续 velocity 或 health 非法，position 和 bucket 已改变，随后抛错；`GameplayRuntime.updateEntityWithoutSnapshot()` 在 `src/server/gameplay/gameplay-runtime.ts:99-102` 因异常不会执行 `touch(false)`。这与冻结旧 `update()` 的执行顺序一致，所以本次没有观察到行为回归，但它是需要明确保留的失败语义，并带有“状态变化但版本不推进”的既有副作用。

`tests/server/data-plane-entity-store.test.ts` 只覆盖成功更新、返回副本隔离和输入数组后改写，没有复现 compound update 的后段校验失败。若本 change 的目标只是严格等价，应加入冻结 oracle 测试，明确 position/bucket 的部分写入及 version 行为；若期望原子更新，应作为行为修复写入 spec 后先预校验所有字段。当前证据不足以证明 spec 所要求的失败路径不变。

## 导航与 mesh 检查

`terrainWindowsOverlap()` 使用半开整数区间，面/边/角相邻不会误报；hybrid 阈值在累计 pair 数大于累计 cell 数时一次性建立 cell set，切换前累计比较数受当前 cell budget 约束，切换后只按新增 cells 扩展，未发现隐藏的 `O(W²)` 最坏情况越过既有 32,768 cell 上限。open 选择从每轮排序改为稳定线性扫描，仍使用旧 `f → g → key` 比较器；Map 插入顺序使完全相等项保持旧稳定排序的首项语义。

导航测试包含负坐标、相邻/重叠/包含、2,048 个单 cell 窗口、完全相等 tie 和三条完整 `nextStep` 语料，能覆盖主要风险。若要把最坏情况声明升级为量化分配收益，仍需分项 runner 数据；correctness 层面未发现 blocker。

`mesh-batching.ts` 先累计长度、一次分配 TypedArray，再用 `.set()` 和索引循环写入；顶点 offset、颜色 alpha 替换和类别顺序与旧实现一致。`compactMeshData()` 的线性 max-index 扫描保留空 indices 取 0 的行为，并避免大 TypedArray spread 的参数上限。新增大数组测试加上既有 `tests/world/mesh.test.ts` 的多 part/category 断言足以覆盖当前语义风险，未发现 blocker。

## 根负责人补充审查

- 已将默认 baseline request 的源 view 后改写测试补全，缓存须保持原值；EntityStore 增加复合非法更新先前字段/空间桶顺序的回归。
- 原低拷贝 fixture 把世界 y=50 当作 Chunk 局部索引，产生 no-op；已改为局部 y=18，并要求实际写入非空。修订后全量测试通过（836 passed，6 skipped），不沿用原 no-op 作为有效流体计算证据。
- Rust fluid core 对极短 arena 的 saturating_sub 校验及极端 i32 位置需要补强。已先新增 malformed host 用例，等待 Node 资源窗口释放后验证 RED 并修复；修复后需重建正式测量产物。
- 历史 SIMD 产物保持冻结；当前回归测试改验本轮 core 产物，不能以历史包的等价测试证明新包。

## 正式组合后的复核结论

- 原极短arena/极端i32/重叠范围问题已以host RED→修复→7项GREEN收敛，重建后的标量/SIMD共同参与正式分项；不再是待修复blocker。
- fluid真lease→clone→transfer→consume→abort→retry组合测试已补入独立 `tests/server/data-plane-fluid-lease.test.ts`，确认main detached、Authority数组保持、frontier恢复与候选等价；补充前仅有分离用例的缺口已关闭。
- Sol独立只读复审认为W10/W14/W15不采纳有正式数据支持；10配对block统计口径正确。资源扫描不能当下载清单，CPU/heap不等于OS指标；raw bundle hash与生产源码绑定边界已写入结果。
- B角色集合去重检查可能隐藏非General/Fluid重复启用；root对首轮全部30run另做逐role断言，通过且无额外实例。第二批也必须执行相同额外审核。

- 第二批30run已通过同样的逐role额外审核，仅General持有W02–W06及18MiB线性内存；无未授权角色实例。最终静态/coverage 845通过，所有前述测试缺口已关闭。
