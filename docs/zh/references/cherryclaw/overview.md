# 兼容代理源码

`src/main/services/agents/services/cherryclaw` 是保留的上游兼容实现，不是当前 Tauri 核心聊天功能入口。内部代理类型和数据库命名为兼容保留。

现存代码包括 PromptBuilder、HeartbeatReader、SchedulerService、TaskService 和频道适配器。频道与调度参考分别见 [channels](channels.md) 和 [scheduler](scheduler.md)。

旧 Claw MCP 服务器及工具注入已删除；Claude Agent SDK 配置使用空的 `mcpServers`，不得按旧文档恢复工具服务器。工作区提示、文件读取和历史数据类型不代表 MCP 功能仍可调用。
