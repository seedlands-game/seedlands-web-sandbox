# Classic v3 生产浏览器验收

2026-09-22，第五轮：自动场景PASS（13.7s，含runner共20.7s），24张原始帧。runId `2b001153-b3e9-44f7-a3b0-b5cfc286e31e`；完整身份见[visual-identity-and-observations.json](visual-identity-and-observations.json)，页面/网络资源/渲染错误均为空。此为视觉与行为正确性诊断，不是性能基准。

## 目视确认

- [猪正面](pig-front-closeup.png)：粉色躯体、独立口鼻和四肢可辨，未再出现黑盒。
- [骷髅正面](skeleton-bow-front-closeup.png)及[持弓侧面](skeleton-bow-side-closeup.png)：骨架、握持及弓朝向；几何/动画合同另见creatures-evidence。
- [植物近景](plants-closeup.png)：花头在上，茎在下，双面交叉透明轮廓；真实鼠标选取后步行穿过，植物保留。
- [八类光源](night-eight-light-types.png)及[移除](night-sources-removed.png)：纹理身份保留，光源照亮周边，移除后周边暗下。
- [封顶无光房间](sealed-room-unlit.png)、[加入辉光石](sealed-room-glowstone.png)、[隔墙遮挡](sealed-room-occluding-wall.png)：环境亮度与遮挡真实可见。
- [单击只破坏前方方块](creative-one-click-one-block.png)：真实PointerLock鼠标输入；前方为空，20物理tick后后方石块仍在。
- [创造目录](creative-catalog-icons.png)、[楼梯图标](creative-stair-icons.png)：灰色像素UI与实际模型缩略图。

之前四轮保留于相邻browser-attempt目录：包含失败与自动通过但被UI遮挡的反例，不能当成最终暗室证据。完整旧C0–C5旅程仍依赖退役NPC，未以本场景冒充通过。
