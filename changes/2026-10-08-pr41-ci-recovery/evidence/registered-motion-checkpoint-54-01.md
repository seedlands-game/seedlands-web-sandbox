# checkpoint54：注册的 surface 运动与唯一物理提交

## 身份与范围

前驱 `2e120b62d1862e2248ac4b1d4a4e183ab98257f6`，base `fba4486e433c145db658f6b1598b70c47f759c8a`。本片显式可选、非 Classic surface policy：accepted world-space 输入按 canonical yaw 投影，Host 在现有 physics tick 内调用 manual registered system。普通动态实体、载具 pose/velocity/component/fuel 与乘员 seat 使用同一 EntityStore prepared mutation/series，保持128×192容量及按实体数的 Kernel batch 计数。短生命周期 Host frame 不复制全部 body 数据到 module state，没有第二 position/cargo/relation/clock owner。

loaded provider 支持检查覆盖整条平移走廊；碰撞使用载具与乘员 compound、保守转向包围体和当前角色/载具相对位移。两遍载具推导仅可停止已对静止载具安全的路径。普通身体的静态投影包含当前派生 mounted rider，transport 普通 physics 保持 canonical body，不按旧速度绕过注册规则自行推进。veto/permission 拒绝保留普通实体原结果和载具当前 pose/seat；stale 时保持当前 owner，下一 tick 重算，不能覆盖规则期间已接受的变化。对于当前owner的body校正，清空先前普通physics的contacts/grounded，避免把旧位置的接触信息附到新位置。固定产品 Host transport 系统 grant 未从 Pack 请求派生。

500行门禁要求将已有请求/生成 façade 组装及纯 session snapshot 投影抽入辅助函数；所有原 owner、入口与错误语义保持。没有修改浏览器断言、时限、质量、CPU亲和性、工作流或生产部署边界。

## 有效失败与最终候选

- Luna Task110 `task110-transport-authority-motion-red-03.log`：正常目录/deploy/use/Survival/receiveInput 后实际载具z仍0.5，运动断言失败。早期缺 relation module/瞬态 seat 前提失败不作为生产 RED。
- Root `registered-motion-coasting-red-54-01.log`：已经移动的载具在 motion veto 后z从0.570320变0.581309，证明旧普通积分旁路；修复为 canonical body。
- `registered-motion-mounted-crossing-red-54-02.log`：正常 body 在底座上方从x0扫到x6穿过乘员；加入当前派生 rider collider 后阻挡。
- `registered-motion-stale-fallback-red-54-01.log`：临时取消 stale fallback 后，规则已把普通玩家z改为4.5，旧 physics 写回0.5。
- `registered-motion-forged-publication-red-54-01.log`：临时取消候选/写入精确校验后，注册 after-rule 伪造 entries 被忽略仍推进载具；当前候选严格拒绝。
- `registered-motion-two-carriers-red-54-01.log`：临时取消相对运动第二遍后，两辆相向载具各自静态扫掠可通过，首车z推进0.549725；恢复后两车保持原pose并停速。

所有临时变体在 finally 精确恢复，没有保留测试开关或额外生产路径。第一次 Root stale 夹具在规则内调用禁止的整个 Authority view，未实际改 owner，记录 `registered-motion-authority-green-54-01.log` 5/6；修正为事先捕获 entity ID，不降断言。Luna 首次 GREEN 两项错误前提及 Root 两次生产 types/行数 lint 失败均保留。

- `registered-motion-stdlib-regression-54-01.log`：9文件78/78，含纯控制/几何、连续 actor/rider/unknown 支撑、motion模型、prepared owner、Authority/Creative/中和输入。
- `registered-motion-authority-regression-54-02.log`：7文件37/37，含10个实际运动/前沿用例以及部署、上下车、碰撞、死亡、旧V4恢复回归。实际运动用例验证同tick seat/velocity、veto、墙、伪造、stale、单次按实体计数、重放/错epoch、非法actor系统调用和两车相对碰撞。
- 精确 Classic Pack control/candidate entry 字节相同：SHA256 `3bb6fb967fb270e97d1843892734863c64fdb20f3f3709ec18a04a7c782bcb33`，`registered-motion-classic-pack-identity-54-01.json`。仅证明 Pack entry identity。
- 生产类型检查最终 `registered-motion-types-54-05.log` EXIT0；scoped lint 最终 EXIT0。完整 `verify:static:ci` 首次在两项 no-useless-assignment（try/finally中的重复初始赋值）处失败，`registered-motion-full-static-54-01.log` 保留。修正为明确声明类型，不改控制流程；修正后 `registered-motion-full-static-54-02.log` EXIT0，冻结证据5/5、格式/paths/lint、所有生产/工具/测试类型、Svelte0错误/0警告、规则66/66、选择器14/14。随后针对stale body清空旧contacts的最后修复，`registered-motion-final-frontier-54-01.log` 2文件10/10；最后完整 `registered-motion-full-static-54-03.log` 实际 EXIT0，完整格式/冻结证据/paths/lint/生产与测试类型/Svelte/规则/选择器通过；不将此前失败改写成通过。

全部原始 Root 日志位于 `/workspace/pr41-recovery-20261008-root-01/registered-motion-*54*`，Task110在独立 fixtures 路径；新增用例纳入原 Classic headless/类型选择器，sealed evidence 未改写。未运行本地 build/browser/performance；免费 fuelPerMeter=0 夹具不证明真实燃料交互。路线运动、真实货箱/燃料、旧车辆迁移、Classic/Modular UI及组合整帧性能仍待后续闭环。

## 当前远端与预算

CI53 run37942699218 精确前驱2e：五项 SUCCESS，Chromium CANCELLED，Cloudflare preview SKIPPED。日志 `ci53-chromium-job-113861421156.log`：首轮进入C4后全旅程15.4分钟失败，V1 52.2秒、V2 9分钟；重试进入V2时14:41取消，没有最终异常堆栈。取消早于本组推送，不能声称是本组导致，也不能从步骤完成行推断产品断言全通过。trace 下载仍受此前实际403/domain授权问题影响，不绕过限制。

14:10开始，预注册传统1.2PD×120%=1.44PD、AI60分钟×120%=72分钟，15:22为本片checkpoint边界。14:09主对话真实产品UI周剩85%（包括其他任务），保守60%停止线保持；不能用token/credits/工时估算周额度。本片由Root与一名既有精确Luna/medium完成，Luna不再委派；实际会话模型元数据未核实。
