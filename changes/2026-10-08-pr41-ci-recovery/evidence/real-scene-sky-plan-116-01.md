# 真实场景 Sky 就绪修复阶段

12:23 已完成 terrain/water/crop 的实际 shader 数学与原 visual，但人工查看精确 `fb6ab514` 的 `day-gallery` 原图发现地面呈黑色。该图片保留在 Cloud 私有 `crop-received-light-green-html-115-02/data/fea4528d2b0b049158c27047b7ab5c638e640d2f.png`。当前证据只证明像素代数与原用例，不证明真实场景受光正确，不视为产品准出。

12:27 重新登记有界阶段：先在原唯一 visual 的实际画廊 capture 中观察同次 four visible chunks 的 Sky 发布就绪与实际 Authority column source，20 秒内目标源未就绪即 RED，保留 failure；不等待无关全局后台完成、不改原时限、不制造空气或裁剪完整世界列。当前假设是原 fixture 修改 y64..66 的 Authority row，而浏览器只呈现 y0..63，完整 Sky 证明所需上方 canonical 在客户端未驻留；它还未由同次浏览器元数据证实，不能直接称根因。

证实后只复用或扩展现有窄 Authority 只读源，使渲染范围之外的遮挡同样取得版本/epoch 相关的真实证明；保持源未知时暗、失效/替换/释放正确以及有界缓冲所有权，不提高世界高度或 RAM/权限预算，不给黑色地面添加兜底环境假光。优先修真实场景，再继续 actor/world-item/viewmodel 的共同 sample。上述仍是原光照合同中的欠交付行，未增加玩法范围。

Root AI 45 分钟 +20%=54 分钟，阶段停止/重估点 13:21 UTC；先用 10 分钟取得真实场景 source/ready 反例和有依据的实现路径，否则暂停该假设。传统工作量暂估 1PD+20%=1.2PD，实际费率/产品额度分母不可读取，不造 credits 或周占比。最新主对话真实 UI 11:40 UTC 剩余76%，12:09 已请求刷新、尚未收到，约60%或停止要求立即保存停止。没有新增 agent。CI412 保持运行，不为重新跑而推送。长期 docs baseline 未改，sealed evidence 未改。

12:31 新证据：精确 `afef730e` 原 visual 真实 RED，四个目标在原定20秒内均未就绪；三个其他 chunk 已发布 Sky。四个 Authority source 均 complete/worldRevision9，并明确有 cy0..4 的真实 resident row；原完整 HTML、receipt 和 `real-scene-sky-source-red-116-01.json` 保留。相同生产 Sky owner 的缺失副本反例为2 FAIL/12 PASS（开放天空/上方真实屋顶均不发布），有依据进入修复。

候选只调用现有 `request-collision-baseline`，独占 transfer 副本不插入 client collision/mesh cache、不请求生成/mesh、不 detach 权威 buffer。精确 key/revision/长度和 runtime epoch 不匹配即拒绝。完整证明只有当前未驻留的必需层才读取；最多16层、canonical暂存最多1 MiB、RPC另含最多512 KiB的fluid副本（丢弃不用），现有proof arrays仍为原最大1 MiB。所有临时副本只在单个pending proof内持有，不增加持久Sky cache的32 MiB上限，不宣称进程总RAM不变或性能收益。未知/非驻留Authority原始记录仍失败变暗，不借此加载或猜测持久层。原epoch/revision/residency/释放fence及task读取量保留；新增延期copy与坏revision/shape反例通过，实际场景GREEN待运行。
