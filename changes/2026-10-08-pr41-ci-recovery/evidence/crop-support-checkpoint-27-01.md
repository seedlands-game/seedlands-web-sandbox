# 作物支撑事务清理 checkpoint27

本片基于 `c3ac4d81996b3693f2f86fa60d045d7ce2a3d31c`。00:03UTC 产品实际周剩余91%，约60%停止线不变；本环境无法自行读取产品用量UI。00:23UTC 云端命令仍可用，未发生本工作树丢失。

## 改动与边界

Classic 显式启用通用 Block 的作物支撑观测。注册 begin/place/finish 及规则读取同一 `crop-cell`，土壤/流体变换读取实际编辑目标；host 对完整观察集和当前候选严格复核。CropRuntime 的已准备支撑参与者使用编辑前捕获的作物值，包含空值；支撑消失时清理，仍属于 Pack 配置的支持土壤时保留。所有参与者先验证，再一并应用，复用原 World、物品、drop、receipt 和 gameplay revision owner；不增加作物 drop、第二状态表或提交后清理。

`ModDefinitionCatalog.state` 仅提供已注册状态元数据。显式启用但未注册同资源作物单元的组合拒绝准入；缺省 Block 不要求作物模块。Block capability 新定义身份对应完整的 Browser20 前驱捕获，保留既有捕获，仅允许此精确 V4 身份；定义和 Pack摘要篡改继续拒绝。捕获在 `pre-crop-support-v4-browser20-01.json`，生产常量与捕获独立于新组合装配。兼容测试的子状态是定向fixture，不能称为旧生产存档的完整导出。

## 验证与保留失败

原始日志位于 `/workspace/pr41-recovery-20261008-root-01/`；Luna 定向资料位于 `/workspace/pr41-recovery-20261008-fixtures-01/`，均使用独立输出路径。

- 有效Authority RED：`crop-support-red-42-01.log`，4/4失败，正式Survival/Creative挖掘留下作物、恢复后留下作物、准备期间从空值出现作物仍被错误接受。
- 首轮实现 `crop-support-green-27-01.log` 4失败：既有规则还按旧候选校验；修正注册规则读取后 `crop-support-green-27-02.log` 4/4通过。
- V4 `crop-support-v4-red-27-01.log` 是fixture错误：复制 frozen token 被拒绝，不是兼容性RED。改用测试持久化适配后 `crop-support-v4-red-27-02.log` 有效失败于旧完整身份不兼容；新增精确前驱后，被完整headless覆盖，并含两个篡改拒绝例。
- 通用参与者/准入 `crop-support-43-focused-04.log`：2文件12测试通过；01–03的配置、审批fixture、ID范围错误保留，详见外部43报告。
- 非Classic注册土壤变换 `crop-support-spine-27-04.log`：2/2通过，支持→支持保留、支持→不支持清除，单次world/gameplay revision和工具耗损断言通过。01–03是fixture重复能力提供者、缺少正式input字段及耐久实例字段，均保留，不能计为产品RED。
- `crop-support-headless-27-01.log`：68文件480测试通过；随后新增的通用土壤变换两例单独通过，并加入正式headless/type selector。未将分开的运行描述成同一次69文件运行。
- `crop-support-stdlib-27-01.log`：152文件1102测试通过；stdlib类型27-01/02、Classic类型27-01/02及scoped lint27-01通过。完整静态CI检查27-01在类型门禁失败：两个手工构造的behavior定义catalog fixture缺少新增的`state`方法，后续ESLint-plugin/CI-selection未运行。修复这两个fixture明确返回无状态定义；未改变生产门禁。
- `crop-support-catalog-fixture-27-01.log`：相关fixture两例通过。`crop-support-static-27-02.log` 终态exit0，冻结证据5/5原字节、完整格式/目录/lint/types通过，Svelte零错误零警告，ESLint-plugin 11文件66测试及CI-selection 14例通过。此后仅回填本记录，按单文件格式校验，不重复无关全量行为测试。

## 浏览器与远端

Browser20 整次终态为主旅程FAIL、visual PASS、modular SKIP，总16.9分钟。C3建造已通过；V2取得石镐并进入铁资源阶段，但900000ms总期限耗尽。原输入、收敛、目标、扣物与时限断言保持，未新增重试或放宽验收。原始 `browser-20.log/results/html` 及诊断27-01保留。

远端精确c3 CI `37860738690` 的构建、headless、确定性、架构和Static verification通过；Chromium首次主旅程约15.2分钟失败后重试，最终job CANCELLED，预览SKIPPED。日志 `ci-c3ac-chromium-27-01.log` 保留。不能把取消或阶段耗时行计作产品PASS。

Browser20路线逐脉冲诊断见外部 `browser20-route-settle-44-report.md`：偶发双端位置差异存在，但当前predicate拒绝单端到达；观察空档使确切收敛时间未知，不支持修改预测或放宽等待。API嵌套耗时不相加为关键路径。

## 未完成与长期文档

本片证明事务与兼容边界，不证明可见作物、上邻格覆盖语义、完整V2/V3/V4/194项验收、整帧组合A/B或最终SHA可合入。长期责任仍是可选stdlib模块/Classic组合根/Web派生呈现，未移动入口或改变责任，故本片不改长期架构基线。继续当前托管任务；禁止合并、自动合并及生产部署。
