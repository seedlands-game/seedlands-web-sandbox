# 真实场景 Sky 源接入交付

精确生产源 `22034491dda7fb0643972ebc18d978bbb50f7235` 修正真实画廊因上方已存在 canonical 未进入客户端呈现镜像而无完整 Sky 证明的问题。完整 source 及20秒目标就绪 RED 在 `afef730e` 保留；生产 Sky owner 的开放天空/真实上方屋顶反例为2 FAIL/12 PASS。没有给源未知的地面加兜底假光。

候选从现有只读 baseline RPC 取得实际缺失层的精确 key/revision/shape/runtime epoch 独占副本，不插入 collision/mesh cache、不 detach 权威 buffer、不生成 mesh。临时副本最多16层，只供单次完整证明；新鲜度、实际任务读取量、发布/失效与32 MiB持久Sky缓存上限保持。非驻留Authority记录仍可能不可读并严格保持暗，这类持久层/恢复矩阵不能宣布已闭合。

三个相关Web文件40例PASS，含延迟epoch/revision/释放、坏版本/长度/未知和真实屋顶；source-port提取后8例及Classic types再通过。首次正常commit因客户端509有效行超过500而被拦，保留失败日志；移入现有column-source职责模块后正常hooks通过，没有豁免门禁。Web/Svelte 0 error/0 warning、生产tools类型及识别构建PASS：289文件、sourceDigest `fb4cc262b98d702d25abfc61fcb748cd2203c25e3d66f85a5ceccc1604968465`、artifactDigest `d4879de287666936a600253a4cb9221898360bb87d4fe0eb919e4a32d58f69cf`。

原唯一入口 visual `pr41-real-scene-sky-green-116-02` PASS（1.9分钟、NON_MAIN、无冲突）：四个实际画廊chunk逐次capture的Sky就绪在20秒内通过；33项真实WebGL2像素、原gallery、连续帧、单击破坏保留。人工查看同次原图：白天石材地面及植物恢复可见，移除夜间源后明显变暗。原图和私有完整HTML/日志/`real-scene-sky-green-receipt-116-02.json`/`real-scene-sky-green-pixels-116-02.json`保留。手持物夜间仍偏亮，actor/world-item/viewmodel共同sample尚未接入，不能视为五消费者/完整矩阵准出。

同一生产源原native cart `pr41-real-scene-sky-native-116-03` PASS（44.3秒、runner48.4秒、NON_MAIN、无冲突），真实右键上车、键盘行驶、Shift右键下车和同一存档恢复保留；receipt私有备份完成。SwiftShader只作功能证据，无物理GPU或性能收益声明。

远端前一head `3a27a332` CI412 run `38051165120`已结束：五项静态/确定性/构建、visual（2.0分钟）、native（49.6秒）通过；主旅程初次15.3分钟触及900秒上限，停在V2装备creative资源准备；retry8.4分钟在V1闭门检查得到pending/insufficient-contact-hold而非原blocked。保持失败断言，Modular未运行、preview跳过。该原主旅程与194内容/装备死亡/其余交通/最终精确SHA CI等ledger阻塞未关闭。

12:49据新证据结束12:27登记的Sky场景阶段（22分钟，未到54分钟停止点），再为共同sample登记有界计划。主对话12:28 UTC实测周剩余76%，4天14小时重置，约60%立即保存停止；不按token/墙钟换算额度。无sealed evidence改写，长期docs baseline未改。
