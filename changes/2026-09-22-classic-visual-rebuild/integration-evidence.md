# 主线程集成进度

## 已接入

- 命中体积按真实archetype解析body registry，不再把鸡/猪/骷髅套用night-stalker高大体积；未知物种不凭空生成命中盒。定向RED出现鸡上方空处距离1.35；修正后3测试通过。
- 十二种GLB归入人物/生物资产目录；游戏目标使用各物种名称。资源错误事件接入既有UI反馈。
- `AuthorityReady.snapshotMigrationReports`在首次载入和恢复后显示退役角色移除数量。
- 库存可放置物品使用实际模型缩略图，不再直接复用方形材质切片；用户覆盖仍优先。通过既有PlayCanvas资产生产脚本重建194张512px透明PNG。实际查看楼梯几何可辨；花朵色板误用另做源修正后再次重建并目视确认红花/绿茎。
- Classic视觉基线和资产出处已更新长期docs/ASSETS；素材几何、玩法与浏览器证据分层说明。

## 浏览器准备

唯一入口`classic-runtime.spec.ts`新增视觉正确性场景：固定12物种与8植物的白天图库、连续帧、8类光源夜间/移除、真实PointerLock单击破坏，以及创造目录图标。新场景附生产artifact身份/runId和原始帧。仅截图采集不自动判定美术质量，需逐帧目视；没有另建浏览器runner。

此场景通过`pnpm harness:classic --grep 'Classic 视觉'`选择，runner构建身份前后验证不变；benchmark模式拒绝选择参数，并不执行视觉截图场景。旧C0-C5依赖退役NPC，其完整旅程适配仍是显式缺口，不能用新视觉场景冒充旧合同通过。

## 当前未完成

- 联合生产构建与本次视觉Browser场景已通过；最终证据见文末，早期失败保留。
- 真实Browser已验证光源暗室/遮挡、植物选取穿行；跨区块/远近缓存与旧存档迁移有定向合同测试。用户自定义外观的完整手工Browser旅程未执行。
- 彩色羊毛是原本不可放置的resource（空capabilities），本次已修视觉区分；新增彩色世界方块尚未实现。
- 未提交/推送此change。保留无关hotpath change目录和用户其他工作树。

## 联合检查（阶段记录）

- `pnpm typecheck` 已全仓通过，含Kernel、stdlib、Classic、Web/Svelte、Agent及测试/工具类型。
- `pnpm test`：Kernel 28/28通过；stdlib 588通过、1失败。失败为headless CLI仍召唤已退役grazer的旧期待，已交迁移worker改为现存物种并保留行为覆盖；未把此轮写成全绿。
- Classic浏览器测试类型检查已通过；主线程受影响ESLint通过。
- 补充退出Classic伙伴邀请UI及后台轮询，通用Companion能力源码保留。
- 主线程审阅迁移另发现旧Pack已无退役实体时的composition升级缺口，已要求覆盖；核对迁移白名单是否确实对应本次变更前生产Pack，未凭历史fixture当作当前用户旧档。

## 生产浏览器第二轮与收敛

- 两轮原始帧分别保留于 `reports/2026-09-22-visual-audit/classic-v3/browser-attempt-1/`、`browser-attempt-2/`，第二轮目录含实际source/artifact digest。
- 第一轮暴露截图早于实际目标区块网格完成、单击未先对准目标；增加区块渲染revision readback及真实鼠标准星确认后，第二轮单击前方块消失、20物理tick后后方块仍在的断言通过。
- 第二轮12模型加载、目录检查完成，末尾两条favicon 404导致console assertion失败；补齐真实Classic crest favicon引用，不屏蔽错误。
- 逐帧目视发现发光表面被近纯橙色覆盖、植物UV疑似横转；分别交独立worker修复，未因截图成功就宣布美术通过。增加猪/骷髅持弓/植物近景与八类光源逐个夜景。
- 迁移worker已修正旧CLI测试并7/7通过；真实0759202旧Pack identity已用于严格迁移，0退役实体旧档也升级composition。checkpoint另一缺失fixture ENOENT独立记录，不视为通过。

## 最终联合验收（2026-09-22）

- Kernel 4文件/28项；stdlib 96文件/589项，全通过。Classic headless 23文件/62项，全通过。
- 全仓`pnpm typecheck`及`pnpm lint`通过；Web/Svelte为0 errors/0 warnings。
- 生产构建PASS：sourceDigest `44c64fb568694607ae446e1fc9e004eab34366a494e8443e0cf8aa2000a61b72`，artifactDigest `2a755d63a5f65921e43cf700fe1254fe74144bdf745096ed750917363b668da4`，274个文件。源码SHA为dirty起点0759202，精确内容以digest绑定，非声称该旧提交含新素材。
- `pnpm harness:classic --grep 'Classic 视觉'`最终PASS，runId `2b001153-b3e9-44f7-a3b0-b5cfc286e31e`。24张原始帧与artifact/console/network读回见`reports/2026-09-22-visual-audit/classic-v3/browser-final/`。
- 目视确认12种模型加载、猪/骷髅辨识、正确植物朝向、八类光源纹理与环境采光；封顶房间加入光源显著变亮、隔墙后观察侧暗下。真实输入验证植物选取/穿行和单击一个方块。
- R8上传0..15未编码到UNORM造成1/17亮度的问题已修：CPU上传乘17，actor raw光级采样不变；合同测试覆盖0/1/7/15。
- 暗室早期夹具屋顶Y64超过Browser最高Y63，已改为合法Y63；第四轮自动PASS但过滤输入框吞掉E键导致目录挡住暗室，已用真实关闭按钮及隐藏断言修复。未删除失败或以截图产出充当目视完成。

## 明确保留的边界

- 本次通过视觉正确性场景，不等于旧C0–C5全旅程通过。旧旅程绑定已退出NPC，其合同调整另行处理；远端旧head的Chromium regression失败不被本次局部PASS抹掉。
- 完整checkpoint suite存在缺失fixture；实际旧Pack迁移定向3项通过，不能据此宣称缺失fixture套件全绿。
- 块光为相机附近64³体积，近景内衰减/遮挡/刷新；不宣称已实现无限距离全世界持久光场。未采集性能A/B，未声明性能收益。
- 十六色羊毛原本不可放置，本次只统一已有视觉入口；其世界方块玩法仍待独立实现。
