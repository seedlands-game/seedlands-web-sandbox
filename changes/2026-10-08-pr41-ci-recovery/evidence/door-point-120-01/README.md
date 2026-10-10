# 闭门 approach 精确定位120

CI414第一次main在v1-slice的门probe输入前，原oracle返回invalid/not-before-door。Authority X=70.49249901244495与east door条件重建的contact70.4925一致；原日志未保存门ID、initial或plan，故几何匹配属于条件推断。共享walkTo默认crossing允许同走廊超过目标，不能保证到达门前1米的approach点。

仅此门setup显式使用arrival: point；既有默认crossing保留。while、鼠标修正内的到达和修正后复核使用同一route-progress谓词。真实stepBody地面与闭门几何、实际walkTo和鼠标/键盘适配测试取得旧代码RED1FAIL/19PASS（墙边无输入即提前返回）；修复后相关5文件50PASS，保留原oracle pending/no-observations及所有接触判定。输入最大80ms、.06/.08、45秒route/20秒settle/1250ms门probe和全900秒均未改变。

最终Classic类型通过，范围ESLint通过。初始harness501有效行FAIL保留；共用到达谓词归属既有route-progress后满足500上限，没有压缩格式或豁免。最终浏览器主旅程、CI及后续C4未跑，不宣称门GPU/完整玩法通过；retry按钮导航原因仍未确认，未猜改。

119生产源此前保存为6a68a34fd619bfdb7d163ada7bd82489ea9f8628，冷存档Browser待验。14:25UTC实际周剩75%，约60%停止线保持；本组未启用其他模型或新权限。完整PR仍不可合入。
