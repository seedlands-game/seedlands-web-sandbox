# PR41 当前交付与有限合入阻塞

2026-10-10 12:50 UTC：仍不可合入，保持 Draft。不 merge/automerge/main push/生产部署。此表替代旧 ledger109 的时间状态，旧文件原样保留；局部通过与 checkpoint 数量不代表产品完成。

## 已有实际交付

接手 `2d144c36` 后的 CI 工具链/不可变证据格式边界、确定性夹具和 Classic headless 问题已在远端 CI411/412 的相关静态、确定性、构建任务验证通过。既有真实输入、植物种植/生长及 chunk presentation、普通矿车放置/选取/键盘与上下车/同存档恢复、当前载体碰撞、方块光失效等改动保留，但这些不闭合全部内容与交通矩阵。

最新本地生产源 `22034491`：Pack-owned lighting profile 和明确 legacy 缺省已严格校验；地形、水、植物以同一环境 frame 在线性 received 通道合成 Sky×visibility+R8 block，自己的 emission 独立。真实上方已存在源通过版本匹配的只读暂存副本参与完整 Sky 证明，不生成 mesh、不猜空气。真实画廊黑色地面已修正，四个目标20秒内就绪；原 visual（1.9分钟）、33项WebGL2固定像素、原native cart（44.3秒）PASS，精确 identified build 与范围类型/正常hooks PASS。[真实场景交付](real-scene-sky-delivery-116-01.md)记录身份和限制。

## 尚须闭合的原需求

| 阻塞域           | 当前实际缺口                                                                                                                                    | 关闭证据                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 当前真实主旅程   | CI412 首次 V2 creative 装备资源准备900秒超时；retry V1闭门所得pending/insufficient-contact-hold不满足原blocked。成因未证实。                    | 有依据的最小修复，原完整真实输入主旅程和精确身份原验收通过；保留原断言、超时和质量。                      |
| 内容行为         | 原194族、装备/护甲/死亡、V2–V4和完整存档矩阵尚未全部准出。                                                                                      | 原矩阵逐族 owner/input/presentation/save/test，原主旅程及死亡恢复证据闭合。                               |
| 其他交通         | 已验证直线普通矿车，不能推及其余 rail/carrier/boat、转角/坡道、箱子/燃料/安全下车和旧存档兼容。                                                 | 原交通矩阵的真实玩家输入、碰撞、表现与保存/重开证据。                                                     |
| 剩余统一受光     | actor/world-item/viewmodel共同sample尚未接入，手持物夜间偏亮；室内/遮蔽/跨chunk/质量/存档完整矩阵未闭合。非驻留Authority持久层仍严格fail-dark。 | 原SurfaceLightingSample和实际WebGL2输入/像素/场景矩阵；现有terrain/water/crop局部证据不能代替全部消费者。 |
| 最终集成与审阅   | 新精确head必需CI/review/冲突/preview尚待完成；此前Modular正常动作/恢复局部PASS不能替代最新完整旅程。                                            | 正常feature push后精确SHA全必需检查、当前review处理和冲突检查；产品全部证据闭合前保留Draft。              |
| 有条件的优化声明 | 仓库要求保留的速度/资源/成本优势必须有受控同身份对照；当前功能readback不证明性能。                                                              | 审计保留理由，声称优势的改动取得A/A、分项与组合对照；失败/未知实验不作为收益。                            |

最新远端 `3a27a332` CI412 run `38051165120` 五项静态/确定性/构建以及visual/native通过，主旅程失败、Modular未运行、preview跳过。局部NON_MAIN不关闭canonical主旅程。最终状态以推送后精确SHA的实际CI为准。

## 证据与边界

上述194族、其他交通、V2–V4/死亡/save、共同受光/R8 Sky/实际WebGL2/真实输入矩阵和最终CI/review都来自接手时原spec，并非新增需求。任务新增定向native cart、只读诊断、回执和有限反例用于保护/观察原实现，不新增玩法。撤回的observer/snapshot/blur等候选及其失败原始记录保留，不因另一主旅程失败而追加无依据性能实验。

SwiftShader仅作功能证据，不等同物理GPU；不能直接读取远端ZIP的既有网络限制不等于失败原因，原始CI日志仍可用。主对话12:28 UTC实际产品UI周剩余76%，约60%停止线不变，Cloud不能直接读取该UI，不按token/墙钟换算额度。长期docs baseline未改，sealed evidence未改。
