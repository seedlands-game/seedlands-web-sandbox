# S3 注册提交的宿主执行来源

延迟 Combat 请求必须从已经授权的 operation 执行上下文生成 durable origin，不能信任调用输入或规则候选中自称的 principal、actor、Pack/module。注册引擎在完成 before/operation/after 与 schema 校验后，向宿主 state port 的 commit 传递只读执行信息：实际 operation ID、resource、冻结 ModuleExecutionContext 和本次授权器。Gameplay 路由原样转交同一信息。

该参数只存在于 host-only RegisteredStatePort，不加入 mod-api 的候选能力，不写入事实或存档；存档继续只保存已有 durable subject/provenance/actor lifetime。现有不需要来源的 owner 可忽略可选参数；后续 Combat owner 必须要求其存在并校验 operation、execution kind、target、actor 与候选一致。不存在时明确拒绝，不能推导管理员或系统来源。

入口选择操作后冻结其 ID。before/after 规则匹配、host envelope 和 committed fact 均使用该 ID；模块闭包修改原调用 request 对象不能跳过原操作的 after 规则，也不能改变 owner 所见操作来源。新增 RED 覆盖闭包将 transfer 请求改写成 close 后仍必须执行 transfer veto，以及成功事实仍保留 transfer。

RED：伪造输入中的身份不能改变 owner 收到的来源；system 提交保持无 originalActorId；Gameplay 路由保留实际 host envelope；规则/权限拒绝前不会向 owner 发送 envelope。此处只提供受信来源接缝，尚不声称攻击或伤害路径已经注册化。

实际验证：2 files 中 3 个 RED 失败已复现；修复后 composition 全部 16 files / 92 tests GREEN，core typecheck、归属 ESLint 与格式检查通过。证据 local-only：`/tmp/seedlands-s3-host-context-red.log`、`/tmp/seedlands-s3-host-context-green.log`、`/tmp/seedlands-s3-host-context-types.log`、`/tmp/seedlands-s3-host-context-lint.log`。全量 static/build 仍需当前冻结代码准出。

## 最终结果的写前预备

真实攻击 ID 由 host allocator 产生，module 不能猜测结果。增加可选 host-only prepareCommit，返回预备结果（最终 value、提交后 revision、validate/apply）或明确 code/reason。注册引擎必须先完成最终 value 的 clone/schema 检查和事实构造，再 validate/apply；复制失败、拒绝或 stale 均不写 owner、不发布事实。apply 后不调用结果 clone。Gameplay manager 只为支持该接口的 owner 转交；其他 owner 保持现有同步 commit 路径。Combat 必须使用预备接口，不能退回旧直接 commit。

RED：返回真实 host Action ID；最终结果复制失败零写入；明确 domain rejection 不伪装成 STATE_CONFLICT；validate 失败零 apply；事实与返回结果使用同一最终值。该预备端口仍只面向已准入的同步 owner，不提供模块任意 I/O 或回滚能力。

独立复核进一步明确：Combat transition 是 operation 的冻结候选结果，不伪装成可持久回读的 state write。after 规则可通过第四个只读参数观察候选结果；host envelope 携带同一 candidateValue 与 effectiveInput。Combat module 读取投影、返回类型严格的 transition、使用零 state writes；host prepareCommit 编译最终状态，并返回真实执行结果。这样 committed fact 不会声称保存了实际并不存在的 intent 状态。
