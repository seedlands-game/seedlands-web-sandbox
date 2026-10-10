# Browser24 遮挡证据与消费者修正 checkpoint34

Browser24 / build23 / 489c194101e2696bd16a71f653f6c32cabb9b895：完整 correctness 1 FAIL、1 原视觉 PASS、1 Modular条件SKIP，8.2分钟。Whole receipt FAIL、reservation measurement NOT_RECORDED。C0–C3 与新作物步骤完成，V1 首个水桶步骤失败，V2/C4/C5/存档恢复未运行。

`observations.json` 独立汇总五个原始 crop 附件的精确值；原始JSON仍保留在根输出和未改写trace。第一田[67,31,2]真实放土/锄地/种植0/施肥7/收割，第二田[69,31,2]种植0/施肥7，GPU每次实际8 vertices/12 indices，收割后无残留；正常返回Survival的库存保持断言通过。五张原始PNG逐字节复制，SHA-256记在diagnosis。该局部Creative消费者流程不等于Survival资源链、自然生长或保存恢复验收。

随后从原V1水approach[66,2.5]瞄准支撑[68,30,2]，12次实际命中新增耕地[67,31,2]。新增田块挡住原视线，Task55/57静态审查遗漏由报告61纠正；不能放宽瞄准或删除原V1路径。

修正仅将新田块移至[67,31,-2]/[69,31,-2]及approach[x-1.5,z+1.5]。原floor[-4,30,-3]..[224,30,3]/Air范围明确覆盖；新田块z[-2,-1]与原V1水z2、门z0、唱片机z2及对应站位不共享目标列。V2 z=-0.5中心线离田块边缘0.5；静态几何不证明所有实际body sweep/LOS，待Browser25。原场景、目标、动作、C0–C5/完整V2、画质、aim12次、900s、visual/modular保持。

`crop-clearance-static-34-01.log` exit0：受改动文件Prettier/ESLint及完整Classic types。无生产源/新fixture改动，复用checkpoint32静态与76文件522/522及checkpoint33路线六文件48/48，不重复全量。正常提交后新build24/Browser25唯一完整correctness入口，未复用旧dist身份。

原完整receipt/log/trace已独立保留在 `/workspace/pr41-recovery-20261008-root-01/browser-24-results`、`browser-24.log`、`browser-24-reservation.json`、`browser-24-failure-33-01.json`；仅完整三项terminal后才改源，无并行CPU测试。03:25前后远端核对仍cd5ff7ca/mainfba4486e，未发现他人新提交，尚未推送本地组28–34。

最新主对话实际周剩余03:09UTC90%，约5天23小时后重置，约60%停止线不变。完整V2/V3/V4/Modular/194与组合整帧A/B未完成，PR不声明可合入；无合并、自动合并或生产部署。
