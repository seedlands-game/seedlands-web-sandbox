# S3 持久执行来源证据

## 结果

- `WorldPrincipal` 新增可选稳定 `subject`。`WorldResourceAuthorizer` 在构造时拒绝空值、首尾空白、超过 256 字符和重复 subject，并提供只按完全相等 subject 查找的 `principalForSubject`。
- 未配置 subject 的既有即时授权 policy 保持可用，但不能通过持久来源 capture；不会从 principal alias、label、bound actor 或管理员身份推断 subject。
- 新增严格、冻结、可 JSON 序列化的 `DurableExecutionOriginV1`，只保存 subject、pack/module provenance 与 original actor 的 entityId/lifetime，不保存 principal alias、labels、permission、target 或 runtime epoch。schema 只接受 enumerable 自有 data descriptors，并在读取前拒绝 getter/setter。
- capture 使用当前 composition module binding、当前 authorizer 的完整 resource/operation/target 判断、当前 module permission 和当前可解析 actor lifetime reference。缺少 subject、错误 host actor、缺失 actor、撤权或 module permission 缺失均在生成来源前失败。
- rebind 先重新校验 schema，再按当前 composition、当前 exact-subject principal、当前 authorizer、当前 module permission 与当前 entity binding 恢复。相同 lifetime 可绑定新的 runtime epoch；actor 重建后的新 lifetime 拒绝。
- 成功 rebind 返回当前 principal alias 的 registered-operation binding、当前 epoch 的 actor reference 和现有形状的冻结 `ModuleExecutionContext`。调用方无需也不能借保存的 alias 或 permission 绕过当前策略。

## 稳定 API

```ts
type DurableExecutionOriginV1 = Readonly<{
  version: 1;
  principalSubject: string;
  provenance: Readonly<{ packId: string; moduleId: string }>;
  originalActor: Readonly<{ entityId: string; lifetime: number }>;
}>;

WorldResourceAuthorizer.principalForSubject(subject): WorldPrincipal | null;

validateDurableExecutionOrigin(raw): DurableExecutionOriginV1;
captureDurableExecutionOrigin(input: CaptureDurableExecutionOriginInput): DurableExecutionOriginV1;
rebindDurableExecutionOrigin(input: RebindDurableExecutionOriginInput): ReboundExecutionOrigin;
```

capture input 包含 `composition`、`authorizer`、`identity`、现有 `RegisteredOperationBinding` 和当前 `WorldAuthorizationRequest`。rebind input 将 binding 替换为已读取的 origin，仍必须传当前 request；它不会只根据 subject 返回 principal。

## RED 与 GREEN

- 先写 `s3-origin-design.md`，再新增测试。
- RED：首次运行 `execution-origin.test.ts` 时模块不存在，1 个 suite 失败、0 项测试加载。
- 实现后 origin 首批测试 9/9 通过。随后新增 accessor RED：旧校验接受 getter 并读取一次，1/10 失败；改为读取 descriptor 后 GREEN。
- 最终 origin 测试 10/10；与既有 `world-resource-authorization` 合跑为 2 个文件、15 项通过。
- owned ESLint 通过；Prettier 与 `git diff --check` 通过。
- `pnpm --dir packages/game-core typecheck` 当前被并行生命周期切片的五处 `intervalSeconds` 可选性错误阻断，origin/authorization 文件没有 diagnostic。扩展 composition 测试也曾因同一切片暂时删除 `module-lifecycle.ts` 而无法加载；根任务已知并由对应 owner 收口，因此不把完整 composition 或 core 类型检查声明为绿色。

## 根任务集成边界

- Browser 与 Headless policy 必须为同一真实主体显式配置相同 subject；alias 可以不同。未配置 subject 的旧 policy 只支持即时执行，持久动作应拒绝 capture。
- 在注册操作形成可持久的 action/combat/current/buffered step 时调用 capture，并把 origin 写入对应的新版本 snapshot。旧无来源的在途动作按已批准合同确定性取消。
- 恢复时先用 `validateDurableExecutionOrigin` 校验全部来源，再用当前 request 调用 rebind；任一 provenance、subject、actor lifetime、world grant 或 module permission 失败都应在替换 owner/执行 effect 前取消或拒绝候选。
- rebind 返回的 `binding` 可传给现有 registered-operation runtime；根任务仍应由 operationId 解析当前 owner/resource，并保持 registered runtime 自身的授权与 module ownership 检查。
- 根任务需要从 host API 的适当入口导出该 helper，并决定稳定失败到 action/combat cancellation reason 的映射。本切片没有修改 operation contracts、Action/Combat、GameplayRuntime、Browser/Headless 默认 policy 或 facade。
- 未运行完整 static/build、浏览器或性能验收，不声明真实宿主持久动作已经集成。
