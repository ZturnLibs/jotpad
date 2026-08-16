# 文本编辑器（笔记类）真实用户需求调研

> 状态：调研完成
> 日期：2025-08-08
> 范围：面向 Jotpad 这类**轻量级 Markdown / 纯文本跨平台记事本**，收集真实用户需求与痛点。
> 关联：`docs/research-text-explosion.md`（"文字大爆炸"专项验证）

---

## 一、方法与来源

通过三个**不依赖主观推断**的真实用户渠道取证，并交叉验证：

| 渠道 | 数据 | 取证方式 |
|------|------|---------|
| **GitHub Issues**（按 👍 排序） | VS Code / Zed / Helix / Logseq / Notepad++ / CodeMirror 高赞 open issue | `sort=reactions-+1`，👍数 = 真实需求代理指标 |
| **Hacker News**（高分帖 + 评论挖掘） | 25+ 篇 50+ 分讨论，深挖 2 条最热帖评论 | 评论是"用户原声"富矿 |
| **App Store 评论**（美区+中区） | iA Writer / Bear / MWeb 真实评论原文 | 一手付费用户声音 |

> 限流说明：Reddit/Google 在本环境不可达；GitHub 搜索未认证有 10 次/分限制，分批取证。

---

## 二、核心发现：跨源一致的 4 条强需求（最高置信）

这 4 条**在三个渠道都反复出现**，可信度最高：

### ① 跨文件全文搜索是"生死线"功能

- HN「Tired of note-taking apps」(478pts/465c) 反复出现：*"ability to quickly **search** and link years worth of notes"*、*"not able to quickly **search** an old note"*。
- iA Writer 把 outline 称为 *"turns all my writing into one **search**"*（5★）。
- → **搜索能力决定一个笔记工具能否长期使用**。

### ② 捕获速度 / 即时记录

- HN：*"phones are just too slow to fire up and start a note"*、*"command line way to just create a new note in one line"*。
- HN 赞美 Notepad++：*"Every new tab opens and without needing to be saved is **persisted** even if computer restarts. That is a perfect **scratchpad**."*
- → **从"想记"到"开始打字"的路径越短越好**；草稿持久化是刚需。

### ③ 本地优先 / 隐私 / 不锁数据

- HN 多个 100+ 分帖主打 local-first、E2E 加密、数据长寿（"data longevity"）。
- App Store Bear 被赞 *"data portability"*、*"未收集任何数据"*；用户**强烈反感 Notion 式锁定**。
- → 纯文本 + 本地文件 = 天然契合，是差异化护城河。

### ④ 一次性买断、反订阅（强情绪）

- HN「Anyone tired of subscriptions」(340pts)：*"I truly won't **rent** a note taking app"*、*"buy-once native apps (like Sublime)"*。
- App Store Bear 1★：*"Subscription Required for BASIC NEEDS"*；iA Writer 评论：*"competing with Bear sub model, and my common sense to use buy-once native apps"*。
- HN：*"I already fund it by paying for iCloud. App makers need to stop **reinventing the wheel**"*（用系统同步，别自建付费同步）。
- → **定价模型本身就是需求**：买断 > 订阅。

---

## 三、各来源详细证据

### 3.1 GitHub 高赞 feature request（编辑器侧）

| 编辑器 | 👍 | 需求 | 主题 |
|--------|----|------|------|
| VS Code | 3767 | 自定义工作台字体/字号 | 外观自定义 |
| VS Code | 1925 | 自定义鼠标快捷键 | 输入定制 |
| VS Code | 1501 | 项目级错误/警告总览 | 导航/总览 |
| VS Code | 1370 | Vim 模式（如 Sublime） | 模态编辑 |
| VS Code | 1228 | 宏录制 | 自动化 |
| Zed | 820 | 平滑滚动 | 性能/体验 |
| Zed | 453 | easymotion（快速跳转） | 导航 |
| Zed | 410 | 多窗口支持多显示器 | 多窗口 |
| Helix | 477 | 代码折叠 | 折叠 |
| Helix | 346 | 外部文件变更自动刷新 | 文件同步 |
| Helix | 254 | 持久化会话 | 会话 |
| Helix | 244 | 并排 diff | 对比 |
| CodeMirror | — | 多为移动端 IME/滚动条 bug（Android 自动纠错、韩文回车重复行） | 平台兼容 |

### 3.2 HN 高分讨论主线

- **反臃肿**：*"Plain text only, no graphics, formatting, outlining, tagging, categories — these are all **distractions**"*；*"single text file for past 5 years"*。
- **反 Electron**：明确偏好原生（与 Tauri 定位契合）。
- **同步靠现有基建**：iCloud / Git，而非自建付费云。
- **可扩展性**：*"Is the plugin system versatile enough?"*（插件系统是长期价值）。

### 3.3 App Store 真实评论（一手付费用户）

**MWeb（中区，信息密度最高）：**
- *"像 word 一样，**选中部分文字后显示统计字数**"*（选中字数统计）
- *"如果可以直接**集成 git**就好了"*（Git 同步）
- *"把快速笔记功能，添加到**快捷指令**"*（系统快捷指令集成）
- *"快捷打开的时候能不能不要**弹出两个窗口**"*（窗口管理）
- *"中文字体无论如何也不能应用到预览和 pdf 中"*（CJK 导出字体）
- *"我对一个编辑器的基本需求：1.**打开速度**；2.能存储到本地"*（速度 + 本地）

**iA Writer / Bear（美区）：**
- iA Writer 1★：*"No **table of contents**… Without a TOC I can't use the app."*（大纲/目录）
- iA Writer 3★：*"frustratingly **slow**… spinning beachball"*（性能）
- Bear 2★：*"getting more and more **bloated**"*（反臃肿）

---

## 四、需求清单与 Jotpad 映射

> 标注：✅ Jotpad 已满足　🔴 真实未满足　🟡 可观察的长期机会　⛔ 明确反需求（别做）

| # | 需求 | 真实性 | Jotpad 现状 | 建议 |
|---|------|--------|------------|------|
| 1 | **跨文件全文搜索** | 高（HN 生死线） | 🔴 仅有单文件 Find + 文件名 QuickOpen | **最高优先级缺口** |
| 2 | **大纲 / TOC 跳转** | 高（iA Writer/Vim/Helix） | 🔴 无 | 建议做（Markdown 标题树） |
| 3 | 捕获速度 / 全局唤起 | 高 | ✅ 托盘 + 全局快捷键已有 | 持续保持启动快 |
| 4 | 草稿 / 会话持久化 | 高 | ✅ sessions + tabs 持久化 | 已是优势 |
| 5 | 本地优先 / 纯文本 | 高 | ✅ 本地文件、不锁数据 | **核心卖点，强化宣传** |
| 6 | 一次性买断 / 反订阅 | 高 | ✅（非订阅） | **定价即卖点** |
| 7 | 外部文件变更刷新 | 中 | ✅ 已实现（checkExternalChanges） | 已是优势 |
| 8 | 选中字数统计 | 中 | ✅ StatusBar 已有 selectedWords | 已是优势 |
| 8b | 固定/收藏标签 | 中（ROADMAP v0.2 #5） | ✅ 已实现（按路径固定，📌 置顶） | 已是优势 |
| 9 | 多窗口 / 多显示器 | 中 | ✅ newWindow 已有 | 已是优势 |
| 10 | 字体 / 主题自定义 | 中 | ✅ 字体+主题+强调色 | 已是优势 |
| 11 | 平滑滚动 / 大文件性能 | 中 | 🟡 大文件已只读；滚动待评估 | 监控 |
| 12 | Vim / 模态编辑 | 中（小众但强烈） | 🔴 无 | 🟡 长期，验证受众再做 |
| 13 | 插件 / 可扩展 | 中 | 🔴 无 | 🟡 长期项 |
| 14 | Git 同步集成 | 低-中 | 🔴 靠用户自选同步 | 🟡 可做"打开 Git 仓库"轻集成 |
| 15 | 系统 Shortcuts 集成 | 低 | 🔴 无 | 🟡 macOS 增强 |
| ⛔ | 功能堆砌 / 臃肿化 | — | — | **明确不做**（Bear/HN 反复警告） |
| ⛔ | 强塞 AI | — | — | 谨慎，勿默认开启 |

---

## 五、对 Jotpad 的启示

### 5.1 已验证的定位优势（应作为卖点强化）

Jotpad 当前**正好踩在最强需求上**，且多数竞品做反了：

- **纯文本 + 本地文件** → 命中 local-first / 不锁数据 / 可移植（vs Notion 锁定）
- **Tauri 原生** → 命中反 Electron（vs 一众 Electron 编辑器被 HN 吐槽）
- **持久化草稿 + 全局唤起** → 命中"捕获速度" + "完美 scratchpad"
- **非订阅** → 命中反订阅强情绪

→ **README / 宣传应直击这几点**，而非罗列功能。

### 5.2 最该补的两个缺口（高置信、低成本）

1. **跨文件全文搜索**：当前最大未满足强需求。建议在 QuickOpen 旁加"内容搜索"模式（遍历打开的文件 / 最近文件，按 tab 索引）。
2. **大纲 / TOC 跳转**：解析 Markdown `#` 标题生成可点击大纲面板。成本低、感知强（iA Writer 用户因缺它给 1★）。

### 5.3 明确不做的事

- 不做"大而全"（Notion 化）—— 与最小化定位和用户情绪直接冲突。
- 不做自建付费同步 —— 用本地文件 + 系统 iCloud / 用户 Git。
- AI 功能默认关闭、可关 —— iA Writer 因"强塞 AI"流失死忠用户。

---

## 六、结论

Jotpad 的**产品定位与最强真实需求高度吻合**（本地、纯文本、原生、买断、草稿持久化），这是稀缺优势。当前最大的功能性缺口是**跨文件搜索**与**大纲跳转**——两者都有强证据且契合轻量定位，建议作为下一阶段重点。其余高级需求（Vim、插件、Git）属长期观察项，待用户规模与反馈积累后再评估。
