# lich13studio Icon Concept

## 设计目标

- 风格: 现代、简洁、专业、桌面工具感
- 气质: 科技感、工作流中枢、稳定、锐利、克制
- 禁止: Cherry / 樱桃联想、过度渐变、小尺寸糊掉

## 色板

| Role | Hex | Usage |
| --- | --- | --- |
| Primary | `#7C3AED` | 主几何笔画 |
| Secondary | `#A855F7` | 次级结构 / 外轮廓 |
| Accent | `#C084FC` | 高光 / 小尺寸识别点 |
| Dark BG | `#1F1333` | 主背景 |
| Outline | `#5B21B6` | 低对比外轮廓 |

## 方案 A: Core Monogram L13

- 关键词: `L + 1 + 3` 抽象组合
- 结构:
  - 深紫圆角方形底板
  - 左侧粗线条 `L`
  - 中间细竖笔作为 `1`
  - 右侧连续双弧线抽象 `3`
  - 低透明六边形外轮廓增加“中枢 / 工作流”感
- 优点:
  - 小尺寸识别最好
  - 产品字母关联最直接
  - 适合作为桌面应用主图标
- 风险:
  - 需要严格控制 `3` 的曲率，避免看起来像字母 `B`

## 方案 B: Orbital Hub

- 关键词: 核心节点 + 外围轨道
- 结构:
  - 中心六边形核心
  - 三条环绕轨道表示工作流 / 调度 / 对话
  - `L` 通过负形切口表达
- 优点:
  - “智能中枢”感更强
  - 更适合动画和启动页
- 风险:
  - 64px 以下会损失轨道层次

## 方案 C: Hex Frame Signal

- 关键词: 六边形框体 + 信号切片
- 结构:
  - 外层六边形边框
  - 内部三段切片表示 `13`
  - 左下保留 `L` 折角
- 优点:
  - 机械感、工具感强
  - 适合专业桌面软件
- 风险:
  - 视觉更硬，需要更细致的留白

## 默认采用方案

- 默认采用: `方案 A / Core Monogram L13`
- 原因:
  - 最符合“品牌重命名 + 桌面图标 + 小尺寸可识别”三重要求
  - Phase 1 可以直接替换 `build/icon*` 与 tray 资源
  - 最容易扩展到 favicon、托盘图标、安装包图标、文档封面

## SVG 方向说明

- 画布: `1024 x 1024`
- 安全区: `144px`
- 圆角: `184px`
- 图形策略:
  - 背景使用纯色或极轻渐变，避免复杂纹理
  - 主图形只保留 `L / 1 / 3 / 六边形轮廓`
  - 笔画粗细保持一致，适配 `64px` 以下显示
- 当前 SVG 草稿: `build/branding/app-icon.svg`

## 已产出的草稿资源

- `build/branding/app-icon.svg`
- `build/branding/app-icon-1024.png`
- `build/branding/app-icon-256.png`
- `build/branding/app-icon-128.png`
- `build/branding/app-icon-64.png`

## favicon / tray 建议

- favicon:
  - 保留深色底板 + `L13` 主字形
  - 去掉低透明六边形轮廓
  - 只保留 `Primary + Accent`
- tray:
  - 优先使用单色版本
  - 深色系统托盘使用浅紫 / 白色字形
  - 浅色系统托盘使用深紫字形
  - 不使用复杂渐变

## Windows ICO / macOS ICNS 源资源要求

- 主源文件:
  - `app-icon.svg`
  - `app-icon-1024.png`
- Windows ICO:
  - 从 `1024 PNG` 导出 `256 / 128 / 64 / 48 / 32 / 16`
  - 打包为单个 `.ico`
- macOS ICNS:
  - 从 `1024 PNG` 导出 `1024 / 512 / 256 / 128 / 64 / 32 / 16`
  - 保持透明背景
- Phase 1 建议:
  - 用 `build/branding/*` 作为源，生成并覆盖 `build/icon.icns`、`build/icon.ico`、`build/icons/*`
