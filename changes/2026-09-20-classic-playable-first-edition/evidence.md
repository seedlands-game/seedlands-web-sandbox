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

## S5c 钓鱼、鸡蛋与奶桶

- LifeSkillsRuntime 保存鱼钩序列、位置、剩余等待和咬钩状态；水面与八格距离由已加载 voxel 验证，收杆成功才发放生鱼并扣钓鱼竿耐久，背包满或换杆不吞奖励。
- 鸡蛋只投向已加载、上方空气且下方可站立的位置，稳定每第八次孵化鸡并在生成容量/ID 冲突前不扣物品。奶牛五格内把选中空桶替换为奶桶，饮用后恢复空桶。新增 fishing-rod/egg/milk-bucket 与配方、原创像素资源。
- life-skills、asset-workbench、snapshot migration 共 3 files / 28 tests PASS；通用 snapshot 使用纯 validator 校验 LifeSkills checkpoint，旧 V4 缺字段迁移为空状态。浏览器抛竿/浮标表现仍待 S7。
- 提交前复验：`verify:static:ci` PASS（Prettier、路径、ESLint、全仓 typecheck、ESLint 66、CI selector 8）；LifeSkills/资产/迁移 28 tests PASS。实现前曾发现 lifecycle 文件把 PlayerState 错作 type-only import，导致创建玩家抛 ReferenceError，已改回运行时 import并保留失败记录。

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

## S6a 实用与运输物品

- RED：classic-utility-items.test.ts 断言碗/桶/剪刀/矿车/船与矿车变体存在并可合成，物品缺失失败。
- 实现后 GREEN：新增 bowl/bucket/shears/minecart/boat 与 chest-minecart/furnace-minecart（含皮革资源已在 S4a），工作台配方：碗 3 木板出 4、桶 3 铁锭、剪刀 2 铁锭带耐久 238、矿车 5 铁锭、船 5 木板；矿车+箱子/熔炉升级为变体。新增 utility-sprite 原创像素图标并接入 asset 目录。
- 定向：utility-items 2、asset-workbench 4、item-visual-compatibility 3 复跑 PASS；test:classic:headless 14 files/25 tests PASS。coverage 将 I-281/325/328/333/342/343/359 标 HEADLESS_PASS。矿车轨道物理/骑乘、桶的流体拾取放置、剪毛交互未实现（S6b/环境流体阶段）。verify:static:ci PASS。
- S6a 完整浏览器旅程 PASS：runId 8c3d212b-41d1-49fa-8eda-81b3d9c681b7，C0–C5 全 PASS，约 1.9 分钟，sourceSha ccd2e7daed593d9438c989b94818740eb7f90a36，artifactDigest bdc8fc7130d02adb55448999c9f5310dbb86a9640e9e70fbdd85db5b7a79136e，HeadlessChrome/153、mute-audio，pageErrors/failedResponses 为空。首帧曾偶发暂停面板拦截（85.5>0.65）单例失败，第二次连续通过，原失败保留。新增运输/实用物品未使既有旅程回归。

## S6b 轨道与载具状态

- 追加 Rail/PoweredRail/DetectorRail 体素39–41和材质42–44，不改 V8 程序生成；轨道为可选择非实心方块，Web/Rust mesh 材质闭包和三种原创轨道纹理已接入。连接解析只读已加载相邻轨道，支持东西/南北与四向一格坡道。
- VehicleRuntime 保存 minecart/chest-minecart/furnace-minecart/boat 的位置、速度、方向、燃料、唯一乘员和箱车27格库存；动力轨/燃料加速、普通轨摩擦、DetectorRail 占用、船水面、上下车安全点与玩家位置同步均有确定性入口。鞍猪原子扣鞍并复用同一乘坐记录。
- Rust source/artifact fingerprint PASS；vehicle/palette/asset/snapshot 4 files / 34 tests PASS；Wasm mesh/world 等价 2 files / 10 tests PASS；`verify:static:ci` PASS。浏览器载具模型、真实驾驶输入与碰撞反馈留待 S7，不在本段宣称视觉完成。

## S6c 指南针、时钟与地图

- RED：新增定向测试 3/3 失败，分别证明 paper/redstone-dust/compass/clock/map 内容与配方、NavigationItemsRuntime、地图物品均缺失。实现中曾误用不存在的 recipe `require` 和通用 actor access 读取 player state，修正为 `get` 与 player 专用 ECS access；测试把时钟推进至30后未复位触发既有快照0–24小时合同，属于夹具状态错误，已复位后保留有效断言。
- GREEN：注册纸、红石粉、指南针、时钟和地图及四条配方；指南针读取保存出生点并输出稳定归一角，时钟将主世界时间归一为昼夜相位。每世界 NavigationItemsRuntime 只在玩家选中地图时采样已加载 9×9 窗口，支持0–4缩放、稳定颜色和 map id；未知格不猜测，缩放改变清空旧比例像素。
- 地图序列、中心、缩放和像素进入可选 Gameplay V4 checkpoint；校验 id 高水位、唯一玩家/地图、像素坐标和颜色范围，并在安装实体前验证关联玩家。特殊物品/快照/资产 3 files / 29 tests PASS；连同载具回归为4 files / 33 tests PASS。`verify:static:ci` 首次因 gameplay-snapshot 502行失败，未加豁免，抽出 legacy 坐标迁移模块后最终 PASS（snapshot 497行、Svelte 0/0、ESLint 66、CI selection 8）。动态图标与手持地图浏览器画面留待 S7。

## S5d 农业运行时

- RED：classic-crop-runtime 3/3 因 `world.crops` 缺失失败。GREEN 后 CropRuntime 成为每世界 owner：选中种子只在已加载耕地及上方空气种植并原子扣种；重复/未知位置零提交。seed+tick+坐标稳定抽样只推进已加载、水化作物，成熟封顶；收割先在临时背包验证全部产物容量，再提交库存并移除作物。
- crop runtime/pure growth/snapshot migration 共3 files / 28 tests PASS，覆盖阶段7成熟、保存恢复与非法请求。checkpoint 为 V4 可选字段，旧档恢复为空。`verify:static:ci` 两次先后因 gameplay-snapshot、gameplay-runtime 增长越过500行失败；未加豁免，分别抽出 legacy 坐标迁移并压缩既有 facade，最终静态门禁 PASS。作物网格模型、自然草种掉落和浏览器手势仍留 S7。

## S2g 便携内容与配方闭包

- RED：portable-content 2/2 因 flint-and-steel 等物品和 book 等配方缺失失败。GREEN 后补齐打火石、蘑菇煲、画、金苹果、告示牌、木门、雪球、红砖、黏土、书、糖、蛋糕、曲奇、可可豆和两张唱片；全部进入 Classic registry 与原创像素资产目录。
- 补齐纸、书、羊毛、画、金苹果、告示牌、木门、糖、蛋糕、曲奇和打火石材料配方；cookie 实际合成验证材料扣除、8个输出和缺料不提交。portable/asset/visual 共3 files / 9 tests PASS，`verify:static:ci` PASS。首次静态检查因 items.ts 507行失败，拆出 portable-items.ts 后通过，未加豁免。RecipeRegistry 仍是无形配方，故覆盖项只记 PARTIAL/HEADLESS，不宣称原版网格摆位等价。

## S3j V9 基础地质

- RED：V8 固定深层区块 SHA-256 `23048253e362d35e6375ad051512dcaf09e6aa883cec953e1fee8916aa3a997a` 保持，但 V9 基岩与其余新材料均不存在，2/2 失败。首版全域逐体素扫描耗时约56秒，改为直接测试纯 geology 层的有限固定输入，避免把昂贵探测留进 CI。
- GREEN：V9 追加 Bedrock/Gravel/LapisOre/Clay/Ice/SnowBlock/LapisBlock 稳定体素42–48与材质45–51。基岩限定最低五层；砂砾/青金石替换符合深度的石层；黏土只出现在水域浅层；寒冷水面结冰且积雪下形成雪块。V2–V8 原输出不变，Classic worldgen identity 升 `9.0.0/g2-g9`。
- Rust source/artifact fingerprint PASS；stdlib 地质/洞穴/矿物/旧存档4 files / 16 tests PASS；Web palette、TS/staged/Rust/Wasm generation、halo、mesh 与资产6 files / 22 tests PASS；`verify:static:ci` PASS。新增基础材料均有采集规则、放置物品与原创纹理，黏土→砖、雪球→雪块、青金石块压缩/拆解配方闭包已接入。

## S1a 非整格结构方块

- RED：structural voxel model 首次因所有目标 Voxel 未定义、模型为空失败。GREEN 后追加 Slab/WoodStairs/CobblestoneStairs/WoodenDoor/Ladder/Torch/Bed/Sign/Fence/Cake 体素49–58与材质52–61；三种轨道同时改为薄片模型。共享 voxel-model 提供局部模型盒、碰撞盒和整面遮挡判断，梯子/火把/牌/轨道无角色碰撞。
- Rust descriptor 从只识别灯笼改为携带 voxel id 的通用 model record；TS control 与 emitter 同步消费 modelBoxesForVoxel。stdlib model/physics 3 files / 18 tests PASS；Web palette/Wasm mesh/item mesh/asset/render/content 6 files / 21 tests PASS；Rust artifact fingerprint 与 `verify:static:ci` PASS。
- 问题记录：资产闭包先暴露床仍是 resource、蛋糕仍被 pixel adapter 接受，以及模型方块物品沿用旧像素模型；统一改为原 item identity 的 place capability，并让 placed voxel 强制使用 builtin voxel model。voxel.ts 达503行触发门禁后抽出 face-material-names 模块，未加豁免。方向、门开合/双格、床双格、牌文本与蛋糕切片仍为明确差异。

## S1b 既有 owner 证据补账

- stdlib 库存布局/指针模型/furnace candidate/station content/station snapshot/item instance 共6 files / 25 tests PASS；Web 采掘、库存交互、工作台指针、方块工位、Classic 冶炼、床重生和浏览器指针手势共7 files / 33 tests PASS。
- 工作台指针最初3项失败：旧夹具仍把5木板摆成木镐，与现行3木板+2木棍 shaped 配方不符；修正投料后2项恢复。剩余投影断言把“满包但空/兼容游标可接产物”误写为不可合成，改为 craftable 后8/8通过。未改生产配方或 owner。
- 据此 M08-01/02/03、M16-01/02/03、M17-01/02/03、M18-01/02、M19-02、M24-01/02/03 升为 PARTIAL_IMPLEMENTED / HEADLESS_PASS；仍缺的破坏视觉反馈、蛋糕桶余物、燃烧态音画、双箱与睡眠跳夜继续保留。

## S1c 多格结构、睡眠与点火

- RED：classic-structure-interactions 3/3 因 StructureInteractionRuntime 缺失失败。GREEN 后门与床先验证玩家、距离、两个已加载可替换目标和自身碰撞，再经一次 editBatch 写入，成功后扣选中物品；夜间床使用写安全重生点并经注入 world-time 端口跳到清晨；白天拒绝。打火石只对已加载空气登记 Environment 火并扣一耐久。
- structure/difficulty/environment 共3 files / 11 tests PASS；`verify:static:ci` PASS。GameplayRuntime 再次超过500行，抽出 requireGameplayPlayer 并收敛 facade 后通过，未加豁免。M09-02/03 与 M19-02 更新为 PARTIAL/HEADLESS；画/牌跨格、门开合朝向和完整 use 优先级仍未完成。

## S2h 剩余主世界方块与 V10 红石矿

- RED：remaining-blocks 2/2 因 dead-bush 等内容和 RedstoneOre/LitFurnace 体素缺失失败。GREEN 后追加 59–73 方块与 62–76 材质，覆盖枯灌木、羊毛、红花/红蘑菇、砖块、书架、苔石、音符盒、唱片机、南瓜/南瓜灯、活板门、燃烧熔炉、红石矿/发光红石矿；配套物品、掉落、制作配方和原创纹理闭包已接入。
- V10 只在低层深石生成红石矿，V9 不生成；V2–V9 兼容版本继续支持。stdlib V9冻结/V10红石/洞穴/矿物/旧存档4 files / 18 tests PASS；Web TS/staged/Rust/Wasm/palette/content/asset 6 files / 22 tests PASS；Rust fingerprint 与 `verify:static:ci` PASS。
- 问题记录：FaceMaterial 补丁曾重复键，清理后通过；wool-block 和 JackOLantern 的自动纹理名与稳定 item id 不一致，分别增加显式路由/兼容名。voxel.ts 与 items.ts 超500行后抽出 remaining-voxel-presentation 和 remaining-block-items，未加豁免。音符盒/唱片机/活板门/发光矿状态机仍只记 PARTIAL。

## S2i 配方矩阵收口

- RED：recipe-closure 2/2，缺砂岩/木半砖、16色羊毛物品与配方，以及仙人掌/钻石矿冶炼。GREEN 后新增 recipe-closure-items，补齐半砖、蘑菇煲、花/骨/墨囊/可可豆基础染料、九组混色染料、16色羊毛与配方，并新增仙人掌→绿色染料、钻石矿→钻石熔炼。
- recipe closure + asset 2 files / 6 tests PASS，`verify:static:ci` PASS。items.ts 再次越过500行，移出结构物品到 recipe-closure-items 后通过。S2 所有 scope=做 条目已至少获得 Headless 证据并清零 NOT_RUN；无形 RecipeRegistry、颜色羊毛非独立体素元数据和原版摆位细节继续标 PARTIAL，不冒充精确等价。

## S3/S4 owner 证据补账

- S3 地牢生成、Chunk residency、fluid lease、Authority entity physics 与 ground navigation 共5 files / 32 tests PASS。M05-01/02、M06-01/02/03 更新为 PARTIAL/HEADLESS；浏览器雾和远景顺序仍待 S7。
- S4 物理/可达性/导航共5 files / 53 tests PASS；实体/感知/Combat/projectile/hostile/body registry 共10 files / 48 tests PASS。玩家、掉落物、船、矿车三型、鱼钩和鸡蛋实体，以及 M14-01/02/03、M15-01、M21-01..05、M22-01..03 更新为 PARTIAL/HEADLESS。
- 失败记录：registered-combat 独立回归有6项因旧 fixture 缺 seedlands.combat/mode resource 失败，未用作本轮通过证据；替换为 prepared combat 与 gameplay foundation owner 测试。后者旧断言仍固定19物品、浆果只补饥饿、木剑仅2木板，更新为完整194物品、healthRestore=4和2木板+1木棍后12/12通过，未改生产实现。

## S4b 弓箭与权威投射物（部分完成）

- RED：classic-projectiles.test.ts 首先因公开 projectile-runtime 缺失失败；只读沙箱内首次执行另有 Vitest 写 .vite-temp 的 EPERM，授权后取得有效 RED，不将环境错误算成功能证据。
- GREEN：弓/箭/线/羽毛/燧石、配方及原创像素资源接入；ranged 内容注册校验弹药闭包和正数参数。正式 fireSelectedRangedItem 缺箭保持库存与投射物不变，成功扣 1 箭和 1 弓耐久并生成稳定 projectile id。
- projectile-runtime 定向证明归一化速度、稳定顺序、连续线段最早命中、同距体素遮挡优先、actor 命中只伤害一次、寿命销毁，以及 checkpoint 恢复后位置/剩余寿命延续且 id 高水位不重用。classic-projectiles 5 tests + asset-workbench 4 tests PASS。
- pnpm test:classic:headless PASS：15 files / 30 tests，含有限资源成长和保存。pnpm verify:static:ci 第一次在 5 个新增文件格式检查失败；格式化后第二次触发 pixel-item-art 504>500 行边界；拆出 utility kind 判定后最终 PASS（Svelte 0 errors/warnings、ESLint 66 tests、CI selection 8 tests）。
- 当前只记 PARTIAL_IMPLEMENTED / HEADLESS_PASS：尚未把 projectile owner 纳入 GameplayRuntime 总快照与浏览器输入/表现/音频，也未完成自然材料掉落。问题保留并继续在 S4/S7 收口。
- 绑定提交 48be04563afd911bf66a64991c4eede50ad1d680 的 production build PASS：sourceDigest c9eabfd3bc88aa176fbf01fae3b103294d825d9545f47bf9ec287820a53ad455，artifactDigest 53e9e89220b964d70458f1a94cbd9408db7e6e398ef116f38a7125d0b3f07e9b。唯一 Chromium 回归 PASS：runId 447dee2a-8cfe-46ce-89f4-658f36447111，C0–C5 及现有玻璃/金钻资源目录场景全部通过，约 2.0 分钟；该回归证明既有生产旅程未退化，不证明弓箭浏览器操作已接入。
- S4b owner 续作：GameplayRuntime 现持有唯一 ProjectileRuntime，正式 ECS inventory 发射成功才提交 revision；已加载体素与实体 AABB 决定最早命中，伤害复用正式 combat/vitals 路径。在途箭与 id 高水位进入 V4 可选 snapshot 字段，旧 V4 缺字段恢复为空。Classic projectiles 6 tests PASS，包含 Runtime 发射、保存、恢复、命中僵尸与弹药不重复。GameServer façade 已暴露发射方法；浏览器动作协议、准星方向和表现仍在 S7 收口前保持 PARTIAL。

## S4c 主世界物种 profile 与基础 AI（部分完成）

- RED：classic-species 首先因错误装配 API 失败，修正为既有 assembleWorldPacks 后取得有效 RED `Unknown actor profile: chicken`。
- GREEN：新增 chicken/cow/pig/sheep/squid/wolf/zombie/skeleton/spider/creeper/slime 独立 archetype；profile 含差异生命、导航、感知、passive/neutral/hostile disposition、近战定义与掉落。旧 grazer/night-stalker/settler 身份保留。协议投影、pose、消息语义、命令、保存验证与身体配置扩展闭包。
- 数据驱动 AI：PerceptionRuntime 和 Logic Worker 按 profile disposition 判断敌我；zombie 夜间攻击玩家、cow 遇敌移动避让正反例通过。新增 wool/ink-sac/rotten-flesh/bone/gunpowder/slimeball 内容与原创像素资源。
- 定向回归：Classic profile/生成/资源 12 tests、stdlib 网络协议/身体 36 tests、logic-decision 9 tests PASS；全仓 typecheck PASS；test:classic:headless 16 files / 32 tests PASS；verify:static:ci PASS（Svelte 0/0、ESLint 66、CI selection 8）。
- 失败记录：静态门禁先拒绝 physics→server/gameplay 反向依赖，已改为 physics 自有配置 key 校验；测试类型随后拒绝私有 gameplay facade，已改用公开 queryEntities/simulationSnapshot。各物种专属机制和模型仍未实现，因此实体项只可记 PARTIAL_IMPLEMENTED。
- S4c/S5 动物状态续作：ECS actor component 增加可选 SpeciesStateV1，保存羊已剪/毛色、狼主人/坐下/驯服尝试、猪鞍和史莱姆尺寸；旧 snapshot 按 archetype 迁移默认状态。剪羊毛以一个 prepared mutation 同时扣剪刀耐久、发放 2 羊毛并置已剪；无剪刀、重复剪和满库存零提交。狼每次稳定尝试消耗一根骨头，成功后只有主人可切换坐下。迁移/ECS/交互 3 files / 29 tests PASS。染料物品与染色操作、羊毛再生仍未实现，M25-03 保持 PARTIAL。
- M25-03 续作：补齐 16 色染料内容与原创像素资源，羊染色原子扣除选中染料并保存 woolColor；显式吃草入口只对已剪羊恢复羊毛，颜色不丢失。资产闭包同时发现 S3i loot 中的 saddle 缺表现绑定，补齐原创鞍图标。animal interactions 3 tests 与 asset-workbench 4 tests PASS；自然吃草 AI 尚未接入，因此该项仍记 PARTIAL。
- S4g 敌对机制续作：骷髅由权威位置向目标发射同一 ProjectileRuntime 弹道；苦力怕通过带 sourceEntityId 的 Environment TNT 保存引信并在爆炸时清退源实体，重复点燃拒绝；尺寸4/2史莱姆清退前验证子 ID 与实体容量，再生成两个稳定下一尺寸实体，尺寸状态进入 ECS snapshot。hostile mechanics、environment 与 snapshot migration 3 files / 27 tests PASS。自动 AI 触发这些专属动作仍待调度层接线。

## S4d 难度、床与重生点（部分完成）

- DifficultyRuntime 提供 peaceful/easy/normal/hard、0/0.5/1/1.5 伤害倍率、单调 revision、旧 revision 拒绝与 checkpoint；V4 gameplay snapshot 用可选字段兼容旧快照，缺省 normal。GameplayRuntime 对 hostile 伤害应用倍率，切 peaceful 按稳定 ID 清退 hostile actor 并取消其现有状态，保留 passive/neutral。
- 床以3木板+3羊毛合成并有原创像素资源；选中床后只接受安全空气落点，将床边位置写入既有 ECS spawnPosition，死亡后正式 respawn 移动到该点，快照迁移 22 tests 与组合行为 5 tests PASS。
- test:classic:headless 17 files / 37 tests PASS；verify:static:ci 最终 PASS。失败记录：utility-sprite 联合类型分号语法错误由 Prettier 捕获；gameplay-runtime 超 500 行门禁触发，未加豁免，改为抽取 gameplay-survival-settings 并收敛现有 facade。
- 当前只记部分完成：床双格放置/夜间睡眠跳时、难度 UI、出生保护与护甲穿戴结算仍待后续。

## S4e 装备槽与护甲正式结算

- ECS equipment 扩展四个 armor slot；旧 V4 缺字段恢复为空甲，新快照保存完整耐久实例。选中护甲与对应槽原子交换，护甲点进入 GameplayRuntime 正式伤害路径，成功受伤后各装备扣 1 耐久，归零移除。
- 铁胸甲 6 点把 10 点伤害降到 7.6，snapshot 恢复后继续扣耐久并破损；创造模式免伤不磨损，非法伤害沿用旧失败结果，死亡目标拒绝重复伤害且护甲不变。armor 6 tests + snapshot migration 22 tests PASS；test:classic:headless 17 files / 39 tests PASS。
- 静态门禁曾拒绝 ecs-actor-state 与 gameplay-runtime 超 500 行；通过抽取 ecs-actor-armor-state、player-break-action-codec、gameplay-survival-settings 和收敛 facade 解决，未增加豁免；verify:static:ci 最终 PASS。无敌帧、击退和装备 UI 仍留待 S4/S7。

## S4f 确定性刷怪策略（部分完成）

- spawn-policy 以 seed/tick/position 哈希、亮度、距玩家、难度、群系和类别上限筛选并按权重稳定选择；hostile 在 peaceful 禁止且要求低光，passive 要求日间亮度，24 格内与达到上限拒绝。非持久且未驯服实体仅在玩家 128 格外允许清退。
- classic-spawning 2 tests PASS，覆盖同输入稳定、hostile/passive 分流、peaceful/距离/上限负例及 persistent/tamed 豁免。当前 GameplayRuntime 缺统一光照/群系查询端口，未接自然刷新循环；M20 三项只记 PARTIAL_IMPLEMENTED / HEADLESS_PASS，待 S3 环境补端口后收口。
- S4f 续作：Classic actor profile 现携带权重和群系，Gameplay 规则时钟每 20 秒从 seed/tick/player 派生排序候选列，仅通过 `getLoadedVoxel` 检查完整地表列后调用既有光照/难度/距离/类别上限策略；未提供加载查询的宿主不启用且不扫描世界。刷新相位和 tick 进入 Environment checkpoint，旧快照缺字段迁移为空；取整后候选半径收紧为 26–32，保证欧氏距离不越过 24 格门禁。classic-spawning 4 tests PASS，含 19 秒保存、恢复后 1 秒生成。

## S3c 既有水流证据补账

- 复核现有 owner 后确认水源标志0x80、流级1–8、向下/水平传播、源移除回缩、固定顺序、有界 frontier、lease失败回收、跨Chunk一跳依赖与未知邻区延迟、chunk fluid sidecar保存/恢复均已有生产实现。
- 定向复跑 fluid-transaction 21、voxel-fluid-runtime 14、chunk-snapshot-codec 7、water-mesh 6、water-immersion 5、water-flow-direction 2，共6文件55 tests PASS。M10-01/M10-04升级 IMPLEMENTED+HEADLESS_PASS；M10-03仅 PARTIAL_IMPLEMENTED，因为桶取放、窒息、熔岩燃烧仍缺。

## S3d 熔岩与混合基础（部分完成）

- 追加稳定 Voxel.Lava=27、Voxel.Obsidian=28 与 FaceMaterial 30/31；旧 0–26 palette 和 generatorVersion 2–6 生成字节不变。Lava 当前为 emissive 全格材质，Obsidian 为不透明方块；黑曜石需 diamond tier 镐并掉落自身。新增 lava-bucket/obsidian 内容与原创资源。
- fluidReaction 以 voxel id 判定种类，复用既有 sidecar source bit/level：水接 lava source 生成 Obsidian，水接流动 lava 生成 Cobblestone，输入顺序无关。fluid reaction 2 + mesh/chunk codec 23 + voxel/Wasm/resource 14 tests PASS。
- 当前只记 PARTIAL_IMPLEMENTED：Lava 尚未进入 FluidTransactionAuthority 传播/冷却节奏，混合尚未作为 read-set 候选提交，桶拾取/放置未接，Lava 液面仍是全格材质。
- 续作已将 FluidTransaction 的 cell/place/suppliedLevel 参数化为 Water/Lava kind：水水平衰减1，熔岩水平衰减2，垂直流保持8；异种水平邻接时 lava source→Obsidian、flowing lava→Cobblestone。candidate validator 只允许 Air/Water/Lava/合法混合产物，world edit、chunk load 与 sidecar source/remove 均激活两种流体。
- Rust fluid kernel 同步相同 kind/decay/reaction，并重建 scalar/SIMD artifact；含随机 lava/水邻接的 TS↔Rust 逐字段对等 1 test PASS，Water/Lava Authority 36 tests PASS，verify:static:ci PASS。全仓 rustfmt 会改动既有 codec/generation/mesh/tests，本轮仅格式化修改的 fluid.rs；这不是功能失败。
- M10-02 仍保留 PARTIAL：传播与混合已接线，但独立较慢 cadence、桶交互、燃烧伤害和 Lava 专用液面视觉仍待后续。
- S3d 桶续作：新增 fluid-container capability；空桶只拾取 level8+source 的 Water/Lava，换成 water-bucket/lava-bucket；满桶只在 replaceable 目标放 source 并换回空桶。BlockInteractionRuntime 复用距离校验、临时 Inventory 和 PreparedWorldEdit，双方先验证再提交。流动 level7 拒绝且世界/库存逐值不变。classic-fluid-buckets 3 tests、全仓 typecheck 与 verify:static:ci PASS。修复遗漏的 GameServer.edit/getFluidCell/chunk activation water-only 分支。

## S3e 天气、火与 TNT（部分完成）

- EnvironmentRuntime 按 world seed + tick 确定 clear/rain/thunder 转换与持续时间，保存 weather/tick、火列表、TNT稳定id高水位和在途引信。火每4 tick至多向一个邻格扩散，仅空气且邻近Wood/Leaves/Planks/TNT可点燃；雨/雷且露天时熄灭。
- TNT 到期产生坐标稳定的有界球形候选，GameplayRuntime coordinator 经唯一 editBatch 清除可破坏方块；对玩家按距离衰减伤害并写击退 velocity，环境中途 snapshot 恢复后继续引信。Fire=29/TNT=30、材质32/33与原创纹理接入，TNT 以5火药+4沙合成。
- classic-environment 3 + gameplay snapshot migration 22 tests PASS，全仓 typecheck PASS。当前只记 PARTIAL：点火物品/浏览器交互、链爆、非玩家实体爆炸伤害、跨 owner 原子提交、雷击落点与雪仍待实现。

## S3f 权威光照查询与自然刷怪入口（部分完成）

- LightSampler 由 worldTime 确定0–15天空光，逐格检查至世界顶的已加载遮挡；未知格返回 null。Glowstone/Lantern/Fire/Lava 在半径15内按 Manhattan 距离衰减取最大方块光；无缓存，因此方块变化后下一次查询立即生效。
- GameplayEnvironmentFacade 组合 lightAt 与 attemptNaturalSpawn。后者消费 world seed、tick、biomeAt、权威光照、玩家距离、难度与当前类别数量，成功后经 spawnAutonomous 写入实体和 simulation snapshot；暗处 hostile 成功、peaceful 拒绝。Classic 候选表保留在 playbook，不使 stdlib 反向依赖。
- lighting 2 + spawning 3 + world-space-sun/advanced-lighting 6 tests PASS；静态门禁通过。M11-01..04 与 M20-01/02 仍记 PARTIAL：方块光是有界按需扫描而非增量光场，自然刷新周期与群组偏移尚未接，天气视觉和月亮表现待 S7。

## S3g 既有地形、群系与出生证据补账

- 当前 HEAD 复跑 voxel、macro-world、macro-river-v3、cave、ore distribution、precious ore、safe-spawn、legacy generator save，共8文件43 tests PASS。覆盖 seed 文本归一化、查询顺序无关、不同 seed 区分、V2–V6 版本兼容/未来版本拒绝、连续地形与温湿度、六类 biome、跨Chunk河流、洞穴/矿深度、干燥安全出生与山地/树冠/水域重试。
- M02-01/02/03、M03-01、M04-01、M05-03 更新为 PARTIAL_IMPLEMENTED + HEADLESS_PASS；不宣称 Java Beta 随机调用次序等价。基岩/黏土/海床、树苗成长、花草蘑菇甘蔗仙人掌、冰雪组合、地牢/刷怪笼仍保持 NOT_RUN。

## S3h V7 植被与树苗成长（部分完成）

- V7 在V6地形之上以 seed/坐标哈希按 biome 追加 TallGrass/Flower/Mushroom/SugarCane/Cactus；V2–V6原始字节继续冻结。TS baseVoxel、staged chunk kernel、Rust scalar/SIMD 同步，Classic worldgen identity 升7.0.0/g2-g7，场景与保存支持版本扩至7。
- Sapling/TallGrass/Flower/Mushroom/SugarCane/Cactus 使用稳定 voxel 31–36、材质34–39与原创纹理；树苗成长检查下方土/草及5×7×5全部已加载空域，通过一次 editBatch 生成树干/树冠，阻挡或未知格零写入。
- vegetation/legacy/cave/ore 14 tests、TS/staged/Rust/Wasm/mesh/resource 20 tests、tree batch 1 test PASS；verify:static:ci PASS。当前只记 PARTIAL：红/棕蘑菇未拆分，花色、甘蔗严格水边、仙人掌伤害、叶衰减与浏览器植物专属画面仍待实现。
- V7 首次 production 浏览器运行两次在 C0 后失败：deterministic advance 无法准备实体碰撞 Chunks；trace 显示 Generator v7 已加载，但 general worker failedTasks=78 且 Wasm memory failed=true。根因为 Rust mesh material 映射停在 voxel26，新植物31–36产生material255；非实心植物修复不足以解决该 worker 错误。同步 Rust mesh 的27–36材质与遮挡规则、重建Wasm后，绑定 `6c24aa6681da8f148f7ea20a49b33062fc2452b3` 的 production build PASS（artifact `5fc7c6bd6f9e71b571f6a948c5cdf40b91d7db1115293a5d9abf0f0219216a4f`），唯一 Chromium C0–C5 PASS，runId `3964161a-cc8f-4ac7-9ce1-97408edd0f9a`。该回归证明 V7 不再阻塞生产旅程，不替代植物专属视觉验收。

## S3i V8 地牢、刷怪笼与战利品

- V8 按 64×64 region 和 seed 稳定选择地下房间，生成圆石边界、单入口、Spawner 与 DungeonChest 两个追加体素；V2–V7 保持旧路径。TS baseVoxel、staged kernel 与 Rust scalar/SIMD 同步，worldgen identity 升 8.0.0/g2-g8。
- 首轮 Classic 组合回归 20/21 files、51/52 tests，通过项含完整成长旅程；`classic-food-health` 在 bootstrap 拒绝生态 Chunk。根因是程序生成直接使用 station Chest voxel，违反 station voxel 必须有 entity 的完整性门禁。未放宽门禁，改用独立不可采集 DungeonChest voxel 后该用例单测恢复 PASS。
- 刷怪笼仅在显式传入的已加载 Spawner 上累计冷却，要求非 peaceful、玩家 16 格内、光照不高于 7、hostile 未达 16；每 20 秒生成稳定 id 的配置物种。DungeonChest 在 6 格内首次按 seed+dungeon id+index 发放有界 loot，开启后幂等拒绝；冷却、激活高水位与已开启集合进入 Environment checkpoint，旧 checkpoint 缺字段迁移为空状态。补齐 saddle 内容。
- 验证：stdlib 地牢/旧生成兼容 4 files / 15 tests PASS；Wasm world/halo 与 palette 3 files / 10 tests PASS；bootstrap 修复后 food-health PASS；地牢运行态与环境恢复 2 files / 5 tests PASS；`typecheck:classic`、Rust source/artifact fingerprint、`git diff --check` PASS。V8 production build/浏览器专属视觉尚待阶段收口，不在此处声明 PASS。
