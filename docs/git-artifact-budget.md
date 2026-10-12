# Git 文件预算与运行证据存储

## 当前边界

Git 保存源码、合同、小型结构化报告与必要截图，不作为浏览器 trace、录像、构建目录或整轮运行产物仓库。2026-10-12 的诊断发现共享 pack 约 8.10 GiB，其中约 7.79 GiB 是 `changes/2026-09-23-classic-functional-completion/evidence/` 的 trace ZIP 历史分片；main 历史对象约 178 MiB。运行产物已经压缩，重新切片不会减小总量，换切片边界还可能产生新的 blob。

## 可执行门禁

入口以根 `package.json` 为准：

```sh
pnpm check:git-artifacts --staged
pnpm check:git-artifacts --base <base-commit> --head <head-commit>
pnpm test:git-artifacts
```

- `--staged` 是 Husky pre-commit 的首个检查，只读取 index 中新增/修改文件的对象元数据；不按磁盘上的同名文件判断。强制 `git add -f` 仍被检查。
- 文件未压缩字节数 **超过 10 MiB 警告，超过 50 MiB 拒绝**；MiB = 1024² 字节。压缩后很小但解压前很大的 blob 不能绕过。
- trace ZIP、ZIP 分片，以及 `changes/*/evidence/`、`reports/` 和既有运行产物目录中的 ZIP/MP4/WebM 不得进入 Git，即使很小也拒绝。普通小型 JSON、Markdown、截图、源码 ZIP 夹具及游戏资源不被这一规则整体排除；它们仍受大小预算约束。
- CI architecture job 使用固定 base/head，扫描整个提交范围的新增/修改文件，合并旁支与中间「提交后删除」也在范围内；不是仅比较最终 tree。
- base 已有的同路径同 blob 不追溯拦截；旧大归档修改或换路径即重新检查。门禁不是旧历史的清理器，不自动扫描/删除其他分支、备份或 reflog。
- 无效 base/head、全零 base、冲突 index、对象缺失、非法 UTF-8 元数据和 Git 失败使检查失败，不降级为「无文件」。CI 的现有 `Static verification` 继续汇总 architecture 与 deterministic，两包测试选择不变。

本地 hook 可被客户端跳过，CI 是后备检查；用户也能修改检查本身，所以这不是恶意代码隔离或安全权限边界，规则与脚本变更仍需人类审核。

## 证据保存合同

trace、录像与完整运行包写入当前运行输出目录，随后按明确的存储方案上传到 CI artifact 或对象存储。不要拆成 ZIP 分片提交，不要为降低文件数把整轮证据重新 ZIP 后入库。未选定云存储或尚未上传的证据保留本地，并在报告中明确 `LOCAL_ONLY`；不得编造 URL 或把上传缺口写成已完成。

Git 中的小型 manifest 至少记录：

- run id、源代码完整 SHA、环境与证据层级；
- artifact 的可恢复地址/标识、原始文件字节数、SHA-256；
- 生成及过期时间、保留策略、恢复与校验方法；
- 脱敏状态与访问范围。不得提交 `.env`、密钥、授权 Cookie 或带凭据的 URL。

失败证据与最终验收证据按业务追溯要求保留；CI artifact 有保留期限，不天然等于永久存档。需要长期留存的证据使用可保证保留期限的对象存储并核验恢复。源码模型/音视频若确需长期版本化，可另行评估 Git LFS；启用 LFS 不会自动迁移已有历史。

## 旧历史与本地空间

1. 先导出并核验旧证据，保存 source SHA、SHA-256 与恢复索引。
2. 历史移除只在隔离副本验证，核对所有保留目标对象的分支、远程跟踪、task/identity backup、Codex snapshot、worktree HEAD 与 reflog；不只看 HEAD。
3. 经明确确认后再决定定向历史迁移、受影响分支发布和本地迁移；main 不包含这批 trace，不无差别重写主线。
4. 闲置 worktree 必须确认无活跃任务、脏状态和未保存提交后再移除。多个 worktree 共享 `.git` 对象库，但各自检出的证据和依赖仍占磁盘。
5. 正在变化的临时 pack 可能被维护进程使用，不能按名称直接删。普通 GC 无法回收仍被引用的对象；不得以 `gc --prune=now` 或全量 reflog expiry 代替范围确认。

本 change 只新增防复发合同，不声称已回收 pack、降低实际 clone 时长或完成云存储迁移。
