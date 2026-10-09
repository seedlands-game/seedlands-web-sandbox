# checkpoint37：门撤退双端路线

Browser27在V1门retreat readiness失败，未进入V2；原trace/results/failure保存于Root browser-27-results与browser-27-failure-37-01.json。此diagnosis只摘录原始值并记录静态计算plan，原始数据不改。旧route在camera69.491、server70.492时返回，没有S键；修复复用已存在双端/ACK/drift路线，保留门外和碰撞断言。真实复验尚未运行，不声明性能改善或可合入。

根`door-retreat-static-37-01.log` exit0：Classic全类型/scoped lint、6文件51/51 PASS。源码仅V1 retreat调用/import，未动生产或回归断言，无新增fixture与runner；原Browser27为有效RED，后续build27/browser28待运行。模块import无反向cycle。长期docs职责未变，沿用既有地图。
