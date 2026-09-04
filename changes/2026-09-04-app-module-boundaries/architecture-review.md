# App 模块拆分架构复核

## 路由证据

- 请求路由：`sol_escalation_reviewer`，`gpt-5.6-sol` / `xhigh` / `fork_turns=none`。
- Receipt：`sol-intent-receipt.json`，已通过 schema v9 策略的 `validate-sol-intent-receipt`。
- 权限边界：只读、无外部写入、不读取凭据；父级保留 spec 修改、实施与最终验收。
- Telemetry：运行时未暴露 effective model、effective effort、usage 或计费遥测，因此只把以上字段作为 requested route 证据。

## 结论与纳入项

reviewer 要求补强后再提交用户 hash，未直接批准原稿。以下要求已纳入 `spec.md`：

1. 明确 `入口 → Game → World 协调器 → scheduler / GPU repository` 的单向依赖、唯一状态所有者与禁止横向互相导入。
2. 固定 dispose 顺序、epoch/回调失效及 pending/attached GPU 资源 exactly-once 销毁语义。
3. 增加陈旧/取消 Worker 回包、`postrender` 竞争、同页二次 start 与旧 world 无后续提交的 change 级确定性验收。
4. ESLint 治理测试锁定 severity、精确 options、calculated config 和 `noInlineConfig`，不允许局部 disable 绕过。
5. CSS 拆分保留原 cascade 顺序，并用 Midscene 覆盖启动页、HUD 与 Macro 地图，不再标记 N/A。

复核完成后，用户把 ESLint 门禁从 app 专属 300 行调整为全仓库 JavaScript/TypeScript 500 行。原 receipt 保留为当时 requested route 的历史证据；更新后的全局范围、阈值与 calculated-config 覆盖由用户直接裁决并写入新 spec hash，不重复派发 reviewer。

这些修改属于实施前合同补强；最终是否批准实施仍由用户基于新的 `spec.md` SHA-256 决定。
