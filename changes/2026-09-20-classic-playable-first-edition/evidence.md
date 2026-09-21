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

## S2b 金钻矿与工具（实施中）

- RED：V5没有自然金矿/钻石、保存拒绝V5；金钻内容缺失和资源块压缩失败。V4固定深层chunk控制SHA-256 23048253e362d35e6375ad051512dcaf09e6aa883cec953e1fee8916aa3a997a 已在增加V5前通过（实际固定值以precious-ore-generation.test.ts为准）。
- 生成/旧存档定向6 tests PASS；金钻门槛/金镐拒绝高阶矿/耗尽移除/资源守恒与资源注册3 tests PASS。正式6个Classic合同7 tests PASS，有限材料从木石铁取得12钻石/12金矿并冶炼制作工具/资源块、保存恢复和拆回守恒；玻璃遮挡工位通过真实挖碎无掉落解除。
- 旧存档provider选择新回归从缺实现RED到2 tests PASS，另浏览器持久化18 tests PASS；继续不兼容身份报错，明确新建模式可另建V5。未实现跨Pack迁移，不宣称旧安装存档自动兼容。
- S2b 定向回归复跑 PASS：precious-ore-generation 2 + legacy-generator-save 4、classic-precious-tools 2、stored-world-selection 2、overworld-progression-journey 1（Headless 从有限原料到铁器+金钻工具与建造，含储物与半程恢复，29.8s）；wasm world-kernel 4 + mesh 6 + halo 2 + voxel-progression 4（四生成版本逐字节一致 16 tests）；item-visual-compatibility 3 + voxel-render-pipeline 2。
- V5 完整生产旅程 PASS：runId 89cca217-24b4-4058-87e7-ba3b5037fd20，C0–C5 全 PASS，约 1.9 分钟，新增第 8 步“V5金钻资源目录与真实钻石块建造”通过——真实拆玻璃后 Shift 右键放置 voxel 23（钻石块），并核对创造目录中金矿石/钻石矿石/铁块/金块/钻石块/金锭/钻石/金镐/钻石镐图标 naturalWidth>0。scenario.generatorVersion=5，sourceSha 638f389011c7c8666d59fdadace2d44a131629b0，sourceDigest bd8368f116269f1e93e84dbd1cbeaf45ca0b1baa73d78ba93854d9551be4c400，artifactDigest 89ad9cd97b6ebd35f68dc2517cf6977f8805c41cbc526d5fa5a90306999bb08a。HeadlessChrome/153、960×540、mute-audio，pageErrors/failedResponses 为空。
- S2b verify:static:ci PASS（格式含新增 stored-world-selection 测试、路径、Lint、全仓 typecheck、ESLint 边界 66 tests、CI 选择 8 tests）。全量 S3/S4–S7 环境、全部生物、农业、运输仍未完成。

## S2c 工具矩阵（斧/剑分级）

- RED：classic-tool-matrix.test.ts 断言 stone/iron/gold/diamond 斧与剑存在，`Unknown item: diamond-axe` 失败 3/3。
- 实现后 GREEN：斧（tier2/3/1/4，multiplier4/6/12/8，耐久132/250/32/1561）由 3 材料+2 木棍工作台合成，剑（melee 分级伤害 6/7/5/8 与二段 +2）由 2 材料+1 木棍合成；工具矩阵 3 tests、item-visual-compatibility 扩充图标 3 tests 全绿。
- test:classic:headless 现 7 files/10 tests PASS（含既有铁器/金钻成长、木板、食物、木棍与新工具矩阵）；gameplay-content-consumers 4 + registered-content 2 + gameplay-registered-combat 19 复跑 PASS，melee 注册未破坏。
- 生产构建 PASS：sourceSha ac377dd6f5ec59d918a33de74c5ac8d7873be7f8，sourceDigest 1bf7229485d54f6ec1751c1f9a871ef9caacad7a699eea07e07be563a81043ba，artifactDigest d45db8dd5bd051168c4ac6ab02d4a456b639394b413ee4baf87ea5befb1f9e61。coverage 将 I-258/267/272/275/276/279/283/286 标为 HEADLESS_PASS。斧/剑未做浏览器专项手势，仍非全量 Beta 附魔/合成变体等价；S3–S7 缺项继续保留。

## S2d 建材扩展（砂岩/石砖）

- RED：classic-building-blocks.test.ts 断言 sandstone/stone-bricks 存在，`Unknown item: sandstone` 失败。
- 实现后 GREEN：新增体素 Sandstone=24、StoneBricks=25 与材质 27/28（MATERIAL_LAYER_COUNT 28、terrainMaterials/textures 28）；4 沙→1 砂岩、4 石→4 石砖工作台合成，镐 tier1 采集掉落自身。voxel-progression、voxel-render-pipeline、wasm mesh/halo/world-kernel 逐字节一致复跑 PASS，Rust generation/mesh 指纹重建校验通过。
- test:classic:headless 现 8 files/11 tests PASS。生产构建 PASS：sourceSha bf71b4ec262caa4387fc165881988e5e57d34dd8，sourceDigest dd8d9f81b39ba77cc2250612ea22a1c48ed2dd0f7aa921e4df241a9a2dfc8154，artifactDigest c6e08a97e6ad005ec49cab87935560263a13f6af6ff271786feeda9537a4d058。coverage 将 B-024 砂岩标 HEADLESS_PASS。石砖属新增 Seedlands 建材（Beta 无 4 石→4 石砖直合成配方），砖块 B-045（红砖/黏土链）与半砖/楼梯变体仍未实现。
- 28 层材质版本完整浏览器旅程 PASS：runId b34d8a54-1422-4847-a1bc-899ae29316c5，C0–C5 全 PASS，约 1.9 分钟，sourceSha a025660d729f12d220edaac871b15fac8739b865，sourceDigest 57ea728ed757c018aaa885c4f4a41013d35ac2d4b1d99e79a94473798cb867ca，artifactDigest c6e08a97e6ad005ec49cab87935560263a13f6af6ff271786feeda9537a4d058，HeadlessChrome/153、mute-audio，pageErrors/failedResponses 为空。新增砂岩/石砖体素与 28 层材质未使既有采集/建造/NPC/保存旅程回归；本轮首帧曾偶发暂停面板拦截（85.5>0.65 超时）单例失败，第二次运行连续通过，保留原失败于 test-results。verify:static:ci PASS。

## S2e 铲工具族与软方块偏好

- RED：classic-shovel-tools.test.ts 断言 shovel 工具族存在与软方块 preferredTool='shovel'，`tool !== 'shovel'` 与旧 preferredTool 校验失败 2/2。
- 实现后 GREEN：MineItemCapability.tool 与 VoxelGameplayDefinition.preferredTool 扩充 'shovel'，mining-tool-policy 与 block-rules-module 接受该工具；新增木/石/铁/金/钻石铲（tier1/2/3/1/4，倍率2/4/6/12/8，耐久60/132/250/32/1561），1 材料+2 木棍合成，原创像素铲头模型。泥土(1)/草(2)/沙(6)偏好 shovel 且徒手仍可挖（倍率1），铁铲给倍率6，铲对石类不满足门槛。
- 定向：shovel-tools 2 + tool-matrix 3 GREEN；mining-tool-policy 20 + block-rules-definition 17 + item-visual-compatibility 3（图标扩至含 5 铲）复跑 PASS；combat 19 + content-consumers 4 无回归。
- test:classic:headless 现 9 files/13 tests PASS。铲工具族未做浏览器专项手势，软方块采集加速纯逻辑证明；泥土/草/沙徒手可挖保持向后兼容，未改既有旅程。

## S2f 食物链（熟食与冶炼）

- RED：classic-food-chain.test.ts 断言苹果/面包/生熟猪排/生熟鱼存在并可消费冶炼，`Unknown item` 失败 2/2。
- 实现后 GREEN：新增 food 物品 apple/bread/raw-porkchop/cooked-porkchop/raw-fish/cooked-fish 与 wheat 资源，healthRestore 分级（苹果4/面包5/熟猪排8/熟鱼5），受伤进食按 maxHealth 夹取、满血满饥饿拒绝；熔炉新增 cook-porkchop/cook-fish 配方（生→熟），面包由 3 小麦合成。acceptsPixelItem 扩含 'food'，新增原创像素图标（苹果/面包/肉排/鱼/小麦），raw-iron 图标改用 iron-ore 地形贴图修正缺失绑定。
- 定向：food-chain 2、asset-workbench 4、item-visual-compatibility 3、gameplay-content-consumers 4 复跑 PASS；test:classic:headless 现 10 files/15 tests PASS。coverage 将 I-260/297/319/320/349/350 与 R-S07/R-S08 标 HEADLESS_PASS。饱食度/饥饿自然消耗仍关闭（Classic 保留），未做浏览器进食专项；金苹果/蛋糕/蘑菇煮等复合食物与农业生长链未实现。
- S2f 完整浏览器旅程 PASS：runId 1995e310-9323-40c4-a2c4-0112754c4daa，C0–C5 全 PASS，约 2.0 分钟，sourceSha bc0673ac3ffef25cc8f3268f911d41040dd7c0fb，sourceDigest df8f604be564654aed535331901bc05384cbbfd705d3285281f89d6e8e8e8f61，artifactDigest 90dbe9dd44b3fb8343342a968a3546e20844073b00048d05263d2a90a3112eb9，HeadlessChrome/153、mute-audio，pageErrors/failedResponses 为空。新增食物物品与像素图标未使既有采集/建造/进食/NPC/保存旅程回归。verify:static:ci PASS（含新增 food-sprite/pixel-sprite 拆分，pixel-item-art 回落 500 行内）。

## S5a 锄工具族与耕地

- RED：classic-hoe-farmland.test.ts 断言锄工具族与 till 能力/Farmland 体素存在，`capability('till')` 与 Voxel.Farmland 缺失失败。
- 实现后 GREEN：ItemCapability 增加 'till' 类型；新增木/石/铁/金/钻石锄（2 材料+2 木棍合成，耐久 60/132/250/32/1561），新增体素 Farmland=26 与材质 29（MATERIAL_LAYER_COUNT 29、terrainMaterials/textures 29）。till-policy 把泥土/草转耕地并耗 1 耐久、耐久归零移除，对石类与非锄工具明确拒绝。锄头像素刃模型、图标与 blockItems/farmland 地形贴图接入。
- 定向：hoe-farmland 2、voxel-progression 4、item-visual-compatibility 3、asset-workbench 4、wasm-mesh-equivalence 6 复跑 PASS，Rust generation/mesh 指纹重建校验通过；test:classic:headless 现 11 files/17 tests PASS。coverage 将 B-060 耕地与 I-290..294 锄标 HEADLESS_PASS。作物种子/生长/收割状态机与浏览器耕作手势未实现，留待 S5b。
- S5a 完整浏览器旅程 PASS：runId 690309ae-2580-4909-9b27-5d49d9902541，C0–C5 全 PASS，约 1.9 分钟，sourceSha 447c027a57d202c4b70cc7a85a89bba220d5fad8，sourceDigest 131a49da841ca29aae30a8a9dccef41277bcd53a8e29412fb337c46207a281e2，artifactDigest db6ef1f933e07ad7e97c99bde9f09f8ff72c49313d382eee6e6445b635244214，HeadlessChrome/153、mute-audio，pageErrors/failedResponses 为空。新增锄工具族与耕地体素、29 层材质未使既有旅程回归。verify:static:ci PASS。

## S5b 作物种植与生长收割

- RED：classic-crop-growth.test.ts 断言小麦种子内容、种植/分阶段生长/收割存在，crop-growth-policy 缺失导入失败。
- 实现后 GREEN：新增 wheat-seeds 内容与像素图标；crop-growth-policy 定义八阶段确定性状态机——种子只种耕地(Voxel.Farmland)，按 secondsPerStage 分阶段生长且累计余量、封顶成熟阶段 7；成熟收割产 wheat+wheat-seeds，未成熟只回收种子，非法阶段/非耕地明确拒绝。
- 定向：crop-growth 3、asset-workbench 4、item-visual-compatibility 3 复跑 PASS；test:classic:headless 现 12 files/20 tests PASS。coverage 将 B-059 小麦作物、I-295 种子、I-296 小麦、M23-02 生长机制标 HEADLESS_PASS。作物尚未接入体素渲染与浏览器真实耕作/播种/收割手势，自然种子掉落（破坏草）未接；这些留待后续 S5c 与体素作物阶段。verify:static:ci PASS。

## S3a V6 洞穴雕刻

- RED：cave-generation.test.ts 断言 generatorVersion 6 掏空气穴、V5 字节冻结、v7 拒绝，caveAir 缺失导入失败。
- 实现后 GREEN：新增 cave-generation.ts 确定性洞穴——V6 起在地表 4 格以下按 2x2x2 分组双哈希场相交掏空为 Air；V2–V5 逐字节冻结（V5 深层 chunk SHA-256 23048253… 不变）。GENERATOR_VERSION→6，SUPPORTED 扩到 [2..6]，Classic worldgen identity 升 6.0.0/g2-g6。Rust generation.rs 同步 cave_air 并在 column_voxel 掏空，TS/Rust/staged 三路逐字节一致。
- 定向：cave-generation 4、precious-ore 2、legacy-generator-save 5（含 V6）、wasm world-kernel 4 + halo 2 + mesh 6、voxel-progression 4 复跑 PASS，Rust 指纹重建校验通过；test:classic:headless 12 files/20 tests PASS（scenario 升 V6）。coverage 将 M03-02 洞穴机制标 HEADLESS_PASS。洞穴连通性度量、地牢与液体填充留待 S3b。
- S3a 完整浏览器旅程 PASS（V6 世界）：runId e1e06e29-90b7-4d64-8bd2-d68170890d55，scenario.generatorVersion=6，C0–C5 全 PASS，约 2.0 分钟，sourceSha e2e6e2416e3d2a3f17118f591d09cfafbe82618a，sourceDigest ae72b97a8f2eadf24e2077e84534b03a47d8cf67692a33865b30b8cee3a4726c，artifactDigest cce57b42cfe4f4109fade2aa4922258066228295bab22ee5cdf3a90e68559867，HeadlessChrome/153、mute-audio，pageErrors/failedResponses 为空。V6 洞穴与首屏 v6 标签未使既有采集/建造/NPC/保存旅程回归。verify:static:ci PASS。

## S3b 矿脉分布度量

- ore-vein-distribution.test.ts 以固定 seed 扫描表征既有 V5 矿脉：确认深度门槛（钻石 y<16 且表下≥12、金 y<32 且表下≥8、铁表下≥8、煤表下≥4）、生成次序（钻石/金优先于铁再煤）、稀有度递减（diamond<gold<iron<coal），浅层无矿；同参数 V5 与 V6 oreVoxel 输出一致（V6 洞穴不改矿脉分布）。3 tests PASS。coverage 将 M03-03 矿脉机制标 HEADLESS_PASS。这是对既有生成的确定性度量，非新算法；矿脉聚簇形态与真实 Beta 矿脉大小分布未逐一对齐。

## S4a 护甲与伤害减免

- RED：classic-armor.test.ts 断言护甲物品/armor 能力/armorDamageReduction 存在，itemType 'armor'/capability 缺失失败。
- 实现后 GREEN：ItemCapability 增加 'armor'（slot+points），itemType 扩含 'armor' 且允许护甲耐久；新增皮/铁/金/钻石四套头盔胸甲护腿靴（16 件+皮革资源），点数按 Beta 布局（钻石胸甲 8 等），工作台按 5/8/7/4 材料合成带耐久。armor-policy 每点减伤 4%、封顶 20 点（80%）、不为负、空甲不减、非法输入拒绝。新增 armor-sprite 原创像素图标，acceptsPixelItem/contracts.itemType 扩含 armor。
- 定向：classic-armor 3、asset-workbench 4、item-visual-compatibility 3 复跑 PASS；test:classic:headless 13 files/23 tests PASS。coverage 将 I-298..301/306..317/334 共 17 项标 HEADLESS_PASS。护甲穿戴槽 UI 与战斗结算实际接线（把 armorDamageReduction 挂到 melee applyDamage）留待 S4b；未做浏览器穿戴专项。verify:static:ci PASS。
- S4a 完整浏览器旅程 PASS：runId c4911daa-f303-48f8-a361-480010b238be，C0–C5 全 PASS，约 1.9 分钟，sourceSha 3b70e5b16cbafb0286ecede55d62d087c8a5278a，artifactDigest 914d7f76f922090bf8eaf2a333de489a2775c73b21ca7442242d67d7c62237e5，HeadlessChrome/153、mute-audio，pageErrors/failedResponses 为空。新增 17 件护甲物品与像素图标未使既有旅程回归。
