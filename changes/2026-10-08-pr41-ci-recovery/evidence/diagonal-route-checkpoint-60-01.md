# Group60：斜向远段输入规划与完整浏览器双失败

模型和必要静态、完整 headless、构建通过；原 Browser60 实际 EXIT1，主旅程及 Visual 均失败，尚未进入斜向路线验收。PR 保持 Draft，整体不能合入。

## 最小输入规划与反例

Group59 失败路径斜向接近目标，但 Group58 的远段选择额外要求当前位置已进入目标 z 的 0.08 终点走廊，通常直到 x 剩余不足3格才成立。现在仅移除这条远段前置条件：两个 owner 沿原方向的 x 剩余均大于3、有限观测、ground/noncollision、Authority 停稳且呈现追上、真实视角对齐完整目标向量小于原1px时，复用原300ms上限；near 等其他情况仍80ms。routePulseDurationMs继续裁剪。

原0.08终点走廊、0.06双 owner 到达、0.45交接邻域、45/20/900秒、fresh full snapshot/ACK/settle与真实原生组合键不变；没有世界、视角或库存写入捷径。

- 原选择器正/反两个合法对齐斜向远段均实际 RED：收到80而非300；其余16例PASS。
- Task116复用现有明确平地、真实stdlib stepBody、60Hz及固定250ms snapshot模型，不改延迟，从[98.5,32.6,0.5]到[78.5,-0.5]的实际walkEquipmentRoute在原45秒超时RED。候选后单例GREEN，双 owner 各自小于原0.06、ground/noncollision、velocity0、fresh tick/ACK、完整释放均保持。
- Root九文件53/53 PASS。该模型只有fake Page协议与真实物理函数，不证明真实Authority、实际持键时间或FPS。现有agent的配置请求为Luna/medium，实际服务型号未由元数据核实；没有为探测另开会话。
- 完整verify:static:ci实际EXIT0。随后读到精确904的远端headless 1 FAIL/658 PASS：target-aim.test经prepareBuildingTargetWithRealMouse间接调用walkTo，旧fake keyboard漏补press。本片补齐相同端口语义，保留原body-clear和实际upper-face瞄准断言；没有在正式helper添加fallback掩盖错误。
- 补齐端口后，定向Prettier/eslint/classic-test类型检查实际EXIT0；原完整test:classic:headless实际EXIT0，103文件/663例PASS。全静态候选检查与后续兼容修改的定向检查分别记录，不冒充兼容修改后重新跑过全静态。

日志：Root独立`diagonal-route-{red-60-01,regression-60-01,static-60-01}.log`、`target-aim-compat-static-60-01.log`和`classic-headless-60-01.log`；模型报告与RED/GREEN为`/workspace/pr41-recovery-20261008-fixtures-01/task116-*`。旧失败保留，未重复setup或已闭合浏览器运行。

## Browser60 的身份和真实终态

新identified build实际EXIT0。source SHA `904a78f47624c7e09b07c401a15f34a020ad6026`加本片未提交工作区，sourceDigest `f27bfb98b18ed39f5a9450b04b5ea10f0b27ab68db08354e55c5d9faa435a97d`，artifactDigest `41d4f632d6033029c4a72d3cf461127eebe35b11a920418180f5a147c72b07c1`，builtAt `2026-10-09T18:40:28.338Z`。生产字节与前次相同；不是最终提交SHA的CI。

原唯一`SEEDLANDS_HARNESS_RUN_ID=pr41-classic-browser60-01 pnpm harness:classic`实际PTY EXIT1、canonical receipt FAIL。主旅程6.5分钟FAIL、Visual1.1分钟FAIL、Modular SKIP，2 FAIL/1 SKIP。正式failure receipt只有C0–C2 PASS。C3已放置木板并打开背包，但浆果格子的locator.hover超过原10秒；没有进入crop/V1/V2/C4/C5/恢复/194，不能证明新远段规划可玩。Visual在capture的原20秒blockLightReady且sourceRevision等于worldRevision谓词失败，不能以计算队列空代替光照完成。

运行期间源码冻结，没有并发测试、构建、profiling或大型trace解析。结果与两个原始trace在本次test-results/report、ignored `harness/results/pr41-classic-browser60-01/classic.json`；独立日志为`production-build-60-01.log`、`classic-browser-60-01.log`，身份为`browser60-build-identity-01.json`。Browser59原dist/results/report移动保留至Root独立`browser60-retained-inputs-01/`，没有删除/改写sealed证据。

## 运行结束后的诊断，不能当性能或产品PASS

仅流式读取主旅程原trace的hover metadata到独立`browser60-hover-metadata-01.json`。before snapshot完成后，locator解析约4.27秒、可见稳定约0.98秒、scroll约0.56秒，随后input snapshot等动作仍消耗预算，最终超时。它定位等待分布，不能证明某一个GPU、Host或事件阶段是根因，也没有放宽10秒或跳过hover。

从视觉trace提取唯一原`block-light-readiness-failure.json`附件到独立`browser60-block-light-failure-01.json`。当时worldRevision9、blockLightReady false、sourceRevision null、rebuildCount92；loaded28/rendered18，compute31/31、running0/queued0/failed0。cache为28个brick、pending14；若干cached halo仍为unavailable而当前已loaded revision0，部分brick尚未缓存。last rebuild9.3ms/max89.6ms只是诊断，不能当整帧性能。下一片需要核对失效和调度，不伪造valid/sourceRevision，不关闭trace、降质量或恢复已撤回的性能候选。

[精确904 CI59 run37973513911](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/37973513911)已终态：architecture/deterministic/build/static SUCCESS，headless FAILURE，Chromium FAILURE、部署SKIP。Chromium首次startup-card原10秒失败，重试在V2内耗尽原900秒，Visual PASS。耗时行不是完整V2通过；完整日志已取到，不抢推取消。下一提交修复的是headless端口和远段规划，不宣称这两个浏览器阻塞已闭合。

真实Classic完整玩法、正式运输产品/旧非空载具迁移、真实Modular产品、组合whole-frame稳定A/A与有效A/B、最终精确SHA CI/review仍待完成。18:37真实UI周剩84%、5天8小时后重置，账户总用量变化不单独归因PR；约60%停止线保持。
