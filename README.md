# Jotpad · 跨平台记事本

Jotpad 是一款用 **Tauri 2 + React + TypeScript + CodeMirror 6** 构建的跨平台（macOS / Linux / Windows）纯文本记事本。

- 左右分栏：左侧文档列表，右侧编辑区
- 多标签页、草稿自动保存与恢复
- 最近打开的文件（文件菜单）
- 多编码读写（UTF-8 / UTF-16 / GBK / Big5 / Shift-JIS / EUC-KR / Windows-1252，自动检测 + BOM）
- 外部文件变更检测（提示重新加载或保留）
- 查找 / 替换（区分大小写、正则、匹配计数）
- 字体 / 字号、缩放、自动换行、可选行号、强调色
- 浅色 / 深色 / 跟随系统主题
- 原生系统菜单（各平台 `muda` / `AppHandle::set_menu`）
- 中文 / English 界面
- 完整快捷键、拖拽打开文件、打印与页面设置
- 可选系统集成：右键「新建文本文件」、使用 Jotpad 打开文本文件

## 开发

```bash
pnpm install
pnpm tauri dev
```

单元测试：

```bash
pnpm test
```

## 打包

```bash
pnpm tauri build            # 产出当前平台安装包
# 或仅验证可执行：
pnpm tauri build --debug --no-bundle
```

### 发布前检查清单

- [ ] `pnpm test` 与 `pnpm build` 通过
- [ ] `pnpm tauri build` 在目标平台成功
- [ ] macOS：系统菜单、Overlay 标题栏拖拽、红绿灯安全区
- [ ] Windows：窗口菜单栏、字体/对话框、新建窗口无 Overlay 异常
- [ ] Linux：GTK 菜单条、webkit2gtk 依赖说明
- [ ] 打开 / 保存 / 另存为 / 重命名 / 最近文件
- [ ] 外部修改文件后的重新加载提示
- [ ] 未保存关闭 / 退出确认与草稿恢复

> 构建需要 Rust 工具链与各平台 WebView 运行时（macOS 自带；Linux 需 `webkit2gtk`；Windows 自带 WebView2）。
>
> 重新生成应用图标：`pnpm icon`

## 快捷键

| 操作 | Windows / Linux | macOS |
| --- | --- | --- |
| 新建标签页 | `Ctrl+N` | `Cmd+N` |
| 打开 | `Ctrl+O` | `Cmd+O` |
| 快速打开 | `Ctrl+P` | `Cmd+P` |
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
| 窗口置顶 | `Ctrl+Shift+T` | `Cmd+Shift+T` |
| 插入时间/日期 | `F5` | `F5` |
| 放大 / 缩小 / 重置缩放 | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | `Cmd+=` / `Cmd+-` / `Cmd+0` |
| 打印 | 文件菜单 | 文件菜单 |
| 设置 | `Ctrl+,` | `Cmd+,` |
| 关闭面板 | `Esc` | `Esc` |

## 项目结构

```
src/
├── App.tsx              # 布局 / 主题 / 快捷键 / 拖拽 / 外部变更检测
├── store/useStore.ts    # 标签页、设置、文件、草稿、最近文件
├── lib/                 # backend / i18n / menu / search / print / utils
├── components/          # TabBar / Toolbar / Editor / FindBar / StatusBar / …
└── styles/

src-tauri/src/           # 多编码读写、重命名、mtime、菜单、状态持久化
```

## 平台适配

- **macOS**：系统菜单栏；窗口 Overlay 标题栏；侧栏顶部预留红绿灯；新建窗口同样使用 Overlay。
- **Linux / Windows**：应用菜单挂到窗口；新建窗口使用标准装饰标题栏（非 Overlay）。
- 菜单模型与动作分发共用 `menuActions.ts`，前端通过 `set_app_menu` 刷新原生菜单。

## 数据存储

草稿与设置写入应用数据目录：

- macOS: `~/Library/Application Support/com.jotpad.app/jotpad-state.json`
- Linux: `~/.local/share/com.jotpad.app/jotpad-state.json`
- Windows: `%APPDATA%\com.jotpad.app\jotpad-state.json`

未保存修改在退出前会提示；异常退出后下次启动可恢复草稿。
