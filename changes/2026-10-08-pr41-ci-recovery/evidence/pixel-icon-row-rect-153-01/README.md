# 行内矩形图标候选153

颜色path候选149因真实16px差异拒绝，其生产实现已移除。新候选只合并同一行相邻同RGB不透明rect，保留原矩形原语、行序、透明/不同色边界、颜色、viewBox/crispEdges和缓存/override；保持DOM-free。

同130图标旧A/A元素37564/37564、URLbytes4315978/4315978；新C/C元素12112/12112、URLbytes1404636/1404636。逐像素展开矩形验证所有原格与缓存。当前未采用path上的representation RED1FAIL/1PASS，非旧产品RED；C后5unique13PASS，types/lint通过。结构预算改变为新行段合同，原16/32px零RGBA差异、sourceAA及全部旧visual/玩法断言保留。

真实browser154和main151尚未执行，不宣称栅格通过、输入/帧/旅程更快或产品可合入。raw/hash见validation；长期docs baseline不变。
