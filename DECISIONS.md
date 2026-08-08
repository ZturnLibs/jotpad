# Jotpad 设计决策与功能记录

> 本文记录 Jotpad 的**关键技术决策**（为什么这么做、权衡、踩过的坑）与**已完成功能**，供后续开发与维护参考。
> - 使用说明、构建与快捷键 → `README.md`
> - 路线图与待办 → `ROADMAP.md`
> - 发布流程 → `.agents/skills/jotpad-release/SKILL.md` + `scripts/release.mjs`

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Tauri 2（系统 WebView，跨 macOS / Linux / Windows） |
| 后端 | Rust（`encoding_rs` 多编码、`tauri-plugin-{dialog,updater,process,global-shortcut}`、tray-icon feature） |
| 前端 | React 19 + TypeScript + Vite |
| 状态 | Zustand |
| 编辑器内核 | CodeMirror 6 |
| 分发 | GitHub Releases + `tauri-plugin-updater`（`latest.json` 自动更新） |

---

## 架构总览

- **Rust 后端**（`src-tauri/src/`）：文件 I/O（多编码/行尾/BOM/mtime）、菜单构建、托盘、全局快捷键、shell 集成、语音、历史、日志、剪贴板、便携数据目录。
- **前端**（`src/`）：`store/useStore.ts` 为中枢（标签页/设置/草稿持久化/确认流）；`lib/` 为纯逻辑（i18n、菜单模型、diff、编辑、查找、颜色、toast）；`components/` 为 UI。
- **菜单/动作**：`lib/menuActions.ts` 提供唯一菜单模型 + 动作分发，自定义菜单与原生菜单共用。
- **数据**：统一走 `lib::data_dir(app)`（便携感知），原子写入。

---

## 关键技术决策（ADR）

### 1. 跨平台菜单：全平台原生系统菜单
- **决策**：macOS 屏幕顶部系统菜单栏、Windows/Linux 窗口内原生菜单条；**移除** React 自定义菜单栏。
- **原因**：符合各平台原生习惯；系统级快捷键、⌘ 符号、`Cmd+Q` 退出等由系统处理。
- **实现**：前端 `lib/platformMenu.ts` 序列化菜单树 → Rust `menu.rs` 用 `MenuItemBuilder/CheckMenuItemBuilder/SubmenuBuilder/MenuBuilder` 重建 → `on_menu_event` 转发 `menu://click` → 前端 `runMenuAction` 分发。
- **权衡/坑**：
  - macOS 第一个子菜单自动成为粗体应用菜单——前端在 mac 显式提供名为 `Jotpad`（大写 J）的应用菜单（关于/退出），避免系统用小写进程名合成 "About jotpad"。
  - **macOS 运行时 `window.set_menu` 不刷新已显示的主菜单** → 必须在 `setup` 启动阶段用 `default_menu` 设置；前端 `set_app_menu` 仍会调用以尝试同步勾选/语言（mac 上可能不实时刷新外观，但点击功能始终正常）。
  - accelerator 跨平台修饰键必须用 **`CmdOrCtrl`**（`CommandOrControl` 非法，会让整棵菜单构建失败且错误被前端 try/catch 静默吞掉）。Rust 端对单个非法 accelerator **容错**（解析失败则忽略该快捷键，保留菜单项）。

### 2. macOS 应用图标规范
- **决策**：macOS 图标内容居中 **824×824**（约 10% 边距）；Windows/Linux 填满画布。
- **原因**：Apple HIG 要求图标四周留白；Windows 任务栏图标紧凑更符合习惯。macOS 不给第三方 `.icns` 自动加遮罩，填满的图标在 Dock/Cmd+Tab 会比系统应用大一圈。
- **实现**：`app-icon.svg`（填满，win/linux）+ `app-icon-mac.svg`（带边距）；`scripts/gen-icon.mjs` 渲染填满 PNG + macOS iconset；`scripts/gen-mac-icns.mjs` 用 `iconutil` 生成带边距 `.icns`；`pnpm icon` 一键再生。

### 3. 多编码文件 I/O
- **决策**：Rust `encoding_rs`，读取按 BOM → 严格 UTF-8 → CJK 启发式（GBK/Shift-JIS/EUC-KR/Big5）→ Windows-1252 兜底；写入支持 UTF-8/UTF-16/GBK/Big5/Shift-JIS/EUC-KR/Windows-1252 + BOM + 行尾转换。
- **实现**：`read_file`/`write_file` 原子写（临时文件 + rename）；行尾内部统一 LF，保存时按 `lineEnding` 转换。
- **权衡**：无 BOM 时启发式可能误判（如 GBK/Big5 字节重叠），但"能打开"优先；用户可在菜单/状态栏切换编码后保存。

### 4. 草稿持久化与会话恢复
- **决策**：所有标签页（内容/光标/滚动/设置/最近文件/会话）序列化为 JSON，**原子写入** `data_dir/jotpad-state.json`；状态变化防抖（600ms）保存；退出/崩溃后下次启动恢复。
- **权衡**：多窗口共享同一份草稿文件 → 各窗口编辑时以后退出者为准（已知限制，记事本多窗口场景可接受）。

### 5. 大文件策略（>2 MB 自动只读）
- **决策**：`BIG_FILE_THRESHOLD = 2_000_000`；`openPath`/`loadTabFromPath` 打开超阈值文件自动 `readOnly = true`。
- **实现**：`TabState.readOnly` + CodeMirror `EditorState.readOnly`（`readOnlyCompartment` 动态切换）；状态栏「只读」标识、查看菜单「只读」勾选均可切换。
- **原因**：CodeMirror viewport 渲染本身不卡，但全文搜索/行号重算可能慢；只读防误改并略提升稳性。

### 6. 多光标与列选择
- **决策**：开启 `allowMultipleSelections`；`Cmd/Ctrl+点击` 加光标、`Cmd/Ctrl+Alt+↑/↓` 加行光标（CodeMirror 默认）、`Cmd/Ctrl+D` 选相同词（绑定 `selectSelectionMatches`）、`Alt/Option+拖拽` 矩形选择（`rectangularSelection` + `crosshairCursor`）。
- **原因**：CodeMirror 6 原生支持，零额外依赖。

### 7. 系统托盘 + 全局唤起
- **决策**：Tauri 开 `tray-icon` feature；托盘左键切换主窗口显隐，右键菜单（显示/隐藏/新建标签/退出）；全局快捷键 **`Cmd/Ctrl+Shift+J`** 唤起窗口到前台。
- **实现**：`tray.rs` + `tauri-plugin-global-shortcut`；托盘「新建标签」经 `tray://click` 事件通知前端。
- **权衡**：默认常驻托盘 + 常注册快捷键（未做设置开关），如需可配置后续加。

### 8. 便携模式（Portable）
- **决策**：可执行文件旁存在 `jotpad.portable` 空文件 → 所有数据写入程序同级 `data/`。
- **实现**：`lib::data_dir(app)` 统一入口，`state_path`/`app_log`/`history`/`voice`/`shell_integration` 五处全部改用它；命中标记用 `exe_dir/data`，否则系统 `app_data_dir`。
- **用途**：U 盘携带、只读/企业 kiosk 环境。

### 9. 与磁盘版本对比（diff）
- **决策**：自实现**行级 LCS** diff（`lib/diff.ts`，`Uint32Array` DP，无依赖），适用至约 1 万行。
- **实现**：查看 → 与磁盘版本对比；读取磁盘文件与当前缓冲做 diff，`+` 绿/`−` 红/未改灰；未保存到磁盘的标签该菜单项禁用。

### 10. 强调色（主题）
- **决策**：`settings.accent` 取 `"system"` 或 hex；macOS/Linux 回退默认蓝，**Windows 读注册表** `Control Panel\Colors\Hilight`；按浅/深主题自动提亮并据亮度算按钮文字对比色。
- **实现**：CSS 变量 `--accent`/`--accent-hover`/`--accent-contrast`；设置页色板（系统 + 7 预设）。

### 11. UI 一体化（标签/工具栏/内容区）
- **决策**：灰色顶栏（标签栏容器）+ 白色主体（菜单栏/工具栏/内容区同色连成一片）+ 灰色底栏（状态栏）；激活标签去边框、下延 1px 穿过分隔线**融入主体**。
- **原因**：激活标签背景曾误设为容器同色导致看不出当前标签；统一为"灰顶/白主体/灰底"三层，激活标签视觉上延伸进编辑区。

### 12. 发布流程（脚本 + skill + CI）
- **决策**：`scripts/release.mjs` 一键发布（检查→改四处版本→`cargo check` 刷新 lock→commit→tag→push→确认 CI）；pi skill `.agents/skills/jotpad-release/SKILL.md` 描述触发词与流程；CI 由 push `v*` tag 触发 `.github/workflows/release.yml`。
- **约定**：版本号四处必须一致；tag 带 `v` 前缀；**仅用户明确要求才发版**；不 `--force` 推 tag，已发布 tag 勿改写。

---

## 已完成功能矩阵

| 模块 | 功能 | 状态 |
| --- | --- | --- |
| 文件 I/O | 多编码读写（BOM/自动检测）、行尾（CRLF/LF/CR）、草稿原子保存与恢复、外部变更检测、mtime 跟踪 | ✅ |
| 文件 I/O | 大文件（>2 MB）自动只读、与磁盘版本对比（行级 diff）、重命名/复制路径/删除/在访达中显示 | ✅ |
| 编辑 | 多光标（点击/Alt+方向/`Cmd+D` 选词）、列（矩形）选择、撤销/重做、查找替换（正则/计数）、转到行、F5 时间日期、拼写检查（可关） | ✅ |
| 视图 | 字体/字号/加粗/斜体/下划线/删除线、缩放、自动换行、行号、浅/深/系统主题、强调色（跟随系统/预设）、窗口置顶 | ✅ |
| 标签/会话 | 多标签、未保存确认、命名会话、启动恢复策略、快速打开（`Cmd/Ctrl+P`）、最近文件 | ✅ |
| 统计 | 字符/词/行（含 CJK 词），选区统计 | ✅ |
| 系统集成 | 系统托盘、全局唤起快捷键、右键「新建文本文件」/「用 Jotpad 打开」（3 平台）、便携模式 | ✅ |
| 打印 | 打印 + 页面设置（纸张/方向/边距，`@page` 应用） | ✅ |
| 语音 | 本地语音转写（语音包下载/管理） | ✅ |
| 历史 | 文件历史快照与对比 | ✅ |
| 平台 | 原生菜单（mac 顶部/win·linux 窗口）、macOS Overlay 标题栏、平台规范图标 | ✅ |
| 分发 | 三平台安装包、自动更新通道、便携版、企业静默安装说明 | ✅ |
| 发布 | 一键脚本 + pi skill + GitHub Actions | ✅ |
| Markdown | 语法高亮 / 预览 / 工具栏 | ⏸ 暂缓（待明确需求） |

> 详细规划与版本对应见 `ROADMAP.md`。

---

## 平台差异速查

| 维度 | macOS | Windows / Linux |
| --- | --- | --- |
| 菜单 | 屏幕顶部系统菜单栏（含「Jotpad」应用菜单） | 窗口内原生菜单条 |
| 标题栏 | Overlay（标签栏延伸，左侧避让红绿灯） | 标准装饰标题栏 |
| 应用图标 | 内容居中 824×824（~10% 边距） | 填满画布 |
| 强调色 | 默认蓝（系统蓝近似） | Windows 读注册表 Hilight |
| 全局唤起 | `Cmd+Shift+J` | `Ctrl+Shift+J` |

---

## 维护备忘

- **改图标**：编辑 `app-icon.svg`/`app-icon-mac.svg` → `pnpm icon`。
- **发版**：`pnpm release [patch|minor|major|x.y.z] [摘要]`（或对话说「发布版本」）。
- **加菜单项**：在 `lib/menuActions.ts` 的 `getMenuModel` 加项 + 在 `runMenuAction` 加 `case`；mac 应用菜单项由 `platformMenu.ts` 从 file 提取到 app menu。
- **加数据目录模块**：统一用 `crate::data_dir(app)`，勿直接 `app_data_dir`（否则破坏便携模式）。
- **改编辑器扩展**：在 `components/Editor.tsx`；动态开关用 `Compartment` + `reconfigure`。
