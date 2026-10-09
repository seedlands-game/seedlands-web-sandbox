# 真实键盘事件时序 checkpoint64

2026-10-09。父HEAD56294bffbefeb46508dcf2321c85bf6624da2cb6，base fba4486e433c145db658f6b1598b70c47f759c8a。Group64仅新增可选只读诊断；不改变生产app、正常输入producer/consumer、renderer、质量、旅程或断言。

## 触发与证据界限

Browser62原唯一runner实际EXIT1：本地C0–C3 PASS，主15.3min在第二块crop最后截图处耗尽900秒；最后截图只有442.4ms，前四次crop截图成功，不是截图单次卡住。Visual2.6min原单击/邻块/20 ticks PASS；Modular SKIP，V1/V2/C4/C5/保存恢复/194未运行。CI62 run37982162906自然终态五项SUCCESS、Chromium FAILURE、Deploy SKIP；两次main最终C4返回walkTo（spec333/harness266/130）耗尽900秒，V2耗时8.3/8.5min只算步骤耗时，Visual1.1min PASS，Modular SKIP。原结果不取消或重跑。

API的delay80/300与前后snapshots不足以证明实际按键持续时间。Browser61仅C3的20秒native窗口两组keydown/up间隔5.791与235.523ms，没有key code且不覆盖crop，不能推广为80ms路线脉冲或900秒根因。Task123“瞄准一次evaluate”候选经Root/Luna复核撤回：旧HUD/ray已经同次读取，较新snapshot未被证明错误，未保留实现或无效RED。降低evaluate数量若当优化理由仍须A/A/A/B。

## 新诊断

SEEDLANDS_CLASSIC_KEYBOARD_TIMING=1默认关闭，仅Classic生产旅程，拒绝benchmark，启用前require runId/sourceSHA。每个document以addInitScript安装window passive capture keydown/up listeners，只记录移动KeyW/A/S/D/Space的类型、code、event.timeStamp、performance.now、repeat、isTrusted、PointerLock与visibility；1024条固定有界ring和total/dropped。记录器不发输入、不调用Harness、不取消事件、不改owner；stop同步复制当前document数据，移除监听、删除私有属性后attach。navigation新时钟新记录，当前文档外历史明确未保留；关闭PAGE_CLOSED/未初始化NOT_STARTED不制造事件。原完整Playwright trace保留，beforeEach/afterEach沿既有唯一spec接线。

## 已执行

- Task124新helper缺失RED实际EXIT1：0 tests、module不存在，只证明诊断入口缺失。首个GREEN尝试fake把listener放document而非约定window，失败保留并纠正，不是生产行为根因。
- 最终Task124四项PASS实际EXIT0：真实init callback在fake window/document/performance执行，disabled/identity/benchmark、passive白名单与ring/drop、原handler不受干预、字段与独立附件、cleanup、不复活、document时钟、冲突/closed/NOT_STARTED。fake事件trusted=false，不冒充浏览器真实键盘。
- Root五文件诊断/CPU/native/canonical回归35/35 PASS，实际PTY70914 EXIT0。私有原日志keyboard-timing-regression-64-01.log。
- 完整verify:static:ci实际PTY9004 EXIT0：冻结证据5/5原字节、Prettier/paths/lint、生产/工具/Classic测试types、Svelte0/0、ESLint合同、CI工程合同15/15。20:38一次create-process transport断开后，20:38:22只读恢复、原PTY继续且正常EXIT0；没有重跑static。原日志keyboard-timing-static-64-01.log。

本地完整headless未重复；本组identified build和pr41-classic-browser64-01原完整诊断runner仍待执行，不把静态/模型PASS当真实玩法或性能PASS。提交后新SHA必需CI、完整C0–C5/V1/V2/death/restore/194、实际Modular、统一光照接线、运输产品/旧非空V4迁移与组合整帧A/A/A/B均仍未准出。PR仍Draft，不合并、不自动合并、不部署生产。后续只在新事件证据支持下改输入或runtime。

## 预算与交付

20:26主对话真实UI周剩83%、5天6小时后reset，约60%停止线保持；账户总不能独占归因PR，不换算tokens/credits。用户模型请求Sol/high/default与既有唯一Luna/medium，实际服务元数据未核实。未创建额外agent/模型会话、权限或网络扩张。传统0.25PD×120%=0.3PD、AI40min×120%=48min，20:31起约21:19有界checkpoint。长期docs baseline不改：本片只增可选诊断，没有修改产品/架构/验收规则。新输出独立路径，sealed证据保持原字节。
