# Browser22 raw packaging supersession

状态：`PACKAGING ONLY`。GIT38 第一次 evidence commit 的自然 hook 因四份机械导出使用 `.json` 后缀而失败。
本目录保存改名前的 Browser22/MAP01 审批 metadata 和会被更新的引用文件；所有副本均使用 `.log` 后缀，保持原字节。

`raw-path-mapping.json` 记录四个旧路径、新路径和不变的 SHA-256。Browser22 的 FAIL、source、trace、截图、运行结果和
MAP01 诊断不因本次改名变化。已提交的 Close14 合同与 `code-staged.patch` 中旧 MAP01 hash 是当时审批输入，保持原样；
当前可提交包装身份由 Browser22、MAP01 和 GIT38 各自的新 MANIFEST/delivery 给出。
`PRIOR-MANIFEST.sha256` 覆盖 14 份原字节副本；修改前 GIT38 README/MANIFEST/delivery 同样从当前索引导出到
`git38/`。

## 旧审批身份

- Browser22 SOURCE15：`e19abad273e8a7c7bfe5a1bb4e375a327ae3dd584f8c7c01d4a166e5ccbda801`
- Browser22 MANIFEST50：`3e0befb7e39e367f7caf506b242cd347e37782cb3a2b5b440cc7358b0adabd12`
- Browser22 delivery：`4cca1534c53cefdcec329b3d161911870dbf2b00fbc48ee4126dc5a8762cebf4`
- MAP01 SOURCE11：`40190d99bdf880e3d0678e8c6d2efb6477e1754dce57fbd2f509e3e233983c11`
- MAP01 MANIFEST21：`c627fc471c55eee7c7cfc3d367610bb0b3f72bd64e0815d487c57c5cd85a4b4c`
- MAP01 delivery：`ba13b9c41eea62b534524c50a1e4b23603262bf7a25c32617487fa163c1b7579`

首次生成 prior manifest 时，输出临时文件被错误纳入枚举，产生 15 项草稿；该草稿未提交，也未作为身份使用。最终清单
显式只枚举 `browser22/`、`map01/`、`git38/` 三个目录的 14 份原件并逐项校验。
