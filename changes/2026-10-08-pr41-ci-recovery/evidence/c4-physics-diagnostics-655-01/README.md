# 按需物理快照诊断（655）

本组在 5ac 的未提交候选上补齐 C4 的观察证据：从当前已接受 AuthoritySnapshot 按需复制 body/contact，核对 epoch、tick、ACK，返回冻结且有界的数值副本。附近 body 位置不证明接触；已发布快照不代表每个 physics tick。未新增世界端口权限、消息、定时器或物理步骤；benchmark 不执行投影，原输入、质量、地图、时限与断言保持。

160 文件 1228 个 Classic headless 测试、17 项 CI 选择规则、类型、lint、格式和构建通过。生产浏览器验证同一快照身份、数量上限、冻结副本及真实 Pointer Lock/300ms W+Space。原普通矿车真实输入旅程通过，属于 NON_MAIN 选择。产物前后验通过。diagnosis.json 记录精确候选 sourceDigest；sourceSha 是候选基线，不冒充后续提交。

保留 655 缺 API 的 RED、659 行数门禁失败和 660 类型失败原始输出；修正保持原门禁。旧 sealed evidence 原字节不变。raw .txt 原样保存，新 manifest 封存本目录。

旧精确 5ac CI437 主旅程两次 C4 原90秒失败；私有650原主旅程在V2超出原900秒、C4未运行。该组补充诊断，不修复已知 C4，也不证明完整玩法或性能收益。PR 继续 Draft；最终精确 SHA CI 和剩余产品验收须另行核对。
