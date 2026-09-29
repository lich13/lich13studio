# ModelTrace

指纹数据来自 [Hanmo123/ModelTrace](https://github.com/Hanmo123/ModelTrace)，该项目基于 xqy2006/ModelTrace。保留原 MIT 许可证及版权声明，见 `MODELTRACE-LICENSE.txt`。

`data/manifest.json` 固定来源分支、提交、评分器和挑战模板哈希。`data/unified_bank.json` 保留上游原始字节；两个 upstream 模块仅用于回归对照，不在运行时下载执行。

运行 `pnpm modeltrace:update` 从脚本中固定的提交更新快照；`pnpm modeltrace:check` 验证可复现性。变更评分器或挑战模板前，必须适配本地算法并通过一／二／三组评分对照测试。

应用启动及每小时检查 `hanmo` 分支，在同一提交下校验数据与兼容性后原子保存到独立的 `lich13studio-modeltrace-cache` IndexedDB。缓存不参与聊天备份；失败沿用最近有效库。每轮测试、报告及失败组重试固定同一份库。

本应用保留自己的回答准入规则：思考内容隔离、完整整数序列、至少 80 个范围内整数，不使用上游的最长数字段提取或 55% 数量门槛。评分公式和校准参数不变。挑战额外要求输出完立即停止；1／2／3 并发不改变挑战、目标或最多三次尝试，重试等待不占请求名额。
