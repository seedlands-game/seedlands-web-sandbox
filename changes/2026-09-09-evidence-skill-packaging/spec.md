# CI 规范接入与 evidence skill 资源整理

## 目标与范围

用户已同意把本轮 CI 经验接入工作区与现有 skill，并要求 seedlands-evidence 的脚本、参考文档在包内提供入口，允许软链接。Agile：调整项目规则、skill 导航、相对资源链接与包装合同测试；不修改全局配置、产品行为、CI 必需检查或性能门槛。当前基线为762c862，继续交接到PR #27。

## 行为与测试设计

- 修改 CI、测试选择或验收口径时，AGENTS 路由到现有CI测试文档；不复制完整门禁规则。
- Evidence skill 按模式加载包内 references 与 scripts。长期文档和脚本仍在仓库原位置维护，包内采用相对软链接；只加入该工作流所需资源，脚本的本地 helper 也可从包内发现。
- skill 是 Seedlands 仓库的一部分：完整 checkout 可迁移，脚本仍消费本仓库源码、依赖和运行产物。单独复制 skill 时须解引用资源并携带运行依赖，不能把相对软链接说成脱离仓库的独立分发包。链接文档的后续相对引用按其真实源目录解析。
- 就绪条件绑定被测对象、夹具显式定义环境、计数/ack不能独立证明因果。关键回归按风险做定向故障反例，不要求每PR全仓mutation testing，不把具体帧数/tick数写成通用规范。
- 包装合同RED：当前缺少references/scripts；GREEN：入口资源均为仓库内有效相对链接，所需相对脚本依赖可解析；真实调用窗口入口运行一个无负载子进程且保留退出码，并清理独立测试锁。

## 验收与状态

- [x] frontmatter约束、资源链接与相对依赖校验（环境边界见下）。
- [x] 定向包装测试；全量static与build基础检查。
- [ ] 语义化提交并更新PR #27，读取最终SHA CI。

预计小型改动，非大规模change，不创建Goal。长期baseline更新AGENTS、CI文档、context-engineering与既有两项skill；不新增平行skill或审批流程。最终CI结果记录到PR描述，避免仅回填远端状态再次触发全套CI。

## Delivery Snapshot

新增4个references与10个scripts相对软链接，源文档/脚本保持单点维护；skill正文的本地链接均从包内入口导航。引用文档的后续相对链接按真实源目录解析，运行仍依赖完整Seedlands checkout。AGENTS增加CI入口，TEST-01补充因果与定向反例要求，CI和context-engineering长期文档同步。

包装合同先因缺少资源目录/入口出现3项RED，补齐后3/3GREEN；覆盖包内导航、仓库内相对目标、本地脚本依赖、真实窗口入口子进程的非零退出码与锁清理。完整static通过1174条用例，4条既有opt-in性能用例跳过；构建通过，保留既有大chunk提示。本轮不宣称新增性能收益，窗口入口测试仅执行无负载子进程，不是性能采样。

skill-creator原Python校验器在默认与已有bundled Python中均缺少PyYAML，未安装依赖；改用仓库现有ESLint依赖中的js-yaml，核对同一frontmatter字段、命名、长度与TODO约束，结果通过。另做包内导航、14个相对链接、无用户绝对路径/本机包装器检查。原Python校验器未成功执行，不能记为该命令通过。

最终PR exact-SHA CI在推送后读回并写入PR描述。本次只改项目内资源和规则，不修改全局skill、权限或分支保护，不自动合并。
