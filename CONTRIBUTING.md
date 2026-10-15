# 贡献指南

本仓库维护 lich13studio。问题、代码和文档变更请提交到 [lich13/lich13studio](https://github.com/lich13/lich13studio)，安全问题使用 [私密报告](SECURITY.md)。上游 Cherry Studio 链接只用于来源与授权说明。

## 开始修改

1. 阅读 [功能范围](docs/scope-freeze.md)、[架构](docs/architecture-lite.md) 和 [迁移规则](docs/migration-notes.md)。
2. 使用 `main` 为基线，保持每个提交只解决一个问题。需要扩大范围或改变兼容行为时，先在本项目 Issue 中讨论。
3. 按 [开发指南](docs/zh/guides/development.md) 安装固定工具链和锁定依赖。
4. 修复应带有针对实际行为的回归测试，测试使用虚拟凭据和隔离接口，不调用真实模型。
5. 提交前执行 `pnpm run ci`；CI 使用同一检查定义，并完成跨平台构建。PR 说明应列出改动、验证和未覆盖边界。

## 数据与许可

不得提交 API Key、密码、Cookie、聊天记录、数据库、签名密钥或含敏感信息的截图。不要随意删除旧迁移、持久化键或第三方版权说明。

贡献应遵循 [行为准则](CODE_OF_CONDUCT.md) 与 [AGPL-3.0](LICENSE)。请确认有权提交代码，并用 `git commit --signoff` 记录贡献者声明。第三方文件仍保留各自许可证，详见 [NOTICE](NOTICE.md)。
