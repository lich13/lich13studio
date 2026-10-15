# 来源与第三方许可

## 衍生关系

lich13studio 是 [CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio) 的精简衍生项目。保留上游作者版权、代码中的归属和根目录 [GNU AGPL-3.0](LICENSE) 原文。本项目修改可通过 [Git 历史](https://github.com/lich13/lich13studio/commits/main) 查看，包括 Tauri／Android 适配、界面精简、模型目录与 ModelTrace 集成。

发行对应源码、构建脚本和修改记录在 [本仓库](https://github.com/lich13/lich13studio) 提供；分发时应一并保留许可证和通知，按 AGPL-3.0 提供对应源码。若修改程序作为网络服务供用户使用，还需遵守许可证第 13 条的源码提供要求。具体以许可证原文为准。

来源链接不代表本项目由上游提供支持或数据服务；本项目反馈入口见 [CONTRIBUTING](CONTRIBUTING.md) 与 [SECURITY](SECURITY.md)。

## 独立第三方内容

| 内容 | 来源与许可位置 |
| --- | --- |
| tray-icon 0.21.3 回移 | [维护说明](vendor/tray-icon-0.21.3/LICH13STUDIO.md)，保留 MIT／Apache-2.0 原文 |
| pnpm 补丁 | [补丁说明](patches/README.md)和 `patches/licenses` 中各包原文 |
| ModelTrace 指纹与对照算法 | [来源](src/renderer/src/services/modelTrace/MODELTRACE-README.md)，相邻 MIT 许可证 |
| 模型能力快照与 OpenAI 图标 | [来源](src/renderer/src/config/models/registry/README.md)，相邻上游 AGPL 许可证 |
| 其他 npm／Cargo 依赖 | 版本由 pnpm-lock.yaml、Cargo.lock 固定；各包保留自己的版权与许可证 |

内部 workspace 包的 package metadata 存在 MIT 声明，但 AI Core 原 README 链接到的是上游根 AGPL 许可证，不能据此认定它是独立 MIT 授权。未取得更明确的上游授权文件前，不为这些包另造许可证或改变其既有元数据；整应用继续按根许可证发布。

`@opeoginni/github-copilot-openai-compatible@1.0.0` 的包元数据写 MIT，但该版本安装包和核验时的上游仓库未附许可证文件。补丁目录记录这一缺口，不补造版权文本。本轮不对该依赖重授权或升级。
