# Classic v3 交付快照

日期：2026-09-22。范围：已批准的低饱和Classic像素视觉、12种生物/骷髅持弓、8类交叉植物、194物品绑定及缩略图、灰色像素UI、三种旧自定义角色退出/迁移、8类近景块光。独立创造破坏输入修复为前序commit `0759202`，本次Browser再次验证。

## 验证

- Kernel 28/28，stdlib 589/589，Classic headless 62/62。
- 全仓typecheck、ESLint、路径检查通过；最后补充Browser测试类型检查发现临时style元素类型为Node，已使用parentNode.removeChild修正并再次通过。
- 生产构建及24帧真实Browser视觉场景通过；页面/资源/渲染错误为0。固定artifactDigest `2a755d63a5f65921e43cf700fe1254fe74144bdf745096ed750917363b668da4`。原始run/source内容身份见[最终浏览器证据](../../reports/2026-09-22-visual-audit/classic-v3/browser-final/README.md)。测试helper类型等价修正后交接前再构建校验字节身份。
- 定向资产、GLB动画、UV/Wasm等价、迁移、块光合同见各工作包evidence；真实暗室/移除/隔墙可见，植物真实选取穿行和单击保留后方方块通过。
- 所有重型命令均经共享benchmark-window，不删除他人的锁；功能诊断不构成性能样本或收益声明。任务自身preview由runner退出；用户5173服务保留。

## 交接与边界

交付至既有Draft [PR #41](https://github.com/seedlands-game/seedlands-web-sandbox/pull/41)，base `main`，source `feat/classic-beta173-playable`。提交后由主线程读回远端SHA及当时gate，不自动合并或常驻追CI。旧remote head `9115766` 的Chromium regression失败与本次视觉正确性证据分开。

旧C0–C5合同依赖被删除的NPC，仍待单独适配；缺失checkpoint fixture、完整用户外观手工Browser旅程不记为通过。块光为64³近景体积；彩色羊毛世界放置能力未新增。未宣称Classic所有原版细节已还原。

长期docs baseline已更新：`docs/classic-visual-style.md`锚定批准风格、原创资产生产与显示规则；`ASSETS.md`登记原始素材来源、Blender配方与旧GLB测试fixture。未改变远端required checks、性能baseline或Modern路线。无关hotpath change保留未暂存。
