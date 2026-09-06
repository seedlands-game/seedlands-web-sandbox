# 原创界面资产记录

- 资产：`public/assets/ui/obsidian-brass-panel.png`
- 用途：面板与快捷栏的九宫格边框/填充；CSS slice 为 140，界面边缘按 14–18px 绘制。
- 来源：内置 Image Generation；原始输出保留于 Codex generated_images，本项目复制一份消费。
- 大小：2,119,538 字节；原图直接使用，未额外修改或伪造 alpha。
- 初步验收：实际首屏、HUD、命令面板已截图；首轮 Midscene 指出快捷栏金属语义不明确，加入同源框体与更明确的选中状态后第二轮 2 个任务均通过。
- 许可证：与项目原创体素资产一致采用 CC BY 4.0，署名 Seedlands Project contributors；范围以贡献者可许可权利为限。

## 最终生成提示词

提示词保留生成工具的原始英文协议描述：

```text
Use case: stylized-concept. Asset type: one production-ready square nine-slice UI panel texture for Seedlands, an original stylized fantasy voxel game. Create a flat orthographic 2D UI panel, exactly square, filling the entire image edge to edge, 1024x1024. A very dark charcoal obsidian stone center, nearly uniform and quiet, with extremely subtle low-frequency hand-painted stone grain and no lighting hotspots. Around all four edges a narrow aged warm brass metal frame, restrained fine bevel highlights. Corners feature small angular engraved geometric corner brackets, not medieval floral decoration. All detail must stay within the outer 96 pixels; the middle long portions of all four edges must be uniform and repeatable so CSS nine-slice can stretch them. The huge center must stay empty to place readable text over it. Color family: near-black slate/obsidian, muted antique brass, small pale gold edge glints. A crafted ancient arcane civilization aesthetic, sophisticated material realism but painterly game UI, crisp edges and no perspective. No text, no letters, no title, no icons, no inset scene, no buttons, no rune in the center, no gradients pretending to be 3D, no glow, no vignette, no background outside the panel. Do not produce a mockup or multiple panels: ONLY ONE square panel asset.
```
