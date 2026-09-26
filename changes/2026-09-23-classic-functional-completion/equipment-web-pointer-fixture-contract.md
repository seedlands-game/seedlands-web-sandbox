# V2 Web Pointer Fixture 收口合同

阶段：V2-WEB-POINTER-FIXTURE-CLOSE-01 + GIT-22-RESTORE-REGRESSION
基线：`e0594e0260b54274db1e570f632ae4a9b9042152`

## 缺口与 owner

现有 `gameplay-inventory-pointer.test.ts` 在组装 Classic Pack 时把 integrity resources 固定为仅
`playbooks/classic/presentation.json`，而已提交 Pack manifest 还声明
`playbooks/classic/assets/audio/to-far-shores.mp3`。`assembly.ts` 要求 receipt path 与 manifest path 精确一致；
该生产校验正确，不属于修复范围。

本片只修改上述测试 fixture：以 `(pack.manifest.resources ?? []).map(...)` 构造完整 path 列表，沿用测试
dummy digest。它不宣称验证真实资源 hash，也不修改 Pack、production、权限、事务、timeout 或九项行为断言。

首个 blocker 关闭后暴露完整 Classic Media capability 的既有宿主要求：测试必须提供 loaded-cell 端口。root
已授权同一 setup 追加一个只读 `readCell(position)`，返回现有 workbench 空间规则对应的
`{ voxel, fluid: 0 }`；`getVoxel` 读取该对象的 `voxel`，`getLoadedCell` 直接复用同一函数。`fluid: 0` 沿用
现有无流体编码，不引入第二份世界状态，不删除 Media module，也不绕过 production guard。

Media seam 关闭后，完整 Classic Structure capability 继续要求批量编辑端口。root 已授权同一 setup 声明
严格 fail-closed `prepareVoxelEdits`：调用即抛出 `unexpected voxel edit batch`。该端口只证明本 suite 明确
禁止世界编辑；它不返回 noop participant、不伪造 validate/apply，也不替代真实 Structure transaction。任一
pointer 用例意外触发世界批量编辑都会直接失败。

## RED、GREEN 与门禁

- RED 使用已归档窗口 `v2-equipment-web-pointer-regression`：当前已提交闭包上 `1 file / 9 failed`，全部在
  `assembleOverworldPacks` setup 抛出 resource integrity mismatch，未进入 pointer 行为；不重复运行 RED。
- resources hunk 后的中间窗口 `v2-web-pointer-fixture-green` 同样保留：首个 mismatch 消失，九项全部转为
  `Registered Media host loaded-cell port is unavailable.`，仍在 setup 阶段。
- loaded-cell hunk 后的中间窗口 `v2-web-pointer-fixture-green2` 同样保留：Media blocker 消失，九项全部转为
  `Registered Structure host ports are unavailable.`；补齐授权的 strict batch seam 后才进入行为。
- GREEN 必须在 `e0594e02` 专属 detached tree 上运行原 Web 9 项 suite；若 setup 后出现新行为失败，保留
  原始结果并停止扩大生产范围。
- 运行相关 root test types、Classic test types，以及该 fixture 的 ESLint、Prettier check、scoped diff；全部使用
  默认 `benchmark-window` 和 `--maxWorkers=1`。已准出的 restore 4 项在相同源码/依赖身份下不重复运行。

## GIT-22 边界

若 GREEN，Git 只允许包含：fixture 单 hunk、已准出 restore test `bd1fad4b...0ab5`、restore 合同/证据与原
restore evidence 目录、本合同/证据与新 evidence 目录、`tasks.md`/`execution-state.md` 窄状态。不得包含
`spec.md`、combat、public API、`mod-api.ts`、Pack、Lighting、transport、README、package 或 CI。

交付使用当前 HEAD + 精确 staged closure，记录测试树与 staged 源码身份一致。自然 hooks；push 后读回
local/upstream/`ls-remote`、ahead/behind、index 与 PR #41 Draft/Open/base main。不得运行 build、Browser、Cua、
CI、deploy 或 merge。
