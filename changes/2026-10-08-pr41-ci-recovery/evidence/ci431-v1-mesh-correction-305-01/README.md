# CI431 V1 木门网格勘误

120c6ff5 中三个记录误写为空间中心 predicate。实际是 V1 木门下半块 renderedMaterialMesh 未返回，thinAxis 为 -1，上半块为 0；期望两者均为 0。来源：同 SHA CI431 Chromium 日志与 v1-slice.ts:144。原封存文件保留，结果未改变；重试 V2 超时、visual 一次通过及 minecart flaky 的分类不变。
