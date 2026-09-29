# Close-16 Predecessor Snapshot

状态：`APPROVED_PREDECESSOR / NULL_ATTACHMENT_GAP_RETAINED`。本目录在 null closure 修改前逐字节保存 Close-16
SOURCE15 与身份 metadata。`files/` 中的 15 个文件已按 `identity/SOURCE-MANIFEST.sha256` 逐项验签。

冻结身份：SOURCE15 `5f16faaef7050c993a147f963fd3b202956ef5a373ce0f2153a22013d7e14922`、MANIFEST79
`1fbae8b8ca484192010e1363c375d869dea6bff0118727cbddf71653e691586e`、delivery
`a4f0dd2668f1250294d174b73d2972ad90a548a70cd44a1ea3b13ad1a81f3896`。其静态 GREEN 历史仍有效，但
“malformed/null failure attachment fail closed”声明存在已复现漏判：有效 detailed PASS 加 `payload:null` 的 failure attachment
会被错误接受为 PASS。本片只补该附件 presence/validity 闭包。
