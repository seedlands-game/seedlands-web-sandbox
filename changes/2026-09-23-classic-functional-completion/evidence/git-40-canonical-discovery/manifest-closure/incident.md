# GIT40 Manifest Closure

已发布提交 `460545bc0796b6f4e63ea766337b6efe913ef0ae` 中，GIT40 根 `MANIFEST.sha256` 第 12 行为
`selection.stdout.json.log` 记录了 62 位摘要；对应文件的工作树和提交对象实际 SHA-256 均为 64 位
`7156c9366d6b06b66ae5649a39176b3ddbdb9658de6a63267e2a25f455baee57`，文件字节没有漂移。

旧 `shasum -a 256 -c` 对该行输出 `WARNING: 1 line is improperly formatted`，同时跳过该行并以 0 退出。因此原 final
selfcheck 只验证了其余 16 条，原“MANIFEST17 全部验证”声明被本 closure 取代；这不是产品或 discovery 失败。

`prior/` 原样保存修改前的根 README、MANIFEST 和 delivery；`PRIOR-MANIFEST.sha256` 从本目录验证三个归档副本。旧
MANIFEST 以 `.log` 保存且是已知无效历史，不属于任何 strict PASS manifest。路径映射如下：

- `../README.md` -> `prior/README.md.log`
- `../MANIFEST.sha256` -> `prior/MANIFEST.sha256.log`
- `../delivery-validation.json` -> `prior/delivery-validation.json.log`

`strict-manifest.mjs` 要求每行严格为 64 位小写十六进制摘要、两个空格、`./` 相对路径；拒绝空行、非规范条目、重复
路径、越界、missing、非普通文件和 hash mismatch，并要求行数、有效条目数、已验证条目数都等于声明值。

closure detached tree 没有安装依赖；前两次调用主工作区 Prettier 可执行文件时，配置中的
`prettier-plugin-svelte` 仍从 detached cwd 解析并 exit 1，均未改文件。两组 stdout/window 原样保留。最终门禁在同一
detached tree 完成离线 frozen 安装后使用正常 `pnpm exec prettier --check`，不以 ignore、suppression 或改写 raw 绕过。
