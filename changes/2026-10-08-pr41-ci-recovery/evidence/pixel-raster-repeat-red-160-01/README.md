# 同对象重复SVG栅格A/A反例160

localaef4d3f2，旧生产不变，原visual一次FAIL78906ms。130图标260case，105个16px同control对象repeat不同，paper同DOMrepeat也不同；32px全同。红石首次46种RGBA、repeat3种，paper首次27种、repeat3种；完整纸张/红石RGBA已保留。相同对象/相同尺寸的first-vs-repeat不稳定确证measurement失效，不代表几何缺陷。

下一候选只改变读回Canvas2D用途声明，禁止以warmup/丢弃first等方式通过。旧生产保留、原main151未启动。
