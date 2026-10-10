# checkpoint44：原生结果与精确 Worker 诊断接线

Browser33 精确源码 `b17dc50921b695b2014a1b935c310f2073fb45f7`，build32 sourceDigest `7582d9cb534a42bcba424132f509f41d2081d267698709044f7a76fb72a54918`、artifactDigest `2aa9767028ae9394a65e02c5a6eeeda38a68cff784f3049862fb772e11efd8ca`，284文件。原完整3测试闭合为 main FAIL、visual PASS、Modular条件SKIP，17.4分钟；不是可合入状态。

C0–C3、正常Creative作物与导航、V1完成；V2铁资源准备在 `walkTo → waitForSnapshot → followEquipmentRoute → mineResources → prepareCraftedIronArmor` 触及原900秒，未到C4/C5。末态player与server位置均约 `[80.865,32.6,-0.461]`、落地/无碰撞，不认定永久路线卡住。同128帧CPU中位tick25.05ms、gap446.2ms、同步receive39.6ms；这些字段不是GPU执行时间。

真实原生采集元数据为 COMPLETE、无数据丢失，08:22:44.089–08:23:04.260 UTC、20.171419372秒、126610事件、33862305bytes。核心和两个可选GPU类别均实际存在；完整类别发现记录在原始metadata。原始文件、闭合results、原failure字节及两个派生文件保留Root独立 `browser-33-*` 路径。

同采集GPU主线程的SwapBuffers共29次，inclusive wall19158.374ms、原生tdur70.633ms；RunTask线程CPU383.521ms。墙钟大头在等待，未取得具体着色器或GPU执行时长，不把提交调用的CPU误当实际光栅成本。DedicatedWorker169480的timerId1有1460次TimerFire，inclusive wall12352.965ms、全部提供tdur合计8728.654ms；该线程2558次RunTask中2541条提供tdur，已记录部分合计9639.469ms，17条未记录CPU时间不能填零。这些嵌套范围不能相加；先前跨窗口/proc线程CPU也不能拼成同帧预算。Authority源码是唯一8ms周期的线索，但本次trace没有Worker URL映射，owner仍未直接核实。

本次闭合Playwright V2 trace的2599个已闭合API调用中，完整snapshot1467次、inclusive119秒；Pointer Lock点击与关闭背包各24次、inclusive35.7/34.3秒；Creative选择/返回Survival各10次。调用可能重叠。这些步骤尚未改变，没有重引旧slimSnapshot、批量缩短旅程、降低断言/品质或提高期限。

新增 `authority-cpu-profile.ts` 只在可选flag开启时延迟360秒，采集20秒/10ms V8 profile。原runner从verified artifact唯一Authority script派生精确asset/hash；当前实际artifact为 `assets/authority-worker-CPfL9iiH.js`，SHA256 `2a21deaf613c53836f83bcd0f85adfaf1a50772cb76f051a966b700439d8e73e`。采集时严格匹配 `new URL(asset,page.url()).href` 的唯一worker，拒绝origin/path/userinfo混淆和多目标；实际target身份原样记录。

`target-session.ts` 仅使用公开嵌套CDP命令与事件，不访问SDK私有连接、不暂停目标。pending最多64、回复10秒超时，忽略其他session回复，目标退出拒绝pending；start/stop/Target detach/browser detach错误保留，并发stop共享一次清理。默认关闭、禁止benchmark，与其他CPU/native诊断互斥；提前失败取消未开始timer，所有附件仅diagnosticOnly/eligible=false。

Task88实际missing helper RED保留；Task89最终三fixture26/26 PASS、scoped lint PASS，覆盖精确目标、模式/身份门禁、早停、错误响应、目标退出、两个detach同时失败、错误origin/base path、错session回复及超时、并发stop。它们均为fake CDP，不证明真实Target发现或Profiler采集成功。根Classic types已通过，完整静态检查在接线后执行；新的build33/browser34待进行，没有采纳生产优化。

根 `authority-profile-static-44-01.log` 完整verify:static:ci终态exit0：sealed5/5、全格式/路径/lint/types、Svelte0错误0警告、ESLint规则11文件66/66及CI选择器14/14均PASS。新增本组报告经局部格式检查；无全套headless/stdlib本地重复，生产源码保持，以远端对应当前SHA的有效结果区分执行层级。本组有界风险复核不等于整PR正式review。

远端b17dc509 CI run37903859887：Architecture、Static、Deterministic modules、Classic headless、Production build SUCCESS；Chromium CANCELLED、Cloudflare部署SKIP，不能称完整绿灯。PR仍OPEN/DRAFT、merged=false、无冲突、review submissions/threads为空。不会切换ready或合并。

08:33连接通知后只读恢复核验：源码/工作区保持，全部三测试及wrapper按正常失败路径闭合，workers已退出；未见异常退出信号，未重启或重复任务。初次HTTPS push缺认证入口，随后本次Git命令临时复用现有gh credential helper推送成功，无新密钥/配置或权限扩张。最近实际产品UI08:55 UTC周剩87%，含其他任务用量，约60%停止线保持。全194、C5、真实Modular与组合整帧A/A/A/B仍未完成。长期docs只补实际诊断owner。
