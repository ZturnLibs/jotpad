# Jotpad · 跨平台记事本

Jotpad 是一款用 **Tauri 2 + React + TypeScript + CodeMirror 6** 构建的跨平台（macOS / Linux / Windows）记事本，灵感来自 **Windows 11 新版记事本**。

- 🪟 多标签页、草稿自动保存与恢复
- 🔤 多编码读写（UTF-8 / UTF-16 / GBK / Big5 / Shift-JIS / EUC-KR / Windows-1252，自动检测 + BOM）
- 🔍 查找 / 替换（区分大小写、正则、匹配计数）
- 🎨 字体 / 字号 / 加粗 / 斜体 / 下划线 / 删除线，缩放，自动换行，强调色（跟随系统 / 自定义）
- 🌗 浅色 / 深色 / 跟随系统主题
- 🪟 原生菜单适配（macOS 顶部系统菜单 / Linux GTK 菜单条 / Windows 自定义）
- 🌐 中文 / English 界面，可扩展
- ⌨️ 完整快捷键
- 🖱️ 拖拽文件打开

## 开发

```bash
pnpm install
pnpm tauri dev
```

## 打包

```bash
pnpm tauri build            # 产出当前平台安装包
# 或仅验证可执行：
pnpm tauri build --debug --no-bundle
```

> 构建需要 Rust 工具链与各平台 WebView 运行时（macOS 自带；Linux 需 `webkit2gtk`；Windows 自带 WebView2）。
>
> 重新生成应用图标（从 `app-icon.svg`）：`pnpm exec node scripts/gen-icon.mjs && pnpm tauri icon app-icon.png`

## 快捷键

| 操作 | Windows / Linux | macOS |
| --- | --- | --- |
| 新建标签页 | `Ctrl+N` | `Cmd+N` |
| 打开 | `Ctrl+O` | `Cmd+O` |
| 保存 | `Ctrl+S` | `Cmd+S` |
| 另存为 | `Ctrl+Shift+S` | `Cmd+Shift+S` |
| 关闭标签页 | `Ctrl+W` | `Cmd+W` |
| 切换标签 | `Ctrl+Tab` / `Ctrl+Shift+Tab` | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| 查找 | `Ctrl+F` | `Cmd+F` |
| 替换 | `Ctrl+H` | `Cmd+Option+F` |
| 查找下一个 / 上一个 | `F3` / `Shift+F3` | `F3` / `Shift+F3` |
| 转到行 | `Ctrl+G` | `Cmd+G` |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` | `Cmd+Z` / `Cmd+Shift+Z` |
| 全选 | `Ctrl+A` | `Cmd+A` |
| 插入时间/日期 | `F5` | `F5` |
| 放大 / 缩小 / 重置缩放 | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | `Cmd+=` / `Cmd+-` / `Cmd+0` |
| 打印 | `Ctrl+P` | `Cmd+P` |
| 设置 | `Ctrl+,` | `Cmd+,` |
| 关闭面板 | `Esc` | `Esc` |

## 项目结构

```
src/
├── App.tsx              # 布局 / 主题 / 全局快捷键 / 拖拽 / 关闭拦截
├── main.tsx
├── types.ts             # 共享类型与默认值
├── store/useStore.ts    # zustand 状态：标签页、设置、文件操作、草稿持久化
├── lib/
│   ├── backend.ts       # Tauri 命令封装 + 系统对话框
│   ├── i18n.ts          # 中 / 英翻译 + useT
│   ├── search.ts        # 查找 / 替换辅助
│   ├── edit.ts          # 剪贴板 / 光标插入 / 时间日期
│   ├── editorRef.ts     # CodeMirror 实例桥接 + 状态栏订阅
│   └── utils.ts
├── components/          # TabBar / MenuBar / Toolbar / Editor / FindBar / StatusBar / Settings / Dialogs
└── styles/              # theme.css（变量）+ app.css（布局与组件）

src-tauri/src/lib.rs     # Rust 后端：多编码读写 read_file/write_file + 草稿状态 read_state/write_state
```

## 平台适配

菜单与窗口控件按平台原生习惯适配：

- **macOS**：菜单显示在屏幕顶部系统菜单栏（原生 `muda` 菜单，含应用菜单 / ⌘ 快捷键符号 / `Cmd+Q` 退出走草稿流程）；窗口使用 **Overlay 标题栏**（Unified Toolbar），标签栏延伸进标题栏区域，左侧为红绿灯按钮预留空间。
- **Linux**：使用原生 GTK 菜单条（窗口内顶部）；快捷键由菜单加速键拦截，修饰键为 Ctrl。
- **Windows**：保留窗口内自定义菜单（文件 / 编辑 / 查看，Win11 风格），与标签栏、工具栏融合。
- 所有平台均支持编辑区右键上下文菜单；快捷键修饰键自动按平台区分（macOS ⌘ / Windows·Linux Ctrl）。菜单重建已防抖，避免频繁切换时的闪烁。

菜单逻辑、动作分发、右键菜单共用同一份模型（`src/lib/menuActions.ts`），各平台仅表现层不同。

## 数据存储

草稿（所有标签页内容、光标、滚动位置、设置、最近文件）以 JSON 原子写入各平台应用数据目录：

- macOS: `~/Library/Application Support/com.jotpad.app/jotpad-state.json`
- Linux: `~/.local/share/com.jotpad.app/jotpad-state.json`
- Windows: `%APPDATA%\com.jotpad.app\jotpad-state.json`

未保存的修改在退出前会提示保存；即使强制退出，下次启动也会恢复草稿。
