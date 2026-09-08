# C0 JSON wire preflight 记录

## 目标

为 C0 metadata 提供独立的 `preflightJson(text, options)`：在主 C0 仍调用 `JSON.parse` 前，扫描 JSON 语法边界、嵌套深度、累计 value 数，并拒绝任意对象层的重复 member。它不做字段白名单或业务 schema 判断，也不重新生成 JSON 文本。

## RED

先写 Node 22 smoke 并导入尚不存在的模块。实际得到 `ERR_MODULE_NOT_FOUND`，保证 smoke 没有内联待测 scanner。

## GREEN

覆盖顶层、嵌套与转义等价 key 的重复，array 和未知字段的合法通过，合法 string escape、深度和 value 预算，以及截断/非法 number/string。Node 22 实际输出 `json-wire-preflight smoke: 6 groups passed`。没有生产改动、计时或 C0 主脚本修改。

入口为 `preflightJson(text, { maxDepth = 16, maxValues = 200000 } = {})`。成功只返回扫描统计 `{ values, maxDepth }` 并保留原始文本；C0 调用者仍在此后执行 `JSON.parse(text)` 获取最终 metadata，不能以重新序列化比较取代这个 preflight。
