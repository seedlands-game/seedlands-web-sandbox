# C4 逐脉冲诊断接线

原 CI407 主旅程首次触及总900秒，重试在返回 `[72.5,0.5]` 的原90秒路线失败。失败末尾停稳并不证明此前各pulse的ACK、落地及等待过程，因此尚无依据增大pulse或修改物理/验收门槛。

仅原 C4 往返 `walkTo` 启用 Node 侧记录，复用现有snapshot与settle谓词；没有额外浏览器观察或输入。每pulse记录：

- 原输入前tick、ACK、双端pose、三轴velocity、ground/collision；
- 原航向校正前后节点时间、W/S+Space与请求delay、keyboard调用结束及独立wall耗时；
- 原post-release poll首次观察到fresh ACK、首次满足完整settle谓词与最后观察；
- route累计/剩余时间、终态及未完成pulse。

“首次观察”是现有poll看到状态的时间，不能冒充Authority事件实际发生时刻。keyboard异常先记录调用结束，再按原清理顺序松键并重新抛原错误；wrapper的finally保留完整已记录pulse。每route至多512pulse，超过明确标truncated。benchmark模式不启用诊断，输出`diagnosticOnly=true / eligible=false`；不得据此宣称性能达标。

原136米往返、target、真实W/S+Space、300ms默认上限、到达容差、fresh ACK/ground/collision/三轴停稳/呈现追上谓词，以及20/90/900秒保持。只增加测试诊断，没有production实现修复，也没有新增浏览器入口或改CI选择。

首次范围lint在主用例504行处失败（原上限500），提交钩子也拒绝，原日志保留。随后把原C4选项与诊断包装移入对应helper，主用例只保持两次调用，不改行数规则。最终检查结果由提交前日志与新SHA CI核对；既有route/scenario14例及原CI时限合同2例已通过。真实逐pulse证据待新精确SHA的唯一CI主旅程取得，当前记NOT_RUN，原CI407 FAIL/C4与C5未闭合继续保留。Root范围语义检查不是独立批准或完整PR审查。长期docs不改，因为owner/协议/持久化与产品验收合同保持。
