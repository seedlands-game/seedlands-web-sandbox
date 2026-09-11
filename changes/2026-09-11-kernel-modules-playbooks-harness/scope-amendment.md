# 用户追加的目录合同

2026-09-11，用户在批准原 spec 后明确要求：“eslint plugin也单独抽package 单独维护测试 不要放在全局测试里；根目录里理论不应该存在测试 集成、全流程回归测试也应该放在web app里”。本指令直接修订原批准稿的路径安排，沿用行为/兼容/验收合同，不重新索取相同动作授权。

- 新增 `packages/eslint-plugin`（`@seedlands/eslint-plugin`），持有规则、flat config 工厂及本包测试。根 `eslint.config.mjs` 只导入并传入仓库位置。
- Kernel/stdlib/Playbook/Agent 的单元合同归各包/app 的 `tests/`；ESLint 正反例归插件包。
- 跨模块/宿主/工程集成与架构门禁归 `apps/web/tests/integration/`。唯一生产浏览器线路改为 `apps/web/tests/e2e/classic-runtime.spec.ts`。场景数据仍归 `playbooks/classic/scenarios/`。
- 根 `tests/` 最终删除，历史 E2E 保留证据去向并退出默认发现；默认编排与影响图只指向上述 owner 测试。
- 原 spec 的 tests/e2e、tests/integration、tests/architecture、tests/fixtures/packs 路径相应替换为 web app tests；ESLint plugin tests 从全局回归分组中独立选择与维护。
- 迁移过程中使用映射脚本调整相对 import 与基于 import.meta.url 的相对资源引用；不修改被测断言语义来通过。
