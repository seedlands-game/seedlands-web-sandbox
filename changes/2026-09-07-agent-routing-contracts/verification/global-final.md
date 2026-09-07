# 全局 skill/runtime 独立验收记录

结论：通过，可由 root 执行真实全局安装。

- 合同原始字节及父 hash 链已经校验；未格式化任何 `contracts/` JSON。
- Node22 原生测试 15/15 通过，覆盖合同拒绝、有限并发、漂移、结果不明对账、验证失败续跑只读验证、取消、安装器和 CLI 安全出口。
- `quick_validate.py` 在唯一 `/tmp` venv 的 PyYAML 下通过；系统 Python 未修改。
- 使用既有 worktree 的绝对 Prettier CLI 检查 global skill 源，通过；未再调用包管理器。
- 隔离安装 dry-run 是 `applied:false`，未写入隔离目标；真实 `--apply` 不由本验收执行。
- CLI 非法本地配置以安全失败退出，stderr 不含原始异常 stack/payload。
- 验证副作用见 `validation-side-effect.md`：首次错误的 pnpm check 触发本地依赖及 Puppeteer Chrome 下载，未改源码、合同或全局安装目录。

四个最小上下文行为演练及可校验 bulk-write preparation 合同位于 `behavior-samples/`；未创建 agent、未连接或写入线上服务。项目窗口策略和受影响静态/构建仍待其包冻结后验收。
