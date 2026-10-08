# Browser19 建造清场 checkpoint26

## 身份与整次结果

- Browser19 source SHA：`259e09ef28758f85efaf5d022288a8e669969561`，全程工作区干净且源码/HEAD 冻结至 wrapper 终态。
- build18 sourceDigest：`7dc8a6b3ae5da0d20a6d7aa56a9395d9ae8788a3740c076a7828b0e083156b28`；artifactDigest：`512e2ed38af8b5a53ca46b429699af79f376afd54ffbd9291e950534f517a9ec`。
- 唯一 `pnpm harness:classic` run `pr41-cloud-browser-19`：**FAIL**，主旅程1 FAIL、visual1 PASS、modular1 SKIP，5.7分钟。C0/C1/C2通过；C3首次放置失败，后续V1/V2/C4/C5未运行。不得将步骤结束日志写为C3通过。
- 完整 receipt：`harness/results/pr41-cloud-browser-19/classic.json`。独立原始输出：`/workspace/pr41-recovery-20261008-root-01/browser-19.log`、`browser-19-results/`、`browser-19-html/`、`build-18-01-artifact.json`。未改写旧 evidence。
- 有界流式诊断：`analyze-browser19-26-01.py`、`browser-19-diagnosis-26-01.json`、`browser-19-composition-26-01.json`。18/19真实导出的 compositionIdentity 相同；不因此混用 artifact 身份。

## 定位与修复

C3点击前 Authority eye `[51.855608,32.600000,0.499404]`，静止、grounded、non-colliding；这只证明未撞当前世界，不能证明新的放置格没有玩家。Controller interactionAttempts 5→6，实际右键已到达。去掉正式eye offset1.6后，player body半宽0.32侵入目标 `[52,31,0]`。正式Authority边界测试进一步证实原坐标返回 `player-collision`、木板/世界revision不变；安全位置的同一正常place则成功扣1件木板。

候选只补建造前的真实输入前置条件：经已有路线/helper退至 `[50.5,0.5]`，保留双端settle、grounded、collision、45秒期限和严格路线容差，再由当前目标卡与真实ray确认支撑格及上邻面。没有修改碰撞、放置、扣物或网格规则；未增加超时、重试、目标容差或降低断言。正常右键后的原voxel16/网格断言继续执行。不是性能收益声明。

Visual attachment `browser-19-single-click-26-01.json` 从原HTML报告提取，保持实际body：pointerLocked=true、authorityPaused=false、targetEntity=null；interactionAttempts0→1、worldRevision36→37、目标3→0、邻格3不变。该用例通过；Browser18单击失败根因仍未证实，不能把单次成功当作旧失败已消失。

## 本片验证与边界

- `building-clearance-red-26-01.log`：1 FAIL/13 PASS，真实输入helper仅瞄准支撑格仍占据建造格，目标断言RED。
- `building-clearance-green-26-01.log`：2文件19 PASS，包含真实鼠标delta/几何ray和已有失败边界。
- `building-clearance-authority-26-01.log`：1 FAIL/1 PASS，测试夹具错用recipe ID `planks`作item ID；此失败不是行为RED。修正实际item ID `plank`。
- `building-clearance-authority-26-02.log`：2 PASS，正式Authority原位置拒绝且不扣物、安全位置正常place成功；headless fixture定位不充当浏览器真实移动证据。
- `building-clearance-types-26-01.log`、`building-clearance-types-26-02.log`和两份scoped lint：通过。自然提交门禁与新生产build/browser仍须取得本片最终identity。
- `259e09e`远端CI run37859440623的deterministic/headless/architecture/build/static已通过；Chromium查询时仍运行，没有宣称该SHA全部CI绿色。

当前未达到完整可合入验收：四槽装备资源链、其它V2正式producer、可见农业与土壤清理、V3导航/载具/真实模块化组合、V4灯光/恢复及194项行为矩阵、组合端到端A/B和最终精确SHA的CI仍需完成。只读Luna39/40报告发现具体owner缺口，不是实现或验收证据。

长期docs baseline未改：本片修复现行建造输入前置条件，未更改产品/架构合同。最近真实周额度读数为主对话23:01UTC确认剩余91%；本环境不能直接读取产品UI，不以token/credits估算周百分比。约60%停止线、无合并/自动合并/生产发布限制继续有效。
