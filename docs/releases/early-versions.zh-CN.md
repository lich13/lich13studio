# 早期版本记录

以下为 README 中迁出的历史说明，不代表当前迁移会再次执行。

## 0.1.17

- 服务商按 OpenAI、grok、Anthropic 分组，统一平台模型目录。
- 兼容 Sub2API 与 New API CCS 导入、多 Claude 模型和平台修正。
- 修复重复斜杠与 `/v1`；末尾 `#` 保留显式完整端点。
- 从官方来源同步 CLI UA，过滤预发布并保留离线缓存。
- 移除模型健康检查和 API Key 连接测试。
- 迁移 217 合并旧服务商模型并保留用户编辑。

## 0.1.16

- 五档推理强度 `low / medium / high / xhigh / max`，默认 `max`。
- 仅保留 Responses、Anthropic 请求协议；迁移 216 一次性清空旧服务商凭据，保留聊天记录。
- 支持 Sub2API 的 `ccswitch://v1/import`。
- 移除 MCP 执行、配置、安装器和端点；旧工具记录只读保留。
