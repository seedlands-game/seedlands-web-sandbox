# Close-15 Predecessor Snapshot

状态：`APPROVED_PREDECESSOR / SUPERSEDED_PATHS_ARCHIVED`。本目录在 Close-16 修改共享路径前保存 Close-15 的
SOURCE5 与身份 metadata。`files/` 下路径相对本目录解析；`identity/SOURCE-MANIFEST.sha256` 已从 `files/` 逐项验签。

Close-15 身份保持：SOURCE5 `258ac9faf2329f7c5f07565795bb93c769e7e87b55bfc213f6f8edf7775ab138`、
MANIFEST23 `f512cfa8907a48689936b5b8c02d1fed99fe588b6a1f3d432d1380a69875dfad`、delivery
`b853e2cec7300f90f01cf43d9d021c0ad0df7bbbe9f9acd406277460d492f944`。归档包含 900 秒 main 与 60 秒
chromium project 的批准字节；Close-16 只 supersede `playwright.config.ts`、`spec.md` 的后续字节，不改写 Close-15 历史。
