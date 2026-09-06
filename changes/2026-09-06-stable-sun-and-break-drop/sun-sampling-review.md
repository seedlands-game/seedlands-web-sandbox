# 太阳阴影采样口径独立审查

## 身份与范围

本记录是太阳阴影数值门禁的独立审查，不评价尚未执行的最终浏览器结果，也不替代 Midscene 对自然、清晰和世界稳定的视觉判断。

- 上一轮独立审查绑定的 spec SHA-256：`e1269410974a12fb079bbea6f036ba67c7412378a2a5b4d8bcf9ab73a27a229d`
- 本轮修改采样合同前的 spec SHA-256：`23e68cd6961fdd6a895f583a1e6df28f5769cb40ddc9ba5e08541d8817889da1`
- 下列“固定采样合同”按 UTF-8、LF、末尾一个换行计算的 scope SHA-256：`16a1f4dda6ab051c46ca156e8592413bcf2ef493cc06f01156feff0ad93d66f4`

采样口径属于 Acceptance 的实质变化。最终交付应把实现后的 spec 新哈希与本记录重新绑定，不能沿用上一轮哈希宣称批准。

## 已确认的问题

旧运行态门禁直接比较相邻帧绿色通道的平均绝对差，并固定要求 p95 小于 0.25、max 小于 0.6。每次采样同时同步读取宽 ROI 并在主线程扫描约百万像素；不同阴影过滤成本使采样帧间隔不同，较长间隔对应更大的合法太阳方向变化。因此旧绝对差不能在候选之间直接比较。

旧数据必须原样保留：

| 候选                  | 旧 raw p95/max   | 结论                                        |
| --------------------- | ---------------- | ------------------------------------------- |
| High 原单级           | 0.488/0.990 左右 | 旧基准 RED；缺少表现时刻/方向，不能离线改判 |
| High 三级 0.65 + PCF3 | 4.56/4.79 左右   | 明显 RED                                    |
| High 三级 0.25 + PCF3 | 0.268/0.661      | 旧绝对口径 RED                              |
| High 三级 0.25 + PCF5 | 0.284/0.762      | 旧绝对口径 RED；采样 p95 帧间隔约 22.4ms    |
| High 三级 0.15 + PCF3 | 0.286/0.740      | 旧绝对口径 RED                              |

只读离线回算表明，新口径能保留区分力：High 0.65 + PCF3 约为 4.106/4.457，Medium 已接受组合约为 0.157/0.478，High 0.25 + PCF3 约为 0.213/0.655，High 0.25 + PCF5 约为 0.193/0.403，High 0.15 + PCF3 约为 0.201/0.577。这些数值只验证指标方向，不是最终候选的通过证据。

## 固定采样合同

```text
采样对象：固定种子 stable-sun-forest、固定相机、Medium 与 High 的地面宽 ROI。
参考运动：14.93h、权威正常速率 0.04 world-hour/s、名义 60Hz；thetaRef 为相邻参考太阳方向的夹角。
运行窗口：累计真实太阳方向夹角达到 240 * thetaRef 后结束；最多 1000 帧或 20000ms，未达到即失败。
运行指标：每对相邻帧以 rawDifference * thetaRef / actualDirectionAngle 归一化；方向夹角不超过 thetaRef * 0.05 时不用除法，按 rawDifference < 0.05 的近零运动规则判断。
阈值：归一化 difference 的 p95 < 0.25、max < 0.6；方向有效前进帧比例 > 0.9；GL error 为 0 且 ROI 非黑。
冻结指标：等待渲染交接后固定 36 帧，raw difference 的 max < 0.05。
时间戳：rafAt、太阳方向与表现时刻均在 readPixels 前记录；readbackAndScanMs 单列，仅诊断采样开销。
性能边界：readPixels 窗口不产生正式 FPS 结论；生产 p95 <= 20ms、max <= 33.34ms 只取天然森林无 readPixels 的独立 rAF 段。
证据边界：保留全部旧 raw JSON 与旧绝对口径 RED；三级分布 0.65 的已知坏候选必须在新门禁下保持 RED；最终候选必须重新采集，不能用离线回算替代。
视觉边界：数值门禁不证明阴影清晰自然，连续原图、视频与 Midscene 继续检查跳变、世界锁定、遮挡响应和过度模糊。
```

## 实施与复核要求

采样器返回原始帧、累计角位移、目标角位移、是否达到目标和实际采样时长。运行窗口只有达到固定角位移才算完成；帧数或时间上限先到时必须失败，不能用不完整窗口计算通过。

方向夹角直接使用同次渲染前读取的真实太阳单位向量。近零角位移帧不参与归一化分位数，而是使用冻结阈值检查，防止除以极小数，也防止无运动时的闪变被忽略。运行态仍保留原始 difference、changed、GL error 和 ROI mean，便于复盘。

首次正式运行至少包含：

1. 已知坏的 High 三级 0.65 + PCF3 负控制，必须 RED。
2. Medium 当前候选，必须保持 GREEN。
3. High 最终候选，必须以同源不可变构建重新采集。
4. 冻结窗口、遮挡物删除响应和天然森林无像素读取帧成本分别通过。
5. 连续原图、视频与 Midscene 确认没有通过扩大过滤核或模糊叶孔来隐藏闪烁。

## 实施证据

纯逻辑反例位于 `/tmp/sun-shadow-sampling-contract.test.ts`。在采样器导出归一化合同之前，Vitest 实际得到 2 项 RED：`normalizeSunMotionSamples is not a function`。实现后同一命令得到 2/2 GREEN，分别证明相同每单位太阳角位移的变化不受一倍或两倍帧间隔影响，以及近零角位移不做除法并保留 raw difference。

采样器和需求用例完成后，`tsconfig.test.json` 类型检查、两个变更文件的 ESLint、三个归属文件的 Prettier 与 `git diff --check` 均通过。浏览器负控制、当前 Medium、最终 High、冻结和遮挡响应仍由独立执行者运行，本记录不提前填写结果。

## 准入结论

批准按固定 scope 实现采样器和需求用例。旧绝对门禁的失败记录继续有效，但不再作为不同采样间隔候选的最终比较依据。任何阈值、参考角速度、ROI、角窗口、近零规则或时间/帧上限变化都会使本审查失效。

## 最终合同绑定复核

- 复核身份：独立 Sol；委派元数据未提供可验证的 reasoning effort，不在本记录中猜测。
- 复核 spec SHA-256：`bb7fe43d0a9f06e9751968a635949bc7b3736b2c4b60782f2ecfefc52716767a`。
- 固定采样 scope SHA-256：`16a1f4dda6ab051c46ca156e8592413bcf2ef493cc06f01156feff0ad93d66f4`，阈值、ROI、参考角、角窗口、近零规则和上限均未改变。

当前生产策略与 spec 的“最终生产决策”一致：Medium 使用 512、分布 0.65 和 PCF3；High 使用 1024、分布 0.25 和 PCF5；两档均保持三级级联、58m 距离、0.15 边界混合和 REALTIME 更新。`EnvironmentPresentationClock` 只在表现层以 50ms 时间常数追随权威目标，单帧 dt 上限为 100ms；暂停与显式设时立即重置。光源方向、环境色和世界空间太阳均读取同一个表现时刻，没有写回权威时钟。PlayCanvas 2.21.4 的本地声明和着色器实现确认 PCF5 是公开选项，并以九次比较采样实现有效 5×5 过滤；本次没有冻结阴影、降低 1024 分辨率、缩短 58m 距离或关闭实时更新。

独立读取 `/tmp/seedlands-sun-angle-pcf5/results.json`、`high-temporal.json` 与 `high-frozen-temporal.json` 确认：High 固定角窗口实际达到 0.0511633rad，目标为 0.0509892rad；199 帧中方向有效前进比例为 0.994949，归一化 p95/max 为 0.193954/0.362068，GL error 全为 0，ROI 均值保持非黑；冻结 36 帧 raw max 为 0。该结果是新合同下的真实重采，不是旧数据离线回算。spec 同时保留旧 High 推进比例 0.365、坏分布 0.65 的 1.703/1.790，以及 High 0.15 + PCF3 的 max 0.625 三类 RED，能够证明新门禁没有自动放行旧阶跃或失败候选。

最终准入仍有两个明确边界：High 的 PCF5 成本必须由同一最终构建的天然森林无 readback rAF 段满足 p95 不超过 20ms、max 不超过 33.34ms；连续原图、视频与 Midscene 仍需证明世界锁定、遮挡响应和没有因过滤造成不可接受的过度模糊。正在执行的全六项结果只能更新 Evidence、Tasks 与 Delivery Snapshot；若行为、决策或采样 scope 改变，必须重新绑定 hash。

当前 spec 的历史诊断段仍把后来被新门禁否决的 High 0.15 + PCF3 称为“最终生产候选”，并写“未采用 PCF5”，与后文最终决策相反。交付前应把该句明确改为“新合同重采前的阶段候选”，并注明其随后因 max 0.625 被否决。此项是文档时间线更正，不改变本次已复核的最终行为合同；更正完成前不能引用该历史段作为最终配置证据。

在上述成本、视觉和文档时间线条件满足后，本审查批准 `bb7fe43d…` 所定义的最终太阳合同。当前结论不替代尚在执行的全六项浏览器结果，也不批准通过改阈值或省略 High 天然帧成本来交付。

## 全六项复跑的单帧尾项裁定

同一最终 PCF5 产物在全六项复跑中得到归一化 p95/max `0.185551/0.630276`；其中 p95 继续通过，但单帧 max 超过预置的 `0.6`，必须保留为真实 RED，不能用上一轮通过或重复运行覆盖。独立对齐两份原始序列后确认，上一轮和本轮最坏事件分别发生在累计太阳角 `0.014859rad`、世界时刻 `14.976533` 与累计太阳角 `0.014815rad`、世界时刻 `14.976394`。两者是同一个稳定空间位置附近的级联阴影离散更新，不是随机出现的新热点。

两轮的 raw difference/changed fraction 分别为 `0.760244/2.1217%` 与 `0.604700/1.7815%`；事件本身真实存在，但幅度没有随归一化 max 同比例恶化。归一化分母分别为 `0.000446098rad`，约为 `2.10 * thetaRef`，以及 `0.000203834rad`，约为 `0.96 * thetaRef`。因此当前 per-pair max 会根据浏览器恰好在哪一帧跨过 shadow-map texel snap，把近似同一离散事件除以约一倍或两倍参考角；`.362068` 与 `.630276` 不能作为同产物稳定性差异直接比较。相邻归一化 p95 `0.193954/0.185551` 保持一致，也支持“尾项估计器对采样相位敏感”，而不是全窗口噪声重新升高。

本次不据此批准生产，也不要求继续调阴影参数。天然森林 Medium/High 无 readback 帧成本、同源 Midscene 与连续原图均通过，降低了普遍可见闪烁和过度模糊的风险；但这些帧没有精确证明上述受控峰值在视觉上不可见。合规处置是先修订尾项测量合同并重新绑定 spec，而不是重复运行挑选低于 `0.6` 的一次：

1. 保留相邻帧归一化 p95 `< 0.25`，继续约束持续噪声。
2. 将 tail max 改为固定角支持窗。每个窗口累计方向角至少达到 `2 * thetaRef`，用 `sum(rawDifference) * thetaRef / sum(directionAngle)` 计算，再取全部窗口最大值；`2 * thetaRef` 对应现有 60Hz 参考下 33.34ms 的生产帧上限，不是根据本次失败事后放宽阈值。max 阈值仍为 `< 0.6`。
3. 现有两轮数据按这个固定支持窗离线计算的尾项分别为 `0.362068` 与 `0.359258`，说明它能消除同一离散事件的一帧/两帧切片差异。该离线结果只验证度量稳定性，不能替代修改后的正式浏览器运行。
4. 已知坏的 High 0.65 + PCF3 必须用新尾项门禁重新执行并保持 RED；同时保存候选 top raw jump 的准确前后原帧或差分热图，由 Midscene 或人工视觉复核离散变化是否构成可见闪转。若负控制被误放行、固定窗候选仍 RED，或峰值原帧显示明显闪转，则返回生产修复。

因此，当前全六项数值结果的审查状态是“测量合同尾项不稳健，产品候选待固定支持窗与峰值视觉证据复核”，不是通过，也不是已证明生产回归。该修改会实质改变 Acceptance 数学口径，必须产生新的 spec SHA-256 并重新独立绑定；在此之前仍以本节记录的 RED 和不确定边界为准。

## 修订后的尾项固定合同

- 本次修订前的 spec SHA-256：`bb7fe43d0a9f06e9751968a635949bc7b3736b2c4b60782f2ecfefc52716767a`。
- 下列合同按 UTF-8、LF、末尾一个换行计算的 scope SHA-256：`d1cc40895dbf11c6f4aba753a65172c9d638931749c5ab93869cf9e64cfe944d`。

```text
运行窗口、thetaRef、pair 归一化、近零规则、方向进度、GL、ROI、冻结和性能门禁保持不变。
pairNormalizedP95 继续取所有有效相邻 pair 的 normalizedDifference p95，阈值严格小于 0.25。
pairNormalizedMax 继续记录为诊断字段，不再承担准出判断。
tail 支持角固定为 2 * thetaRef。对每个相邻 pair 起点，向前选择累计 directionAngle 第一次达到或超过支持角的最短连续区间；tail score = sum(rawDifference) * thetaRef / sum(directionAngle)。末尾无法形成完整支持区间的起点不计入 tail；整个运行窗口至少必须产生一个完整 tail 区间，否则失败。
tailNormalizedMax 取全部完整 tail 区间的最大 score，阈值严格小于 0.6；阈值、thetaRef、总角窗口、超时和帧上限均不得弱化。
采样期间只保留 pairNormalizedMax 对应的前后两份 ROI RGBA 像素和其 rafAt、sunTime、directionAngle、rawDifference、changed、normalizedDifference；不按帧累计截图。结束时按 WebGL 自下而上的行顺序做垂直翻转，输出可正常查看的前后 PNG data URL；测试把 PNG 独立附加，JSON 只保存峰值元数据。
旧 per-pair max RED 和全部原始证据继续保留；已知坏 High 0.65 + PCF3 必须在修订门禁下保持 RED，最终 Medium/High 必须以固定不可变产物各执行一次，禁止重复运行挑选 GREEN。
```

修订用纯逻辑反例 `/tmp/sun-shadow-tail-window.test.ts` 先执行为 4/4 RED，实际错误为 `normalizeSunMotionTailWindows is not a function`。实现后同一命令为 4/4 GREEN，分别锁定同一跳变被一帧或两帧切分时 tail score 相同、合成坏对照仍超过 `0.6`、每个起点只取向前最短完整支持窗，以及没有完整支持窗时 fail closed。同一四项已持久化到 `tests/app/sun-shadow-stability.test.ts`，与原有6项一起定向实测10/10 GREEN。`tsconfig.test.json` 类型检查与三个归属文件的 ESLint 均已通过；本记录不将这些轻量证据代替浏览器负控制、最终两档和峰值原图复核。

## 修订后 spec 重新绑定

- 复核身份：独立 Sol；未提供可验证的 reasoning effort，不做猜测。
- 实际复核 spec SHA-256：`abba093c4d16f274b39c7a6fcf91c2a2f896420dd615a4d9908ce41f96ebce7c`。
- 尾项固定支持窗 scope SHA-256：`d1cc40895dbf11c6f4aba753a65172c9d638931749c5ab93869cf9e64cfe944d`。

独立逐项核对确认，spec 已把 High 0.15 + PCF3 更正为被新门禁否决的阶段候选，最终生产仍是 Medium 0.65/PCF3 与 High 0.25/PCF5。新合同仅把尾项从对帧相位敏感的 pair max 改为 `2 * thetaRef` 最短完整前向支持窗；pair p95、pair max 诊断、`0.25/0.6` 数字、近零、进度、GL、非黑 ROI、冻结、240 倍总角窗口、帧/时间上限和天然性能门禁全部保留。峰值取证只保留当前最大 pair 的前后两份 ROI，不建立逐帧图像历史；PNG 导出时翻转 WebGL 行序。合同没有冻结阴影、降画质、降分辨率或改阴影生产策略。

按此 hash 批准执行一次坏 High 0.65/PCF3 负控制与一次最终 Medium/High，并审查最大 pair 的前后 PNG。负控制必须 RED，最终两档必须满足保留后的全部门禁，峰值图不得出现大范围亮暗翻转或阴影位置突跳。任一项不满足均返回生产修复，不通过重试挑选 GREEN。

## 固定支持窗的最终数学准入

独立直接读取 `/tmp/seedlands-sun-tail-final/results.json`、`medium-temporal.json`、`high-temporal.json` 和两份冻结 JSON，确认这是一次 Medium/High 2/2 GREEN，`unexpected=0`，未使用先前的低峰值运行替代。

| 质量   | 方向进度 | pair p95 | pair max 诊断 | tail max | 完整 tail 窗 | 冻结 raw max |
| ------ | -------- | -------- | ------------- | -------- | ------------ | ------------ |
| Medium | 0.995868 | 0.154131 | 0.466113      | 0.268856 | 241          | 0            |
| High   | 0.994949 | 0.205468 | 0.360793      | 0.311325 | 198          | 0            |

两档均达到 `0.0509892rad` 总角窗口，GL error 全为 0，ROI 均值非黑，近零 pair 各一个且 raw difference 为 0。独立遍历输出的 tail windows 确认，每个已记录窗都达到 `2 * thetaRef`，移除其最后一个 pair 后均未达支持角，末尾不完整起点没有混入 max。两档 tail max 均严格小于未改变的 `0.6`，pair p95 均严格小于 `0.25`。

独立读取 `/tmp/seedlands-sun-tail-negative-valid/high-temporal.json` 确认，已知坏 High 0.65/PCF3 的方向进度仅 `0.375587`，pair p95 为 `1.702818`，tail max 为 `1.790263`。运行首先在保留的方向进度门禁 RED，但原始 JSON 也证明新 tail 本身超过 `0.6` 近三倍；固定支持窗没有把该负控制改判为稳定。页内峰值与 Node 复算存在约 `4.4e-16` 的浮点末位差，附件自校验使用 12 位近似；它不改任何门禁值。

最大 pair 的 Medium/High 前后 PNG 尺寸分别为 `2196×532` 和 `2496×604`，图像中地面、阴影与右下手持模型方向正常，证明 WebGL 行序翻转正确。独立逐对观察未看到大范围明暗翻转或阴影整体位置突跳；可见变化局限于影子边缘的细小采样移动。此原图审查是峰值定点证据，仍由同一四张附件的 Midscene 结果完成最终视觉语义准出。

数学门禁和负控制由此准入。该结论仅批准 `abba093c…` spec 与 `d1cc4089…` scope 定义的尾项修订，不授权之后改阈值、参考角、ROI、窗口、High 生产参数或省略峰值 Midscene。

## 最终交付身份与结论

- 最终 spec SHA-256：`3dffe179eedd7cfc6dbff1a437bda612a9962a0473fd6f7d786f450e9e3f5c97`。
- 太阳生产提交：`bf61525ce3cf2d2cb33fe84c066197a50921d199`。
- 尾项 scope SHA-256：`d1cc40895dbf11c6f4aba753a65172c9d638931749c5ab93869cf9e64cfe944d`。
- 长期基线：9/9 GREEN，真实退出0，run id `11ae8820-1770-4945-aae2-26456097354c`，source SHA 为 `bf61525ce3cf2d2cb33fe84c066197a50921d199`。
- 峰值视觉：`evidence/sun-peak-midscene-summary.json` 记录 1/1 GREEN，7.204s，无重试选择证据。
- 静态组合证据：格式、ESLint、路径规则与覆盖率运行中748项通过、4项跳过，world 行覆盖率96.37%；后续修正测试元数据可空类型后，完整 typecheck 与受影响格式/lint GREEN。原 EXIT2 保留，不将该组合证据写成末次全量 `verify:static` 退出0。

独立比对 `bf61525` 中的 spec 与最终 spec，差异仅为 Tasks 状态、Delivery Snapshot 和交付证据补录；Scope、Decisions、Behaviour、Test Design、Acceptance、全部门禁数字和最终生产策略都未改变。因此 `abba093c…` 的实质合同审查对最终 `3dffe179…` 继续有效，并以本节绑定当前完整文件身份。

最终准入。数学门禁、已知坏负控制、Medium/High 峰值原图、峰值 Midscene、天然场景无 readback 帧成本、持久化单元反例、生产构建、长期基线和静态组合证据共同满足 `3dffe179…` 的本地交付合同。该准入不改变 spec 已记录的设备/场景边界，也不将本地通过扩大为 PR 已合并或所有硬件下逐像素永远不变。

## 推送后最终文档身份

生产提交 `bf61525ce3cf2d2cb33fe84c066197a50921d199` 真实推送且 PR #7 说明更新成功后，spec 仅将“记录交付、本地提交并更新 PR”勾选完成，并把当前阶段改为已推送。最终 spec SHA-256 为 `c18990c6af869ae3ebb6789ebcbdaf2bbe70335e9be6e72af1e9c6cd7a885048`。Scope、Decisions、Behaviour、Test Design、Acceptance、尾项 scope hash、所有门禁数字与生产实现均未改变，因此无需重复实质评审。本节只把已准入合同绑定到交付后的最终文件身份，原准入结论保持。
