# Hotbar blur 单变量诊断：A/A 不通过

精确生产source48d9ccde48a590115e066d0e51bc5653c9f36d8f、sourceDigest f646f1cddb8959b4d8bdcc36ea9297d5830a9b51f180d263120eca3deed594a7、artifact ef507a095b263719f6b793aaeeda9cc4ec19342f4d7b84e8b1aa7ea97a2f6333、lock882341009384ae16f18f58723d04656da8564759dc8386d871268c5b5521aa71，identified构建289文件PASS，built08:40:48.553UTC。旧4ec产物独立保留，未删除。

独占窗口pr41-blur-aa-ab-105-01，08:41:28.384–08:46:11.025UTC。原Classic low、WebGL2/Chromium151/SwiftShader/960×540、固定paused场景，90s暖机，四段5s稳定+30s rAF；trace screenshots/snapshots/sources全开，实际computed hotbar filter均blur(11px)，四段pose/view/worldRevision/geometry/queues/resident结构不变量均PASS。此为静止因素诊断，不是持续Authority/真实输入/完整玩法或正式组合性能。

四段median帧时300.1/550/483.4/516.65ms，p95为983.3/1250/1233.3/1150ms，帧数76/54/55/56。A1组median391.75ms，A2组533.325ms，差30.608329%，超过预注册15%：A/A FAIL、A/B NOT_RUN、benefit UNKNOWN。没有筛选后两段、提高噪声线或重跑此假设；生产CSS、质量、antialias与原trace保持。不能声称blur已被证明为GPU或900s根因，不能采纳候选。

完整私有raw /workspace/pr41-recovery-20261008-root-01/blur-aa-ab-105-01.json：1311899bytes，SHA2564497e2057a65e1d49ae95b31ab3b36490c1d8b8a022e8fa88a162e769c3f86ab。window receipt blur-window-105-01.json为FAIL、measurement RECORDED，measurement digest b50e630455515a5c211bd78e1200b4cd8366108342cf9be5a83d32d76de9f3b4；warmup及四段trace、script/config/preview/run日志全部保留。新私有测量有真实窗口绑定，记录成功不等于性能通过。

本片未推送、不启动完整CI重试、不修改main/automerge/生产。目录103构建身份在本产物中，原native98与CI409不是本产物产品验收；全PR仍不可合入。实际08:26产品UI周剩78%，约60%停止线不变。本片提前终止于噪声失败，无额外预算扩张。
