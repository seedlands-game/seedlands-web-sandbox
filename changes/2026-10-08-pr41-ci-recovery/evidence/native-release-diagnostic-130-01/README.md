# 原路线日志的释放观测130

128 route消费者已使用native release，而原Node pulse JSON只记录ACK/速度，无法区分release不存在、旧epoch、非neutral或ACK未消费。130仅复制已有snapshot的nativeMovementInput到motion观测，不增浏览器查询、轮询、按键、计时、判定或样本上限；原512 cap、benchmark旁路、错误及标签保持。

旧report缺字段取得RED1FAIL/5PASS；修复后相关5files50PASS，包含借用输入对象随后改变序列也不得改写已记录观测、未消费ACK不得生成firstSettled。Classic types及范围lint PASS。Root复核两行字段复制与唯一测试；本片未委派独立review。没有生产Web修改，build/Browser未重复；既有128两例PASS仍绑定5690，不重标为130。

CI416精确dcb39仍运行Chromium，129夹具修复及本片完成后先留本地，终态前不push取消它；headless的4FAIL/1026PASS仍保留。完整PR及内容/运输/照明矩阵未准出。长期docs baseline无新变化，原128的派生观测职责保持。真实16:03UTC产品周剩74%、4d11h重置，共享账户下降24个百分点不是本PR精确用量，约60%停止线保持；不另开额度验证，不换算token/credits/API。
