# Classic 生物工作包证据

范围：12物种专属原创cuboid GLB、像素UV、四角色transform动画、默认游戏/工坊接线、旧三角色表现退出。生产资产位于 `apps/web/public/models/classic/`；源位于 `scripts/assets/classic-creatures/`。浏览器最终产品验收由主线程统一执行，本文件不把Blender渲染当游戏证据。

## RED

2026-09-22 首次运行 `pnpm --filter @seedlands/web test apps/web/tests/unit/client/classic-creature-assets.test.ts --maxWorkers=1`，两项失败：缺少 cow.glb（代表猪已生成）、animationTargets仍为grazer/night-stalker/settler而非12物种。此前无专属资源，Presenter走fallback-body。RED不是截图hash断言。

## 生产与可复现源

Blender 5.2.1 LTS（9e2066aef7ef），全量12 GLB合计281,260字节、1,380三角形。每模型5–19独立cuboid构件；每物种自己的64×64 atlas包含16×16像素图块，最近邻采样；无第三方原图裁切、无外链。几何/UV/纹理由Blender构建，配方在导出GLB中追加compact transform clips，所有关节pivot显式记录。

| 物种       | 构件 | 三角形 | 特征与动作                           |
| ---------- | ---: | -----: | ------------------------------------ |
| pig        |    8 |     96 | 长躯干、方头/鼻、四腿/短尾，交错步态 |
| cow        |   10 |    120 | 高四腿、角、乳房、低饱和斑纹         |
| sheep      |    6 |     72 | 厚毛躯干、裸脸，四腿交错             |
| chicken    |   10 |    120 | 喙/肉垂、双脚、独立翼pivot           |
| squid      |    9 |    108 | 直立头体、8独立展开触手              |
| wolf       |   10 |    120 | 狭长体、耳/吻、四腿/长尾             |
| zombie     |    6 |     72 | 绿头、蓝衣/暗裤、前伸臂、双足        |
| skeleton   |   17 |    204 | 窄骨、镂空肋骨、弓、双足             |
| spider     |   19 |    228 | 三段身体、8条折腿、腿段pivot         |
| creeper    |    6 |     72 | 长体/方头、四短腿、像素脸            |
| slime      |    5 |     60 | 半透明外体/内核、独立眼口、体积挤压  |
| pig-zombie |    9 |    108 | 粉绿斑纹、鼻/金剑、双足/持剑臂       |

每种均提供idle/move/attack/hurt。四足/双足用交错关节；鸡翼、鱿鱼触手、蜘蛛腿、尾和头分别运动；史莱姆内外体做scale挤压。没有通用整身bob替代动作。攻击仍只跟随已有权威前摇/命中/恢复段定位，无root motion或伤害提交。

`manifest.json`记录配方hash、工具版本、每项GLB/PNG SHA-256、构件center/size/pivot/parent及命名片段。生产命令与恢复在配方README。12张Blender静态预览在 `reports/2026-09-22-visual-audit/classic-v3/creatures/`；已逐张目视检查并修正初版蜘蛛平腿、僵尸垂臂和骷髅实心胸。静态预览不证明PlayCanvas动画或光照。

## 接线与生命周期

- `classic-creature-definitions.ts` 从完整manifest生成稳定物种/模型ID、路径、统计和默认动画映射；catalog由贴图工作包接入。
- `GameplayEntityPresenter` 默认加载物种GLB；已应用用户绑定优先且仍使用启动时Blob。默认模型保留米制作者尺度，外部模型保留已有feet归一化。
- `addGlbModel`复用已有容器lease、abort/stale清理及App动画回调释放；CPU资源每Application最多12个在途/完成Blob，共享已校验资源，失败移出缓存，App销毁取消在途fetch。GPU容器仍独立lease，不宣称新的GPU缓存收益。
- 停止对GLB部件做旧regex腿摆动；死亡/移除的damage材质及时释放。加载失败通过 `seedlands:asset-error` 事件、console错误和可见缺失标记反馈，无静默黑盒。
- `actorModelDefinitions`仅保留玩家/手臂。appearance校验只过滤旧三个animation target及其模型材质绑定/缩略图，不清空其他用户源/GLB/绑定。
- 旧公开settler样例移至 `apps/web/tests/fixtures/skinned-actor.glb` 作为通用蒙皮合同fixture，原字节保留；生产下载改为Classic猪。通用GLB/skin导入能力保留。

## 当前校验状态

- GREEN：五文件22测试通过：classic-creature-assets、classic-creature-resource、actor-model-definitions、builtin-actor-models、gameplay-entity-presenter。
- 通用回归：glb-model、appearance-project、glb-model-resource三文件19测试通过，保留skin与项目包覆盖。
- 收尾复验：新增用户像素源保留断言及GLB资源回归两文件7测试通过（与上两组有重叠，不作为新增交付数）。
- Web完整typecheck通过：svelte-check 0 errors / 0 warnings，以及Web和工具tsc。
- 所触及19个TS/Svelte/MJS文件定向ESLint通过；Prettier已应用，git diff --check通过。
- 初版第二个完整Blender进程在独立临时目录重建，12 GLB、12 PNG、manifest共25文件SHA-256全部与当时产物相同；比较后已删除任务临时目录。随后骷髅持弓修正的单独证据见下节。

第二轮Blender生成/预览、独立重建、测试、类型和ESLint均通过默认 `/tmp/seedlands-benchmark-reservation` 串行取得。这些预约仅证明机器资源协调，不是性能收益证据。未自行启动浏览器/Dev Server；未commit/push。

未验证：真实浏览器默认加载、连续动作帧、用户覆盖/异常资源UI、光照/投影与物种瞄准尺寸；由主线程统一集成验收。长期docs baseline与ASSETS由主线程更新，配方README已给可复现入口。

## 用户截图反馈：骷髅弓朝向、握点与连接修正

用户截图的问题来自真实几何与挂载关系，不是预览角度：作者坐标+Z为脸/射击方向，旧弓中央z=3而弓梢z=5，弯曲方向反了；弦z=2，距弓梢3px且未连接。旧弓中央(-7,17,3)相对手臂末端约(-6,13,0)偏上4px、偏前3px，虽父节点同为手臂，视觉上仍悬空。

已将持弓臂末端定义为(-6,13,4)，新增hand-bow与bow-grip，两者中心精确重合。弓身四段连续连接到握把，弓梢位于(-6,20,2)和(-6,6,2)，因此握把凸向+Z，弦位于身体侧z=2且两端恰接弓梢。全部弓段/弦挂在bow-grip，grip挂在arm--1；抬臂时grip补偿肩部转角以保持弓竖直，握点随手一起移动。

RED：新增握点/端点合同命中缺失bow-grip；修正后6项测试与定向ESLint通过。测试同时读取实际GLB通道，验证idle及attack三个采样帧：hand/grip世界点误差<1e-6，弓始终竖直且forward不翻转，攻击顶点手位于y=1.5m、z>0.7m。所有Blender重建/渲染与检查在一次默认性能预约中执行。

本次完整暂存重建后，其他11 GLB与全部12 PNG逐字节不变；仅替换skeleton.glb并同步manifest/静态元数据。新版骷髅35节点、204三角形、35,092字节，SHA-256为 `8028e5d4d3317744455a3331b00b022cc5c3c99303abb3058a897010c229a3e0`。此处更新了全包总量；初版25文件重复构建证据不冒充本次新骷髅的独立二次重建。

`render-skeleton-bow.py`从导出的GLB重新导入Blender，读取实际idle/attack关键帧，再渲染正、侧、三分之四视图；并非单独摆拍源模型。已目视检查以下帧：

- [idle正视](../../reports/2026-09-22-visual-audit/classic-v3/creatures/skeleton-bow-fix/skeleton-idle-front.png)
- [idle侧视](../../reports/2026-09-22-visual-audit/classic-v3/creatures/skeleton-bow-fix/skeleton-idle-side.png)
- [attack正视](../../reports/2026-09-22-visual-audit/classic-v3/creatures/skeleton-bow-fix/skeleton-attack-front.png)
- [attack侧视](../../reports/2026-09-22-visual-audit/classic-v3/creatures/skeleton-bow-fix/skeleton-attack-side.png)

修前视图保留为同目录`skeleton-before-three-quarter.png`，常规`skeleton-preview.png`已更新。此证据证明几何与导出动作关系，真实游戏浏览器复验仍交主线程；应用按App缓存默认Blob，复验须重载App以获取新版。
