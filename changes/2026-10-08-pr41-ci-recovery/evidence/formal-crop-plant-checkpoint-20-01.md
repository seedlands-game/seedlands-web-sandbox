# 正式种植提交 checkpoint

## 改动与边界

时钟修复已独立提交 `4a16d367f8f25a9d5b9e5f8d7be111370e8ef7d1`。本组增加 Pack 配置的正式 seed use：stdlib 不持有 Classic 土壤、水、种子或产出标识；Classic 内容在自己的 crop-policy.ts 声明。唯一 CropRuntime child 仍拥有位置、阶段与时钟，registered crop component 只投影单位置；既有 Block prepared host 重推导候选并统一验证 Actor、voxel、crop 和 inventory 参与者后提交。

Survival 扣一粒种子并记录 stage0，Creative 只改变作物；土壤/上方 voxel 不变，因此不制造 WorldCommit。range、LOS、四 selection 与独立 above loaded 门禁保留。保存仍经过真实 portable checkpoint/persistence；精确75f V4 predecessor 来自 Browser17生产导出，仅V4接受，module/operation/digest篡改与V1–3拒绝。

本组尚不包含植物可见阶段、正式收割/骨粉、满包收割、完整农业浏览器体验，也不代表 V2/V3/V4/194项全部完成。

## RED 与失败保留

- `crop-authority-red-28-01.log`：实际 Authority、合法 seed/地形/current selection 下旧代码返回 item-no-interaction，未到stage0/扣种成功断言。
- `crop-plant-focused-20-01.log`：注册期间过早读取尚未就绪的内容；no tests，不能计需求RED。
- `crop-plant-focused-20-02.log`：误用不存在的 voxelSemantics.has，及直接runtime fixture安装了无callbacks的Media；修正为既有get合同，并为直接crop fixture采用无Media/Station的明确Block module组合。保留失败。
- `crop-authority-30-focused-01.log`：fresh restore 后尚未resident的目标不能充当前提；之后只加载原canonical chunk，在行为baseline前核实Farmland。
- `crop-authority-los-32-red-01.log`：在prepared成功receipt clone时，对原Air射线路径格[0,60,0]真实WorldCommit→Stone；外部提交确实成功，但旧候选仍种植成功。最终验证增加原有两条LOS射线的重验，未放宽range/loaded/新鲜度。
- `crop-plant-focused-20-04.log`：25PASS/1FAIL，唯一失败是crop clock原5000ms超时；与末端静态/类型子进程有重叠，不能把整组记PASS。保留deadline；随后隔离正式headless同源码通过。

## 已完成验证

- Classic plant矩阵原13例PASS，above提交期race后14PASS；最终LOS race在正式headless中通过。所有负例检查crop/inventory/gameplay/world/sequence与目标格，不将外部WorldCommit归于失败种植。
- 非Classic真实Headless/Authority注册种植：crop-plant-spine-20-01.log，1PASS；使用sample内容/体素策略，种子扣减、唯一crop记录、WorldRevision不变及重复拒绝均通过。
- `crop-plant-lineage-20-02.log`：6PASS，包括新精确pre-crop身份。最初用Web config选择Playbook文件导致空匹配FAIL；后以独立明确include配置执行原文件，不计空匹配为通过。
- `crop-plant-static-20-01.log`：全静态PASS，5/5 sealed原字节、format/paths/lint、全生产/工具/Classic类型、Svelte0error0warning、ESLint正反例和CI选择13/13。该轮之后新增LOS final validation与测试，已补 `crop-plant-types-20-03.log`、`crop-plant-lint-20-01.log` PASS。
- `crop-plant-canonical-headless-20-01.log`：正式脚本47文件285/285PASS，154.55s，隔离执行，无timeout或断言变更。
- stdlib必需确定性全组：`crop-plant-stdlib-20-01.log`，150文件1090/1090PASS，175.42s，隔离执行。新build/browser/远端精确最终SHA CI尚未运行。

所有日志位于 `/workspace/pr41-recovery-20261008-root-01/` 或 `/workspace/pr41-recovery-20261008-fixtures-01/`。新输出独立路径；旧sealed evidence未改写。

## 连接、网络与预算

21:34UTC状态核验：原Cloud命令/Git正常、远端75f/main fba4486、两个原stash保留；用户此次消息只请求状态，不暂停任务。21:03真实UI周剩余92%，含同账户其他工作，Cloud无百分比读取；停止线仍约60%。

CI75f artifact由GitHub连接器读取成功，但传入本Cloud时其文件端点sdmntprcentralus.oaiusercontent.com被代理403拒绝；未扩网络权限。可读作业状态/日志仍说明Chromium取消、预览跳过。本地Browser17 trace可继续诊断；不能由本组headless/static PASS宣称当前真实旅程可玩或可合入。

长期docs baseline只更新代码地图说明实际新职责；未改变产品路线、性能预算或验收成功口径。
