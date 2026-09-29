# GIT39 Scope Correction A

本目录只保存未获有效授权的四项 Browser23 JSON 包装尝试所产生的中间 metadata。
该尝试来自不可核验的 compact 摘要；不存在对应的第二次自然 hook 失败，也不存在可核验的 root 授权消息。

`INTERMEDIATE-MANIFEST.sha256` 覆盖 `files/` 下九份恢复前字节。四份 raw 未在此重复复制；其原字节已由
`../prior-hook-json/` 的 26 项 manifest 固定。纠正将四份 `.json.log` 恢复为原 `.json` 名称，并从
`prior-hook-json/files` 恢复 Browser23 四份和 MAP01 五份 metadata。已批准的 `test-0-error-context.md.log` 保持不动。

本阶段不修改 GIT39 既有 metadata、allowlist、校验脚本或 index，不运行测试、构建或浏览器，也不提交或推送。
