# 依赖补丁维护

仅 `pnpm-workspace.yaml#patchedDependencies` 中的文件参与安装；版本和补丁哈希由锁文件固定。下表记录本仓库当前保留的差异，不表示应用开放所有上游 provider 接口。

| 来源 | 差异用途 | 原许可证 | 补丁 |
| --- | --- | --- | --- |
| [@tiptap/extension-drag-handle@3.2.0](https://github.com/ueberdosis/tiptap) | 滚动时收起拖动句柄 | [MIT](licenses/tiptap-extension-drag-handle-3.2.0.txt) | [@tiptap-extension-drag-handle-npm-3.2.0-5a9ebff7c9.patch](@tiptap-extension-drag-handle-npm-3.2.0-5a9ebff7c9.patch) |
| [antd@5.27.0](https://github.com/ant-design/ant-design) | 统一下拉与菜单箭头图标 | [MIT](licenses/antd-5.27.0.txt) | [antd-npm-5.27.0-aa91c36546.patch](antd-npm-5.27.0-aa91c36546.patch) |
| [ollama-ai-provider-v2@3.3.1](https://github.com/nordwestt/ollama-ai-provider-v2) | 既有 thinking 类型与 provider 导出 | [Apache-2.0](licenses/ollama-ai-provider-v2-3.3.1.txt) | [ollama-ai-provider-v2@3.3.1.patch](ollama-ai-provider-v2@3.3.1.patch) |
| [@openrouter/ai-sdk-provider@2.3.3](https://github.com/OpenRouterTeam/ai-sdk-provider) | 文件注释与严格工具 schema 参数 | [Apache-2.0](licenses/openrouter-ai-sdk-provider-2.3.3.txt) | [@openrouter__ai-sdk-provider.patch](@openrouter__ai-sdk-provider.patch) |
| [@opeoginni/github-copilot-openai-compatible@1.0.0](https://github.com/OpeOginni/github-copilot-openai-compatible) | 既有 GPT-5 系列参数分支 | 元数据 MIT；未附原文 | [@opeoginni__github-copilot-openai-compatible@1.0.0.patch](@opeoginni__github-copilot-openai-compatible@1.0.0.patch) |
| [@ai-sdk/openai-compatible@2.0.37](https://github.com/vercel/ai) | 兼容图片结果的文件块 | [Apache-2.0](licenses/ai-sdk-openai-compatible-2.0.37.txt) | [@ai-sdk__openai-compatible@2.0.37.patch](@ai-sdk__openai-compatible@2.0.37.patch) |
| [@ai-sdk/openai@3.0.53](https://github.com/vercel/ai) | 既有图像型号支持 | [Apache-2.0](licenses/ai-sdk-openai-3.0.53.txt) | [@ai-sdk__openai@3.0.53.patch](@ai-sdk__openai@3.0.53.patch) |
| [@ai-sdk/google@3.0.55](https://github.com/vercel/ai) | 保持已有 models/ 前缀 | [Apache-2.0](licenses/ai-sdk-google-3.0.55.txt) | [@ai-sdk__google@3.0.55.patch](@ai-sdk__google@3.0.55.patch) |
| [@ai-sdk/anthropic@3.0.64](https://github.com/vercel/ai) | 推理 effort 的 xhigh 类型与校验 | [Apache-2.0](licenses/ai-sdk-anthropic-3.0.64.txt) | [@ai-sdk__anthropic@3.0.64.patch](@ai-sdk__anthropic@3.0.64.patch) |

`licenses/` 从对应已安装精确版本复制原文件，保留原字节及版权。`@ai-sdk/*` 包自带的 LICENSE 仅为指向 Apache-2.0 的简短声明，未附许可证全文；按 Apache-2.0 第 4(a) 条，[licenses/Apache-2.0.txt](licenses/Apache-2.0.txt) 收录取自 apache.org 的许可证全文，供上述 Apache-2.0 条目共同引用。Copilot provider 1.0.0 仅有 package metadata 的 MIT 声明，没有可复制的许可证文件；此处如实记录，未补造文本。根 AGPL 不替代这些包各自的许可证。

## 升级或删除

1. 从上游相同版本核对补丁上下文、原许可证和是否已有等价修复。
2. 使用现有 pnpm 的 patch／patch-commit 流程更新差异，连同 workspace 配置和 lockfile 一起提交；不要手改 node_modules 作为交付。
3. 保留来源、版权及新旧差异，运行实际使用该依赖的回归和 `pnpm ci`。
4. 只有调用链已删除或上游包含修复时才移除映射、补丁及对应许可副本；独立的原依赖仍按其许可分发。
