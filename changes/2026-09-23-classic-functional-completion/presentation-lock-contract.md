# Pack Presentation Lock 合同补充

状态：冻结，供 `V1-PRESENTATION-LOCK-CLOSE-01` 实施。

## 可验证行为

1. `packs.lock.json` 的 `manifest` 与 `entry` 是严格两字段文件锁：`{ path, sha256 }`。Presentation loader不得把 resource parser用于这两个字段。
2. `resources` 是严格四字段资源锁：`{ path, sha256, size, contentType }`。拒绝缺失/额外字段、非法相对路径、非 SHA-256、非正安全整数或超过 32 MiB 的size、以及不符合当前 builder规则的MIME：`.json → application/json`、`.mp3 → audio/mpeg`、其他 → `application/octet-stream`。不接受旧两字段 resource兼容分支。
3. Presentation loader只下载 manifest、manifest声明的 presentation JSON及presentation实际引用的资源。锁中合法但未被presentation引用的MP3不得下载，也不得套用presentation 1 MiB下载限制；2,976,045-byte Classic音频metadata必须能通过lock解析。
4. 实际下载的presentation与引用资产必须同时满足锁定size和SHA-256；presentation JSON及任一实际下载资源仍受1 MiB流式上限。错误size或digest fail closed。
5. 保持同源、相对路径、资源必须锁定、重复路径拒绝与Object URL释放语义；本阶段不修改Worker/builder/manifest wire或Media loader。

## 证据边界

- 本变更证明Presentation loader消费当前正式lock合同，不证明重新构建artifact或浏览器视觉验收。
- Audio metadata只参与严格lock索引；Presentation loader不读取、解码或创建audio URL。音频读取仍由独立Pack Media loader负责。
