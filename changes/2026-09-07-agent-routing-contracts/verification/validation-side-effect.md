# 验证副作用记录

在 global skill/runtime 的首次格式检查中，当前 worktree 缺少依赖；误用 `pnpm exec prettier --check` 触发 pnpm 本地依赖安装，并下载 Puppeteer Chrome 到用户缓存。未运行格式化写入，没有修改 skill/runtime 源、合同 JSON 或全局安装目录。

首次检查还报告 11 个 skill/runtime 文件不符合 Prettier。该结果已直接交实施方修正；本验收暂停把 global 标为最终通过，等待使用绝对已安装 Prettier CLI 的复核。

系统 Python 缺少 PyYAML；按验收合同使用唯一 `/tmp` venv 安装 PyYAML 运行 `quick_validate.py`，未修改系统 Python。
