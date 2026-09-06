# Seedlands 开发约定

## 先读什么

普通代码修改先读本文件、相关源码和当前 spec；移动文件再读[代码地图](docs/code-map.md)和[目录规范](docs/repository-structure.md)；架构或路线决策才读[长期对齐](docs/living-world-alignment.md)；追溯已归档历史才读[归档索引](docs/change-archive.md)。运行命令只以 `package.json` 为准。

方案、spec、评审和交付记录使用简体中文。README、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT、ASSETS、TRADEMARKS 与 `.github/` 社区入口可用英文主文和中文镜像。不得读取、输出或提交 `.env` 或密钥；`node_modules/`、`dist/`、`midscene_run/` 等依赖和运行产物不得提交，但可在验证中读取。

## 不变量与源码归属

- 基础世界由 `seed + generatorVersion` 唯一确定；体素保持紧凑数值；编辑只经 `World.edit()`；渲染是 Chunk Mesh，不是逐体素 Entity。
- `server` 拥有权威世界、规则和存档；`client` 是协议适配、预测和派生镜像；`app` 是浏览器组合、输入、PlayCanvas 与 Svelte；`worker` 只放执行入口和传输适配。
- `world`、`physics`、`runtime` 保持纯逻辑。`world` 不依赖 DOM、Worker、PlayCanvas、`server` 或 `client`；不得把 app 行为反向搬进这些目录。
- 新 app/client 文件先按[目录规范](docs/repository-structure.md)选择既有职责目录。顶层仅保留已审阅的组合入口；ESLint 负责拒绝 client→app 反向依赖和未归属的顶层文件。`src/app/player-view-offsets.ts`、`src/client/performance-telemetry.ts` 仅为两个 Delivered change 的冻结路径兼容入口；新代码不得使用，待对应历史 change 归档后删除。
- 移动入口或职责时更新代码地图；不要预建 `engine`、`plugins`、`shared` 等抽象。

## 轻量交付门禁

任何生产、产品、架构、配置或测试口径变更先在 `changes/YYYY-MM-DD-kebab-name/spec.md` 写可验证行为、测试设计、验收和任务状态，先取得可执行 RED 或记录不可自动化的观察预期。细化的 Agile / Breaking / Exploration、证据分层、change 生命周期、spec 内容和交付快照要求见[开发治理](docs/development-governance.md)。

Breaking / Exploration 的用户 hash 审核只授权其合同中的实现，不自行扩大到发布、其他外部写入、权限变更或不可逆操作。Agile 变更可在已授权范围内自行完成。本用户已长期授权：验收完成后可将功能分支推送至已配置 `origin`，并以目标分支为 base 创建或更新 PR 交给人类审核；用户指定 `local-only`、不发 PR 或其他范围时优先。不得自动合并、绕过分支保护或扩大安全权限。每次 Delivery Snapshot 要说明长期 docs baseline 是否更新及原因；清楚的源码和通用教程不重复抄入上下文。

实施后运行受影响的确定性检查和构建；`pnpm verify:static` 与 `pnpm build` 是分别的基础证据。UI、输入和视觉按当前 spec 选择 Playwright、Midscene 或手工补充，不能互相替代。完成的 change 在明确功能分支创建只含该 change 的语义化本地 commit，并按已授权的 PR 交接规则推进。

默认按任务复杂度选择模型和分工，具体路由见[协作与模型路由](docs/collaboration-routing.md)；这不要求每个任务使用多个 agent。

## 按需上下文

- [目录规范](docs/repository-structure.md)：文件职责、当前布局、静态边界和归档位置。
- [开发治理](docs/development-governance.md)：SDD、E2E 生命周期、证据边界和准出记录。
- [协作与模型路由](docs/collaboration-routing.md)：初始模型选择、分工、独立评审和成本观测。
- [上下文沉淀](docs/context-engineering.md)：哪些决策应写 docs 或晋升为 skill。
- [归档索引](docs/change-archive.md)：显式 ZIP 工具、恢复命令和受保护的历史 change。
