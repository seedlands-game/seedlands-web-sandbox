# 显式复制与分配账本

以下是源码可证明的删除量，不等同于 CPU、GC 或帧收益。Chunk 固定32³，canonical为65,536 B，fluid为32,768 B。对象头、分配器元数据、structured clone wrapper及隐式容量均未估算。

| 路径 | 本轮每次净减少 | 仍须保留的开销与原因 |
| --- | --- | --- |
| Authority 实体写回 | 每实体每 tick 2次无用快照克隆降为0；60Hz时减少120N次/s | 公开 get/query/update/move 仍返回独立快照；完整稳定物理链克隆从4N+2P降为2N+2P，不能称全部归零 |
| collision baseline transfer接收 | 每 available Chunk 98,304 B、2个 backing allocation | Server仍复制同量以保护权威Chunk，不允许 transfer detach权威数据；公开client默认copy |
| generated canonical prepared-hit | 131,072 B、2个canonical backing allocation | prepared fluid仍slice 32,768 B，隔离preparation cache |
| generated canonical slow admission | 65,536 B、1个canonical backing allocation | 仍复制一份canonical提交Authority；特殊 retained-preparation alias分支净省0，不能计常规收益 |
| Fluid TS Worker独占task | 每Chunk/task 98,304 B、2个backing allocation | Authority lease snapshot与现有跨边界clone保留；Rust路径仍复制98,304 B/Chunk到线性内存 |
| fused Mesh打包 | 每render category少4个中间backing：4P+4N+4U+4I B | P/N/U/I是positions/normals/uvs/indices元素数；最终输出仍必需，colors复用不计重复节省 |
| UV Float32转Float16 | 每次打包少U个4 B backing与2U个TypedArray临时view | 模块级一份4 B scratch和2个view；最终Uint16 UV输出保留 |
| 导航校验/选取 | 少逐cell字符串Set（少窗口情形）和每次open全量排序数组 | 大量微小窗口保留cell Set防止O(W²)；localeCompare优先级、revision和unknown语义不变 |

所有消费接口均为显式 opt-in。公开原纯函数和可复用输入仍隔离；没有将“零参数回调”误说成闭包无法触及结果，可信生产回调必须遵守不修改/转移已保留缓冲的约定。
