# S3 Action 接受候选

实际 NPC 攻击需要将 Action 接受与 Combat request 放进同一预备边界。新增 host-only `ActionRuntime.prepareStart(input, now, { status? })`，先校验身份/时间/allocator 和输入，完整准备旧动作替换终态、新动作及返回值；放弃或失败不修改旧动作、currentByActor 或 sequence。`validate` 在写前检查 Action frontier 和 actor/target identity，`apply` 仅重验本 owner 的 frontier 并安装预构造状态，不能在 Combat 已提交后调用 clone 或重查 ECS。

普通 `start` 复用 prepare/validate/apply，保留 pending 默认状态与旧动作 replaced 原因；攻击协调可明确预备 running 状态，避免先接受后调用 markRunning 的半步。返回候选 action ID 供 Combat 的 external actionId 使用；真正写入仍须两个 owner 全部 prepare/validate 后再同步 apply。

RED：prepared 接受被放弃时旧动作与 sequence 不变；source allocator 或旧动作变化使候选拒绝；validate 后 actor 身份消失在写前拒绝；apply 不调用 clone，返回对象修改不改变安装状态；新动作开始前 allocator 耗尽保留旧动作。此切片不自行接通外部命令、注册 Combat 或默认 actor 授权。
