# 依赖补丁维护

仅 `pnpm-workspace.yaml#patchedDependencies` 中的文件参与安装；版本和补丁哈希由锁文件固定。下表记录本仓库当前保留的差异，不表示应用开放所有上游 provider 接口。

| 来源 | 差异用途 | 原许可证 | 补丁 |
| --- | --- | --- | --- |
| [antd@5.27.0](https://github.com/ant-design/ant-design) | 统一下拉与菜单箭头图标 | [MIT](licenses/antd-5.27.0.txt) | [antd-npm-5.27.0-aa91c36546.patch](antd-npm-5.27.0-aa91c36546.patch) |
| [@ai-sdk/openai@3.0.53](https://github.com/vercel/ai) | 既有图像型号支持 | [Apache-2.0](licenses/ai-sdk-openai-3.0.53.txt) | [@ai-sdk__openai@3.0.53.patch](@ai-sdk__openai@3.0.53.patch) |
| [@ai-sdk/anthropic@3.0.64](https://github.com/vercel/ai) | 推理 effort 的 xhigh 类型与校验 | [Apache-2.0](licenses/ai-sdk-anthropic-3.0.64.txt) | [@ai-sdk__anthropic@3.0.64.patch](@ai-sdk__anthropic@3.0.64.patch) |

`licenses/` 从对应已安装精确版本复制原文件，保留原字节及版权。`@ai-sdk/*` 包自带的 LICENSE 仅为指向 Apache-2.0 的简短声明，未附许可证全文；按 Apache-2.0 第 4(a) 条，[licenses/Apache-2.0.txt](licenses/Apache-2.0.txt) 收录取自 apache.org 的许可证全文，供上述 Apache-2.0 条目共同引用。根 AGPL 不替代这些包各自的许可证。

## 升级或删除

1. 从上游相同版本核对补丁上下文、原许可证和是否已有等价修复。
2. 使用现有 pnpm 的 patch／patch-commit 流程更新差异，连同 workspace 配置和 lockfile 一起提交；不要手改 node_modules 作为交付。
3. 保留来源、版权及新旧差异，运行实际使用该依赖的回归和 `pnpm ci`。
4. 只有调用链已删除或上游包含修复时才移除映射、补丁及对应许可副本；独立的原依赖仍按其许可分发。
