# 验收记录

日期：2026-09-08（Asia/Shanghai）。分支 `codex/unified-visual-assets`，起点 `fb0c0b63c457a59054e4d35ab2c9c7efceedfb7d`。全部新增源码、需求用例与截图属于本 change。

| 层次               | 证据                                                     | 结果与边界                                                                                          |
| ------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| RED                | 新增 texture-pack 用例首次运行                           | 新模块缺失，3 个目标行为无法通过；再实现源、验证和编译器                                            |
| 确定性与静态       | `pnpm verify:static`                                     | PASS；190 文件通过、2 跳过；891 tests 通过、4 跳过；world 行覆盖 96.89%；Svelte 0 error / 0 warning |
| 默认构建           | `pnpm build`                                             | PASS；保留既有大 chunk 提示，不作性能改善声明                                                       |
| Pages 子路径构建   | `SEEDLANDS_BASE_PATH=/seedlands-web-sandbox/ pnpm build` | PASS；以同一 base 启动 `pnpm preview` 后进行真实浏览器入口和样例资源验证                            |
| 需求及原路径浏览器 | 下列显式命令                                             | 5 passed，19.6s；Chrome / WebGL2；1280 和 700 宽度                                                  |
| 生产页面           | `production-prefix.json` 与 `production-prefix.png`      | 工坊真实预览 ready；游戏菜单可见；GLB 样例 200；无 pageerror 或 4xx/5xx                             |
| 视觉               | 同目录 PNG / JPG                                         | 人物比例、方块、水/灯笼、GLB 木箱、空手与石镐握持、窄屏、编译图集；不要求游戏和预览镜头逐像素一致   |

```sh
SEEDLANDS_E2E_PORT=4183 pnpm exec playwright test \
  changes/2026-09-08-unified-visual-assets/e2e/assets.spec.ts \
  changes/2026-09-07-voxel-tool-playable-sample/e2e/tools.spec.ts
```

覆盖详情：

- 目录逐一对照 Voxel、FaceMaterial、物品注册和 actor 定义，依赖均可解析；33 个用途入口、108 项资产。
- 图集输入重排后像素和索引不变；重复 ID、错误尺寸、违规透明像素拒绝。浏览器导出 JSON 的条目 ID 与独立源一一对应。
- 真实像素画布编辑 → 保存 → 显式地形快照 → 新游戏：检查 GPU 上传纹理数组的泥土层为 16×16 且 RGBA 与已应用快照一致。编辑原草稿后仍读取快照。恢复默认后再次启动游戏，读取默认源。覆盖事务冲突与注入配额失败，旧包不被改写。
- 静态 GLB 文件 UI 导入、刷新重载、3D 渲染、导出逐字节一致、删除后刷新消失；非法文件不写库。定向单测覆盖外链、动画、skin、无效索引、范围与容量限制。
- GLB/方块反复切换的瞬时 Mesh 创建/销毁计数在引擎基础几何缓存预热后回到 0，无重复销毁；单测另覆盖取消时同一 Asset 的迟到加载资源释放。不是整进程 GPU 内存/驱动泄漏证明。
- 原工具旅程覆盖真实合成按钮、Pointer Lock 采集、共享掉落表现、背包存退和低质量重载。旧原生草稿的格式/事务单测保持通过；没有重写用户现有世界。

排障记录：生产 smoke 第一次误用默认 Playwright 缓存浏览器，改用项目已配置的系统 Chrome；随后 preview 未带构建使用的 base，子路径命中游戏 fallback。补齐 preview 环境后重新验证。没有安装浏览器或更改系统配置。一次 smoke 菜单选择器误写“新建世界”，按源码改为“进入世界”。这些是验收运行配置错误，未归因为产品通过或失败。

长期基线更新 `docs/asset-workbench.md`、`docs/code-map.md` 与 `ASSETS.md`，保存来源、所有权、格式和试用入口；本次 E2E 保留在 change，不晋升长期基线。未运行 Midscene：本轮验收由确定性 Playwright 输入/资源读回和人工截图检查覆盖，不声称 Midscene 通过。

## PR 准出

生产代码 SHA `a91cf05ec2ec3d94e2371000f976fb2241b6c061` 已推送；[PR #16](https://github.com/seedlands-game/seedlands-web-sandbox/pull/16) 为非 Draft、无冲突。[首次 CI](https://github.com/seedlands-game/seedlands-web-sandbox/actions/runs/34156350333) 的 Static verification、Production build、Chromium regression 全部 SUCCESS，Pages deploy 按 PR 事件正常跳过。此后只有交付文档更新；最终门禁以 PR 最新 HEAD 检查页为准。未自动合并或发布。
