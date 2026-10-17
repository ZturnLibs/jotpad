# Jotpad 开发指南

> 面向贡献者与维护者。用户文档见 [README](README.md)；设计决策见 [DECISIONS.md](DECISIONS.md)，路线图见 [ROADMAP.md](ROADMAP.md)。

## 环境要求

- Node.js ≥ 18、pnpm
- Rust 工具链（stable）
- 各平台 WebView 运行时：macOS 自带；Linux 需 `webkit2gtk`；Windows 自带 WebView2

## 本地开发

```bash
pnpm install
pnpm tauri dev
```

单元测试：

```bash
pnpm test
```

类型检查 / 前端构建：

```bash
pnpm build        # tsc + vite build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 打包

```bash
pnpm tauri build            # 产出当前平台安装包
# 或仅验证可执行：
pnpm tauri build --debug --no-bundle
```

产物目录：`src-tauri/target/release/bundle/`。

重新生成应用图标：`pnpm icon`。

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

## 发布

推荐使用一键脚本（自动改版本号 → commit → tag → push → 触发 CI）：

```bash
pnpm release                  # 默认 patch +1
pnpm release minor            # minor bump
pnpm release 1.2.0            # 指定版本
pnpm release patch "变更摘要"  # 附摘要
```

版本号在四处保持一致，脚本自动维护：`package.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json`。

推送 `v*` tag 触发 GitHub Actions，构建 macOS（arm64 / x64）、Windows、Linux x64 安装包并写入 [GitHub Releases](https://github.com/ZturnLibs/jotpad/releases)，CI 约 8–15 分钟。

应用内更新（`plugin-updater`）读取：

`https://github.com/ZturnLibs/jotpad/releases/latest/download/latest.json`

发版 CI 需配置 Secrets：`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（可空）、`RELEASE_TOKEN`。私钥丢失后已安装客户端将无法验签升级，须妥善备份 `~/.tauri/jotpad.key`。

Linux 应用内升级仅覆盖 **AppImage**；`.deb` / `.rpm` 用户会提示打开发布页手动安装。

### 发布前检查清单

- [ ] `pnpm test` 与 `pnpm build` 通过
- [ ] `pnpm tauri build` 在目标平台成功（或等待 CI Release 产物）
- [ ] macOS：系统菜单、Overlay 标题栏拖拽、红绿灯安全区
- [ ] Windows：窗口菜单栏、字体/对话框、新建窗口无 Overlay 异常
- [ ] Linux：GTK 菜单条、webkit2gtk 依赖说明
- [ ] 打开 / 保存 / 另存为 / 重命名 / 最近文件
- [ ] 外部修改文件后的重新加载提示
- [ ] 未保存关闭 / 退出确认与草稿恢复
