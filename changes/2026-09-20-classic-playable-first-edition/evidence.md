# 当前证据

- 基线 fba4486，2026-09-20；保留原有未跟踪 Beta173 设计。
- nice -n 10 pnpm build：PASS，包含 Pack、Rust 指纹、SSG、Svelte/TS、Vite。PlayCanvas chunk 大于 500kB 警告留作包体观察。
- 原版 Minecraft 未安装或启动；EaglerPorts 仅 GitHub API 只读核对。
- 现有内容：16 voxel ID、19 items、3 starter profiles、6 背包 recipe、5 工作台 recipe、1 炉配方，不是全量实现。
- Headless、Browser、全量玩法待验收；主观音画、性能未验证。

- Headless control：有限资源成长/储物/半程熔炼恢复 PASS，1 test，11.60 秒用例、13.23 秒全程；命令 pnpm --filter @seedlands/web test apps/web/tests/integration/runtime/server/composition/overworld-progression-journey.test.ts --maxWorkers=1。开发夹具/位置构造不是键鼠证据。
- #36 恢复：复用 origin/codex/classic-validation-deferred 的 artifact 和 C0–C5 唯一线路。首个带身份构建 PASS；artifactDigest 0e3ef8e14dc763a931eee85df6e1a1df0c167e9f036c02b6f9cd709dc3bbaabf，仅绑定当次工作树。

- Browser attempt 1 FAIL：C0 生产世界成功；C1 点击被默认 F3 诊断遮挡，480s 超时。修正用真实 F3 收起诊断，操作超时 10s，保留 trace、逐步日志和 runId 结果。

- 食物回血 RED：新增 food-health 4 tests，其中 3 因 Consume capability 不支持 healthRestore 失败；其余 stdlib 531 tests 通过。本次命令误传 -- 导致跑了全包（2 workers），没有与浏览器并行；后续改用 test:stdlib:ci 定向参数，1 worker。
- 食物回血 GREEN：4/4 通过；stdlib typecheck 通过。新增 Classic 正式 Authority 路径 RED（受伤后仍拒绝食物）→GREEN（1/1，含保存恢复）。目前浆果同时保留 NPC hungerRestore，玩家 satiety 自动更新关闭。
- Browser attempt 2 FAIL（24.6s）：C0/C1 真通过；C2 挖掘后已自动拾取，等待可见掉落失败。snapshot 显示快捷栏原木 1，不能断言掉落丢失。
- Browser attempt 3 FAIL（约 66s）：后退站位容差 0.25 小于路线上横向漂移，45s 后远离目标。收敛修正为现有走路容差 0.65 和 5s 上限。阶段日志出现只表示阶段结束，不等于 PASS；以最终回执为准。

- 续作环境：Playwright Headless Shell 151.0.7922.34 / v1234 安装完成；此前配置/库存/食物全仓 typecheck PASS（包含 Svelte 0 errors / 0 warnings）。新浏览器线路尚未运行。
- 木板建造 RED：plank-mesh 1/1 FAIL（faceMaterialFor(16) 返回 undefined）；classic-plank-building 1/1 FAIL（正式 place 返回 success:false）。尚未改变原版 ID 或地形生成器。

- 木板/食物/库存定向 stdlib 7/7 PASS；正式木板合成→放置→存档恢复→挖回、食物、有限资源铁器成长、材质目录与旧生成字节共 8/8 PASS。
- Wasm 木板新增场景发现 ABI 消费端硬编码 material<=18，6 tests 中木板场景 FAIL；其余 5 PASS。已改为校验当前声明材料集合，保留未知 ID 拒绝，待复验。
- 木棍 RED：工具缺木棍时仍合成成功，classic-stick-crafting 1/1 FAIL。已补 stick 内容与真实材料消耗，待 GREEN。

- 生产构建 PASS：sourceDigest 861121ad68ad2e1f6e662afef49ef5adc61cc3f0fac2741a080d6af8d60d3b1f / artifact d70e2905061f933ed190e4a3402467d97acfc91268286af893bf9fe0bb7657cb。
- 专用 Headless Shell 尝试 FAIL（21s）：C0 PASS，C1 document.pointerLockElement 始终为空。此环境不满足输入合同；不 mock Pointer Lock，改用锁定 Playwright 配套完整 Chromium 的新 headless 模式，继续禁止 headed。旧系统 Chrome headless C0–C3 通过仅为此前证据，不能冒充本次通过。
- 木棍材料缺料/守恒 GREEN 1/1；更新后的有限材料铁器旅程 PASS；Wasm/TS 对照 6/6 PASS（含木板及未知 ID 拒绝）。

- 创造槽9 RED→GREEN：原selectCreativeSlot硬编码拒绝8号槽；改为实际目录长度。保存恢复与模式切换保持第36格物品，3/3通过。
- 库存布局定义身份 RED→GREEN：原能力definitionIdentity缺失；显式记录冻结布局JSON后，不同容量身份不同，4/4通过。codec恢复也消费同一layout。
- 恢复E2E/四项Headless合同新增tsconfig.classic-tests，typecheck:classic PASS；职责拆分后全仓typecheck PASS。
- CI作业已写入：四项Headless、单次build、下载同次完整dist后唯一Chromium，远端NOT_RUN。未改保护/部署权限。

- 正式静态入口 pnpm verify:static:ci PASS：格式、路径、Lint、所有生产/当前恢复测试类型、ESLint边界66 tests、CI选择8 tests。
- pnpm test:deterministic:ci PASS：Kernel28 tests、stdlib539 tests（单worker）。pnpm test:classic:headless PASS：4 files/4 tests，有限材料铁器成长、木板保存守恒、食物及木棍材料；第9创造槽在正式命令/Authority/普通权限链补充4 tests通过。
- 旧09-16目录快照81文件中27个已与contract-snapshot.json不一致，本轮未修改这些原始文件；保留交接时字节，不声称旧合同快照通过，不重生成摘要掩盖漂移。格式例外仅保护交接原文，不能视作合同审核通过。

- 完整Chromium新headless：C0/C1通过真实Pointer Lock和移动；C2发现指针协议hotbarSlot上限仍为7。定向RED→GREEN 7 tests（包含9槽交换/8槽拒绝）。
- 后续浏览器32.2s失败：trace明确NotAllowedError“Too many pointer lock requests in a short window of time”。旧驱动每次虚拟坐标接近边缘就exit/relock，改为headless虚拟坐标连续相对移动；产品点击已锁定画布时不重复申请锁。待浏览器复验。

- 系统Chrome强制headless：run 342ffab6-80dc-4454-9bc7-8dc66ae0dd59 C0–C3 PASS，C4 FAIL。有效路径/terrain窗口完整、resident70/eviction0，Logic submitted1208停在夹具初始化；推翻缺pin假设。NPC远移来自碰撞，不能算自主行为成功。
- Logic resume RED→GREEN：Authority定向10/10通过。浏览器run ff0fb874-bc73-43b7-b563-0b63911d249b C0–C4 PASS，首次真实NPC活动完成；C5保存/恢复身份库存已过，重新点击被默认F3面板挡住，统一lockPointer前用真实F3收起可见面板。

- 完整生产旅程PASS：runId 12061112-d934-4564-ab39-ee0bd31ee4c5，C0–C5全部PASS，约1.9分钟。macOS HeadlessChrome/153.0.0.0、WebGL2、960×540、单worker、mute-audio；pageErrors/failedResponses为空。真实输入完成采集/掉落/拾取/木棍工具合成/第9槽木板建造/食物回血/战斗/工位拆放、NPC主动活动、跨区块往返、保存返回、同上下文继续及再次工作台交互和移动。
- 本次生产sourceSha fba4486e433c145db658f6b1598b70c47f759c8a（含未提交工作树），sourceDigest e7af7df46e3b9fdba887b3a12361e905b1ed23eebbf3d48f074d69f21b3baaaf，artifactDigest 90df253281c1d5512adeb6aef6568226a0b2d75bdb43b857f37d8658fe879a3e。证据只绑定此身份；无性能声明，未运行原版Minecraft。
- C5最终修复为等待背包关闭的实际DOM终态，再发F3并确认debug隐藏；先前直接发F3发生在输入仍受背包阻挡时。所有操作仍为真实输入，未中途改状态。

## 阶段交付快照

S0与S1关键可玩闭环已取得本机证据，CI定义已恢复但远端尚未执行。已实现木板方块/原创纹理、木棍材料、36/9库存与模式/命令/指针全路径、食物回血和Logic恢复运行。仍非全量Minecraft：S2–S7内容/环境/全部生物/农业/运输等缺项留在coverage.json；精确Beta食物/耐久/快捷合成差异继续留账。长期docs更新CI边界与代码地图，架构/产品方向不变。此前peer没有提交代码或RED，本轮所有新实现与修复由本会话完成；其驻留假设已用本次实际证据推翻。

## S2a 建材与冶炼阶段

- 圆石掉落与玻璃遮挡先RED；新材料候选、燃料、半程恢复、正式Authority取得→冶炼→玻璃建造→保存恢复GREEN。当前test:classic:headless为5 files/5 tests，全部PASS；已有铁器成长按10秒冶炼新合同通过。
- 玻璃/木板网格2 tests通过；Rust/TS/control含玻璃混合场景6 tests通过；原始材质/资源和模型11 tests通过。物品图标缺失PNG先RED，改为注册像素生成SVG后图标兼容3 tests通过。材质透明度与表面参数现在消费同一面材质ID，21层完整。
- 完整生产C0–C5+玻璃放置PASS，runId 386c123e-bf47-4cff-b018-ba660518f34e，约1.9分钟，sourceDigest d6fad5e596eee3088d57cd0395d8dcf7d39e637c3d24639e9da904bbfa983335，artifactDigest 0796bb4e507309fc17e0882749fe0206e70922825a93bbd96c0ebc6870b585f3。HeadlessChrome153/macOS/WebGL2，页面异常/失败响应为空。九槽同一行几何断言通过；截图观察玻璃纹理和后方工作台均可见。单张最终图不作为运动或性能证据。
- 截图发现快捷栏仍为8列导致第9槽换行；改为读取slots.length后再次生产验证通过。玻璃第一次检查预期顶部，实际Shift右键命中侧面，修正坐标后通过；原始失败保留在harness/results。
- S2a verify:static:ci PASS。新增生产路径和文件未改变Kernel责任；长期docs baseline无需新增架构决策，代码地图沿用当前owner。全量S2/S3/S4–S7仍未完成。
