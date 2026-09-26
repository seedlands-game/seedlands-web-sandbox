# Classic Media Asset Import Evidence

状态：已按用户授权完成资源复制和双端校验；本文件只证明文件身份，不证明许可、Pack manifest 接线、构建或浏览器播放。

## 授权与边界

- 用户指定源文件：`/Users/bytedance/Downloads/_sorted/media/overworld/Lifeformed × Janice Kwan — To Far Shores.mp3`。
- 目标 Mod 资源：`playbooks/classic/assets/audio/to-far-shores.mp3`。产品声明只使用该仓库相对路径，不依赖用户机器的 Downloads 路径。
- 本次只复制文件，保留且不修改源文件；未扫描 Downloads 其他内容、未下载替代曲、未修改权限。
- 资源由用户提供，许可状态 **unknown**。`ASSETS.md` 未将其声明为原创、开源、Apache-2.0 或 CC BY 4.0。

## 复制前校验

复制前精确读取指定源文件：

```text
bytes=2976045
sha256=3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9
mode=-rw-r--r--
destination_exists=no
```

源文件 bytes 与 SHA-256 均完全匹配用户冻结值，且目标不存在，因此未覆盖任何已有内容。

## 复制后读回

复制完成后再次独立读取源和目标：

```text
source bytes=2976045 mode=-rw-r--r--
source sha256=3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9
target bytes=2976045 mode=-rw-r--r--
target sha256=3c69ae745727607de266898ab68a92c7c75f7f08e27daf0c6cec463f7bd119c9
```

源文件仍存在且内容未变，目标内容与冻结值逐字节摘要一致。

只读核对 `playbooks/classic/src/media.ts`：`seedlands:to-far-shores` 的 resource 已声明为 `{ packId: 'seedlands:overworld', path: 'playbooks/classic/assets/audio/to-far-shores.mp3' }`，与目标相对路径一致；本任务未修改该声明、Pack schema/build/lock 或 runtime。

## 未验证

- 未运行 tests、typecheck、build、browser、Web Audio 解码或真实播放。
- 未验证 Pack manifest/lock 已纳入该资源；该公共接线由后续 Media 集成 owner 负责。
- 未确认音频的版权、授权范围或再分发许可。
