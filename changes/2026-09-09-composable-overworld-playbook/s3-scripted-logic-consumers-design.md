# S3 脚本 Logic 实际来源接线

状态：实际接线与定向验证完成，独立复核后的完整集成复验中；未准出 S3。

当前 Harness 的 scripted submit 只校验 `world.logic/execute`，之后通过内部自动 Logic 的入口执行，Combat 因而可借用自治 actor 来源，纯移动也缺逐 actor 的 `world.action/execute`。目标是提交脚本始终使用实际 Harness principal；自动 Logic 继续使用宿主内部的 actor authority。

实现边界：submit 将只读 WorldModuleBinding 传给 Authority；逐 actor 在接受有效意图之前校验 world.action 自身/任意作用域，拒绝时不调用 Action、不接纳该项 wish。Combat 的首次请求经既有注册 operation 捕获脚本 subject；保留现有 action 时不创建第二个请求，后续命中仍按已保存 origin 当前重授权。不得将 moduleId/资源名写进用户输入，也不得让脚本指定任意 principal。地面食物注册 owner 单独接线，完成前不声称整个消费层准出。

RED 与验收：真实 Headless scripted mode，允许 world.logic 但无 Combat grant 时模拟状态和 health 不变；允许后 active origin 为脚本 subject，按原时钟只命中一次；world.action self 不能移动/驱动其他 actor；有效观察新鲜度、target lifetime 与旧自动 Logic 路径不回归。测试采用实际 Harness 入口和现有确定性测试，最终按最新完整消费者树执行 static、build、Browser。

这只是已授权权限保持修复，不更改 Pack 身份、存档版本、公开协议或产品路线。不添加权限 fallback；没有性能收益声明。

## 当前实现与定向证据

自定义脚本入口已接入 binding 与逐 actor action 授权；首次攻击保存真实 subject。start-existing-action 在任何 drain 前检查已有 origin 与当前脚本 subject 一致，按当前策略重新绑定并校验 actor/target 读取权限；同来源保留不二次创建、不缓冲连击。来源来自 Combat 持久快照的规范 codec，不能从不包含 origin 的公开 Combat 投影猜测。

有效 RED：`/tmp/seedlands-s3-logic-script-red.log` 三项、`/tmp/seedlands-s3-logic-existing-red.log` 两项。定向 4 文件 23 用例通过；类型检查已通过。纯 wish 测试分别推进拒绝的其他 actor 与允许的自己，避免后一个 batch 覆盖前一个而造成假阳性。默认开发者 Harness 已补齐稳定 subject 和当前宿主 alias/policy 解析；Browser 真实攻击、Headless 换 alias 恢复、恢复撤权及 disabled developer RPC 定向已通过。自定义策略保持原有绑定和 grants，不添加默认授权。该 Browser 证据取得于 Feeding actor execute 复核修复之前，最终完整集成另行复验。

入口文件职责整理：逐 actor Logic 调用判断置于既有 authority-logic-intent-acceptance，Harness frontier 构造置于既有 world-harness-operations，GameplayRuntime 只提供只读绑定函数。保持现有 ESLint 文件规模门禁。
