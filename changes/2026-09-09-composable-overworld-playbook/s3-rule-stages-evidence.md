# S3 规则阶段

依据 T07 与机制闭环设计。此前所有规则均在 operation 后执行，before/after 属性只定义相对规则顺序，无法修改 operation 的有效输入。

RED：新增 `tests/server/composition/rule-stages.test.ts`，三个用例失败，分别为 before 输入变换没有先执行、before 拒绝仍已运行 operation、未知阶段/反向阶段依赖未拒绝。

GREEN：运行该文件与 `registered-operations.test.ts`，2 files / 10 tests passed；core typecheck 通过。

行为：显式 `stage: before` 的规则可返回冻结的替换 input 或拒绝，多个规则按依赖顺序处理有效输入；operation 读取最后的有效输入并生成候选；after 规则只能验证/补充候选或拒绝。旧未显式 stage 的规则保持 after 含义。before 到 after 的依赖可表达，反向依赖拒绝，阶段与稳定顺序进入组合身份。事实只在单次提交后发布，分别保存原始 input 和 effectiveInput。

权限仍在 protected read、write 与每个规则运行前检查；规则不继承其他 module 的声明权限，不修改原始 actor/target。异步、非 JSON、同时带多个结果字段以及 after 改 input 都拒绝。真实 needs/combat 和跨 owner 联合提交由后续集成承接，本文件只记录注册运行时行为。
