# Phase 1 browser evidence

当前目录由 `agent-browser 0.33.2` 的隔离会话生成。每个结论必须关联截图、录像、控制台/网络读回或应用状态；仅命令成功不视为游戏行为通过。

主要通过证据：

- `after-load-timeout.png`：推荐森林最终植物/HUD；树冠与密度进入阶段 2。
- `survival-inventory.png`：空背包以木板、木棍和基础工具为首要路径。
- `creative-catalog-all.png`、`creative-catalog-torch.png`、`creative-catalog-empty.png`：目录稳定布局。
- `melee-showcase.png` / `melee-showcase.webm`：僵尸体验场。
- `final-place-aim.png`、`final-placed.png`、`final-broken.png` / `final-place-break.webm`：真实 Pointer Lock 下放置与单击破坏闭环。
- `final-structure-gallery-clean.png`：Harness 仅构造夹具，真实 WebGL 显示栅栏横档、火炬分材质、木门和梯子。

保留的失败/诊断材料：

- `final-fence-world.png`、`final-fence-safe-placed.png`：真实右键栅栏目标与玩家碰撞，权威返回 `player-collision`，未作为放置通过。
- `melee-input.webm`：一次画布低层输入后返回菜单，未作为攻击通过。
- `recommended-seed.png` 是加载态；实际世界结论使用后续帧。

Exact-head 复验：

- `exact-head-matrix.webm` 与 `exact-head-*.png` 绑定 `8004ff7` 生产 artifact，覆盖森林、背包、目录全/单/空和结构画面。
- `exact-final-hidden-target.png` 与 `exact-head-readback.json` 绑定最终代码 head `4d9da2c`，证明待机目标视觉隐藏但 `#target-card[data-target]` 仍供正式瞄准辅助读取，页面错误为空。
