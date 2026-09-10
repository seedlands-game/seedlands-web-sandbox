# S3 产品接线检查点

状态：Implementing。基础内容/注册执行和模式产品接线已可运行，未完成整个 S3、S4–S6 或 PR 准出。

## 当前证据

- `pnpm verify:static`：270 files passed / 2 skipped；1351 tests passed / 4 skipped，世界 coverage 门槛通过；所有 typecheck 通过，Svelte 0 errors / 0 warnings。最终 UI 布局修复后再次完整运行通过。
- `pnpm build`：真实 Pack 构建与读回、Rust source/artifact 指纹、预渲染、Web 类型与 Vite 构建通过，最终布局修复后再次独立构建通过；保持现有 chunk size warning，不宣称性能收益。
- `pnpm test:composable-gameplay`：四个真实 Browser Worker 场景通过：ESM 加载/组合身份 checkpoint 往返、篡改摘要拒绝、新世界创造选择、目录/数字键/Space-Shift 飞行/安全回生存/库存隔离/模式检查点恢复。
- UI 检查来自同一输入旅程的目录、地面、上升和下降原始帧。确认目录物品与选中快捷栏一致，空间高度改变时世界与手持物正常显示；这不等于完整视听或 S6 全旅程验收。未验证音频。
- 本轮浏览器服务用完退出，并确认 4173 无监听者。保留的本机原始帧和命令日志是调试证据，不把调试 overlay 的数字当性能实验。

## 已修问题与失败保留

- 真实跨 binding 事务监听器曾可同步重入；每世界共享提交锁关闭此入口。无效逻辑时间曾先消费队列；现先验证，失败快照完全不变。
- 新世界模式选择后预渲染入口过期，已按既有 `ssg:update` 更新生成片段。ESLint/路径门禁原先扫描生成的 Pack，现只排除明确的生成目录，作者源码门禁不变。
- 全量回归首次 1349 passed / 2 failed：旧失焦输入 fixture 缺少移动状态，命令穷举未包含模式命令；补齐实际合同，并增加失焦中性输入携带 movement revision 的断言。
- Headless 场景默认 5 秒预算在全量 coverage 并行负载下超时一次；同类真实 Headless 测试既有 15 秒预算，两个新增实际宿主用例对齐该预算，保留全部工作，不改断言或性能阈值。
- 首次目录 E2E 使用“物品 ID 唯一”假设，但创造初始快捷栏本来含石块。改为明确第二槽，并对初始目录其余引用逐项保留；没有改生产行为来迎合错误 fixture。
- 原始截图暴露飞行按钮被全局按钮 CSS 覆盖，实际为 relative 且横跨 HUD。浏览器 CSS RED 已复现，修正选择器优先级并防止与暂停按钮重叠；创造目录头部按钮宽度也限定在其局部容器。
- Browser console 的单个 404 已定位为浏览器自动请求的 `/favicon.ico`，并非 Pack、Worker 或玩法资源。现有入口没有 favicon，记录为非阻塞外观问题，未伪称控制台完全无消息。pageerror 断言为空。

## 仍需推进

下一步按 [剩余机制闭环](s3-mechanism-closure.md) 落地单一时钟、持久授权来源、Ruleset/规则阶段、跨 owner 原子提交与保存 frontier。S4 候选匹配/炉体和物品实例只证明候选合同，未证明工位实体生命周期、耐久扣减和木石铁生存成长。S5 替代 provider/跨宿主与 S6 视听、独立审阅、PR/CI 继续待办。

长期 docs baseline：更新代码地图中的已实现 owner/host 入口；架构责任不变，不晋升未完成的机制或实验结论。
