# 真实模型合同验证

2026-09-09。命令：`node changes/2026-09-09-living-npc-mvp/experiments/live-model-smoke.mjs`。复用当前进程已授权的 Midscene 凭据，endpoint 为 api.deepseek.com；未读取 `.env`、输出凭据或持久化私有 reasoning。

通过真实 Headless Authority 创建角色、取得受限 observation，两轮 Flash Vision 都提交了可接受的目标：第一轮 forage，第二轮依据可見玩家引用 follow。工具结果来自实际 Authority，第二轮回放完整 provider tool pair 和 reasoning wire 字段。Flash 用时11.625秒/11.137秒，input1449/3465，第二轮cache2560。Pro用时16.471秒、input315，生成摘要后经Authority memory revision回执接受，Context generation从1切到2。

原始公开观察、目标、回执和usage见 [JSON](live-model-smoke.json)。该 JSON 只有 `reasoningPresent` 布尔值，没有私有推理内容。失败的首次启动为脚本根路径错误，尚未发模型请求；修正相对根目录后上述请求通过。

边界：这是世界与模型协议验证，不是完整 Browser Bridge 验收。Pro为了有界验证显式将测试软阈设为1，不代表真实装填112K上下文，也不据此宣称128K优于256K或缓存必然命中。两次角色回答简短而顺从，第二次没有回答玩家关于动机的问题，因此人格一致性尚不能凭这两次计满分；后续真实浏览器需补动机与危险请求观察。

### 真实输入揭示的两个失败

`read-batch-red.json`：Flash 合法返回 `available_actions` 与 `inspect_visible` 两个只读工具，旧 graph 只允许一个 tool，错误进入 fallback。修复增加有界只读 batch 与完整回执，不增加任意写入能力。

`pro-semantic-red.json`：修复后的两轮 Flash 成功，但 Pro 收到原生 Flash assistant/tool 历史后返回 DSML `propose_intent` 标记，未完成摘要。原实验脚本只验证非空/长度与 Authority ACK，因此 JSON 的机械 `status: passed` **是验收假阳性**；人工内容审查将本轮判定为 **失败**。HTTP成功与记忆字段被写入均不代表正确压缩。接下来将历史物化为来源标注的公开文本数据，并拒绝工具/control标记，再做真实复验。原始证据保留，不覆盖。

该轮 Flash 第二次表达“我有点饿了，先找点吃的，不想走太远”，体现了自身需求优先；这只是一项有限人格观察，尚未构成浏览器持续体验验收。

### 公开事实文本压缩复验

`live-semantic-fixed.json` 使用实际Flash多轮工具历史与实际Authority事件，Pro收到来源/确定性标注的普通数据文档，未收到原生工具会话或private reasoning。三次Flash请求（含一次inspect_visible只读后继续），一次Pro请求均完成；Pro生成自然语言摘要，明确写出两个forage提案获接纳，并未声称食物已经获得。摘要经memory revision/cursor核验提交，随后context generation 1→2，完整checkpoint成功。

人工内容复核：摘要确实保留身份、身体、当前目标、可见食物、交谈及已接纳提案；附有一段明确标为“Unconfirmed”的动机归纳，不是权威世界事实。该短样本证明压缩协议与提交路径可用，不证明长期记忆无偏差或128K/256K质量优胜。模型私有reasoning仍仅在Flash会话回传，不进入Pro输入；“reasoning”字样本身不是泄漏原始私有推理的证据。

累计真实调用截至本次为9次Flash、4次Pro。后续真实浏览器测试最多6次请求，不再调用Pro。
