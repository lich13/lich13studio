# lich13studio Rename Plan

## 固定目标

- 产品名: `lich13studio`
- Bundle ID / App ID: `com.lich13.studio`
- 可执行名: `lich13studio`

## 重命名总原则

- 产品名层面不能再出现 `Cherry Studio`。
- 仅在 `来源说明 / 致谢 / migration notes` 中保留上游引用。
- Phase 1 先改用户可见与运行时关键触点，再处理内部 workspace scope 与遗留测试。

## 1. 构建与安装包触点

| Surface | Current | Target | Primary files |
| --- | --- | --- | --- |
| package name | `CherryStudio` | `lich13studio` | `package.json` |
| desktopName | `CherryStudio.desktop` | `lich13studio.desktop` | `package.json` |
| productName | `Cherry Studio` | `lich13studio` | `electron-builder.yml` |
| appId | `com.kangfenmao.CherryStudio` | `com.lich13.studio` | `electron-builder.yml` |
| Windows executable | `Cherry Studio` | `lich13studio` | `electron-builder.yml` |
| Linux executable | `CherryStudio` | `lich13studio` | `electron-builder.yml` |
| artifact prefix | `Cherry Studio-*` | `lich13studio-*` | `electron-builder.yml` |
| desktop entry `Name` | `Cherry Studio` | `lich13studio` | `electron-builder.yml`, `src/main/services/AppService.ts` |
| StartupWMClass | `CherryStudio` | `lich13studio` | `electron-builder.yml` |
| updater cache | `cherry-studio-updater` | `lich13studio-updater` | `dev-app-update.yml` |

## 2. 深链 / 协议 / OS 标识

| Surface | Current | Target | Primary files |
| --- | --- | --- | --- |
| protocol scheme | `cherrystudio://` | `lich13studio://` | `electron-builder.yml`, `src/main/services/ProtocolClient.ts`, `packages/shared/config/constant.ts` |
| Linux url-handler desktop file | `cherrystudio-url-handler.desktop` | `lich13studio-url-handler.desktop` | `src/main/services/ProtocolClient.ts` |
| OAuth redirect URI | `cherrystudio://oauth/callback` | `lich13studio://oauth/callback` | `packages/shared/config/constant.ts` |
| local discovery service | `cherrystudio` | `lich13studio` | `src/main/services/LocalTransferService.ts` |
| self bundle detection | `com.kangfenmao.CherryStudio` | `com.lich13.studio` | `src/main/services/SelectionService.ts` |

## 3. 配置 / 日志 / 数据目录触点

| Surface | Current | Target | Primary files |
| --- | --- | --- | --- |
| home config dir | `~/.cherrystudio` | `~/.lich13studio` | `packages/shared/config/constant.ts`, `src/main/utils/init.ts`, `src/main/utils/file.ts` |
| userData root | platform-specific Cherry Studio root | platform-specific lich13studio root | `electron-builder.yml`, Electron runtime naming |
| logs dir | `.../logs` under Cherry root | `.../logs` under lich13studio root | `src/main/services/LoggerService.ts` |
| mcp dir | `~/.cherrystudio/mcp` | `~/.lich13studio/mcp` | `src/main/utils/file.ts` |
| bin dir | `~/.cherrystudio/bin` | `~/.lich13studio/bin` | `src/main/utils/rtk.ts`, `src/main/services/CodeToolsService.ts`, `src/main/services/OpenClawService.ts` |
| trace dir | `~/.cherrystudio/trace` | `~/.lich13studio/trace` | `src/main/services/SpanCacheService.ts` |
| temp dir | `/tmp/CherryStudio` or `/tmp/cherry-studio/...` | `/tmp/lich13studio/...` | `src/main/utils/file.ts`, `src/main/services/BackupManager.ts`, `src/main/services/CodeToolsService.ts` |
| default data folder | `userData/Data` | `userData/data` or `userData/Data` under new root | `src/main/utils/file.ts`, `src/main/utils/index.ts` |
| backup filename prefix | `cherry-studio.*.zip` | `lich13studio.*.zip` | `src/main/services/BackupManager.ts`, `src/renderer/src/services/BackupService.ts` |
| default WebDAV path | `/cherry-studio` | `/lich13studio` | `src/renderer/src/store/migrate.ts`, `src/renderer/src/pages/settings/DataSettings/WebDavSettings.tsx` |

## 4. UI / 文案 / 关于页触点

| Surface | Current | Target | Primary files |
| --- | --- | --- | --- |
| main HTML title | `Cherry Studio` | `lich13studio` | `src/renderer/index.html` |
| selection window title | `Cherry Studio Selection Assistant` | `lich13studio Selection Assistant` | `src/renderer/selectionAction.html` |
| app env label | `Cherry Studio` | `lich13studio` | `src/renderer/src/config/env.ts`, `packages/shared/config/constant.ts` |
| About / OpenAPI title | `Cherry Studio API` | `lich13studio API` | `src/main/apiServer/app.ts`, `src/main/apiServer/generated/openapi-spec.json` |
| built-in helper name | `Cherry Assistant` | `lich13studio Assistant` or `Studio Assistant` | `resources/builtin-agents/cherry-assistant/agent.json` |
| privacy page | Cherry 文案 | lich13studio 文案 | `resources/cherry-studio/privacy-en.html` |
| README | Cherry 文案 / 链接 / 截图 | lich13studio 文案，仅在致谢里提上游 | `README.md`, `docs/**/*` |

## 5. 图标 / 资源文件触点

| Surface | Current | Target | Primary files |
| --- | --- | --- | --- |
| primary icon | Cherry visual | 紫色系 lich13studio 新图标 | `build/icon.png`, `build/icon.icns`, `build/icon.ico`, `build/icons/*` |
| tray icon | Cherry tray visual | lich13studio monochrome tray glyph | `build/tray_icon.png`, `build/tray_icon_dark.png`, `build/tray_icon_light.png` |
| logo asset | Cherry logo | lich13studio logo | `build/logo.png` |
| source resource folder | `resources/cherry-studio` | `resources/lich13studio` | `resources/cherry-studio/**/*` |

## 6. 网络 / 更新 / Header 触点

| Surface | Current | Target | Primary files |
| --- | --- | --- | --- |
| update feed | `releases.cherry-ai.com` | lich13studio release feed | `electron-builder.yml`, `packages/shared/config/constant.ts`, `app-upgrade-config.json` |
| GitHub release links | `CherryHQ/cherry-studio` | new repo or temporary fork path | `README.md`, `app-upgrade-config.json`, `packages/shared/config/constant.ts` |
| user-agent / title headers | `CherryStudio` / `Cherry Studio` | `lich13studio` | `src/main/utils/systemInfo.ts`, `packages/shared/utils/index.ts`, `src/main/services/MCPService.ts` |

## 7. 内部命名与兼容策略

### Phase 1 强制改

- 所有用户可见产品名
- 所有 bundle id / app id / executableName
- 所有目录名 / 协议名 / 备份前缀
- 所有图标资源

### Phase 1 保留兼容读取

- 允许从旧目录 `~/.cherrystudio` 读取迁移配置
- 允许读取旧 `Cherry Studio` 备份 metadata 并导入到新目录
- 允许短期兼容旧 deep link，再统一跳转到新协议

### Phase 1 之后再做

- workspace package scope `@cherrystudio/*` 是否改为 `@lich13studio/*`
- 上游硬编码 GitHub / docs / sponsor / enterprise 链接的统一替换
- 测试、快照、fixture、生成文件的全量回写与重生成
