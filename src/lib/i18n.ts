// Internationalization. Flat key map with zh-CN (default) and en.
import { useCallback } from "react";
import type { Locale } from "@/types";
import { useStore } from "@/store/useStore";

type Dict = Record<string, string>;

const zhCN: Dict = {
  "app.name": "记事本",

  // Menus
  "menu.file": "文件",
  "menu.edit": "编辑",
  "menu.view": "查看",
  "menu.help": "帮助",

  // File menu
  "file.new": "新建标签页",
  "file.newKey": "Ctrl+N",
  "file.newWindow": "新建窗口",
  "file.open": "打开…",
  "file.recent": "最近打开的文件",
  "file.recentEmpty": "（无）",
  "file.clearRecent": "清除最近文件",
  "file.save": "保存",
  "file.saveAs": "另存为…",
  "file.pageSetup": "页面设置…",
  "file.print": "打印…",
  "file.exit": "退出",

  // Page setup
  "pageSetup.title": "页面设置",
  "pageSetup.paper": "纸张大小",
  "pageSetup.orientation": "方向",
  "pageSetup.portrait": "纵向",
  "pageSetup.landscape": "横向",
  "pageSetup.margin": "页边距（毫米）",
  "pageSetup.ok": "确定",

  // Edit menu
  "edit.undo": "撤销",
  "edit.redo": "重做",
  "edit.cut": "剪切",
  "edit.copy": "复制",
  "edit.paste": "粘贴",
  "edit.delete": "删除",
  "edit.find": "查找…",
  "edit.findNext": "查找下一个",
  "edit.findPrev": "查找上一个",
  "edit.replace": "替换…",
  "edit.goto": "转到…",
  "edit.selectAll": "全选",
  "edit.timeDate": "时间/日期",

  // View menu
  "view.zoom": "缩放",
  "view.zoomIn": "放大",
  "view.zoomOut": "缩小",
  "view.zoomReset": "恢复默认大小",
  "view.statusBar": "状态栏",
  "view.wordWrap": "自动换行",
  "view.lineNumbers": "行号",
  "view.theme": "主题",
  "view.themeLight": "浅色",
  "view.themeDark": "深色",
  "view.themeSystem": "使用系统设置",
  "view.language": "语言",
  "view.encoding": "编码",
  "view.lineEnding": "行尾",

  // Toolbar
  "toolbar.font": "字体",
  "toolbar.fontSize": "字号",
  "toolbar.wordWrap": "自动换行",
  "toolbar.zoomOut": "缩小",
  "toolbar.zoomIn": "放大",
  "toolbar.theme": "主题",
  "toolbar.settings": "设置",

  // Tabs
  "tab.new": "新建标签页",
  "tab.close": "关闭标签页",
  "tab.closeOthers": "关闭其他标签页",
  "tab.untitled": "新建",
  "tab.rename": "重命名",
  "tab.unsaved": "未保存",

  // Find / Replace
  "find.find": "查找",
  "find.placeholder": "查找内容",
  "find.replaceWith": "替换为",
  "find.replacePlaceholder": "替换内容",
  "find.caseSensitive": "区分大小写",
  "find.regexp": "正则表达式",
  "find.prev": "上一个",
  "find.next": "下一个",
  "find.replaceOne": "替换",
  "find.replaceAll": "全部替换",
  "find.matchCount": "第 {i} 个，共 {n} 个",
  "find.matchCountOnly": "{n} 个匹配",
  "find.noMatch": "未找到",
  "find.replaceInfo": "已替换 {n} 处",

  // Goto
  "goto.title": "转到行",
  "goto.line": "行号",

  // Dialogs
  "dialog.saveChangesTitle": "Jotpad",
  "dialog.saveChangesMsg": "是否要将更改保存到 {name}？",
  "dialog.save": "保存",
  "dialog.dontSave": "不保存",
  "dialog.cancel": "取消",
  "dialog.confirmCloseTitle": "确认关闭",
  "dialog.confirmExitMsg": "您有未保存的更改。退出前是否保存？",
  "dialog.fileNotFound": "找不到文件：{name}",
  "dialog.openError": "打开文件失败",
  "dialog.saveError": "保存文件失败",
  "dialog.reloadTitle": "文件已更改",
  "dialog.reloadMsg": "磁盘上的“{name}”已被其他程序修改。是否重新加载？",
  "dialog.reload": "重新加载",
  "dialog.reloadKeep": "保留当前内容",

  // Status bar
  "status.line": "行",
  "status.col": "列",
  "status.chars": "字符",
  "status.selected": "已选中",
  "status.lines": "行",
  "status.zoom": "缩放",
  "status.encoding": "编码",

  // Settings panel
  "settings.title": "设置",
  "settings.appearance": "外观",
  "settings.editor": "编辑器",
  "settings.general": "常规",
  "settings.language": "语言",
  "settings.font": "字体",
  "settings.fontSize": "字号",
  "settings.behavior": "行为",
  "settings.showStatusBar": "显示状态栏",
  "settings.wordWrap": "自动换行",
  "settings.lineNumbers": "显示行号",
  "settings.accent": "强调色",
  "settings.done": "完成",
  "settings.system": "系统集成",
  "settings.shellNewTextFile": "在右键菜单中显示「新建文本文件」",
  "settings.shellOpenWith": "使用 Jotpad 打开文本文件",
  "settings.shellHint": "启用后会出现在 Finder / 资源管理器右键菜单；完整「打开方式」需安装版应用。",
  "settings.shellError": "无法更新系统集成，请检查权限后重试",

  // Misc
  "misc.emptyHint": "新建一个标签页开始编写",
  "misc.about": "关于 Jotpad",
  "misc.aboutText": "一款跨平台记事本",
};

const en: Dict = {
  "app.name": "Jotpad",

  "menu.file": "File",
  "menu.edit": "Edit",
  "menu.view": "View",
  "menu.help": "Help",

  "file.new": "New Tab",
  "file.newKey": "Ctrl+N",
  "file.newWindow": "New Window",
  "file.open": "Open…",
  "file.recent": "Recent Files",
  "file.recentEmpty": "(Empty)",
  "file.clearRecent": "Clear Recent Files",
  "file.save": "Save",
  "file.saveAs": "Save As…",
  "file.pageSetup": "Page Setup…",
  "file.print": "Print…",
  "file.exit": "Exit",

  // Page setup
  "pageSetup.title": "Page Setup",
  "pageSetup.paper": "Paper size",
  "pageSetup.orientation": "Orientation",
  "pageSetup.portrait": "Portrait",
  "pageSetup.landscape": "Landscape",
  "pageSetup.margin": "Margins (mm)",
  "pageSetup.ok": "OK",

  "edit.undo": "Undo",
  "edit.redo": "Redo",
  "edit.cut": "Cut",
  "edit.copy": "Copy",
  "edit.paste": "Paste",
  "edit.delete": "Delete",
  "edit.find": "Find…",
  "edit.findNext": "Find Next",
  "edit.findPrev": "Find Previous",
  "edit.replace": "Replace…",
  "edit.goto": "Go To…",
  "edit.selectAll": "Select All",
  "edit.timeDate": "Time/Date",

  "view.zoom": "Zoom",
  "view.zoomIn": "Zoom In",
  "view.zoomOut": "Zoom Out",
  "view.zoomReset": "Restore Default Zoom",
  "view.statusBar": "Status Bar",
  "view.wordWrap": "Word Wrap",
  "view.lineNumbers": "Line Numbers",
  "view.theme": "Theme",
  "view.themeLight": "Light",
  "view.themeDark": "Dark",
  "view.themeSystem": "Use System Setting",
  "view.language": "Language",
  "view.encoding": "Encoding",
  "view.lineEnding": "Line Ending",

  "toolbar.font": "Font",
  "toolbar.fontSize": "Font Size",
  "toolbar.wordWrap": "Word Wrap",
  "toolbar.zoomOut": "Zoom Out",
  "toolbar.zoomIn": "Zoom In",
  "toolbar.theme": "Theme",
  "toolbar.settings": "Settings",

  "tab.new": "New Tab",
  "tab.close": "Close Tab",
  "tab.closeOthers": "Close Other Tabs",
  "tab.untitled": "Untitled",
  "tab.rename": "Rename",
  "tab.unsaved": "Unsaved",

  "find.find": "Find",
  "find.placeholder": "Find",
  "find.replaceWith": "Replace with",
  "find.replacePlaceholder": "Replace",
  "find.caseSensitive": "Match case",
  "find.regexp": "Regular expression",
  "find.prev": "Previous",
  "find.next": "Next",
  "find.replaceOne": "Replace",
  "find.replaceAll": "Replace All",
  "find.matchCount": "{i} of {n} matches",
  "find.matchCountOnly": "{n} matches",
  "find.noMatch": "No results",
  "find.replaceInfo": "Replaced {n} occurrences",

  "goto.title": "Go to Line",
  "goto.line": "Line number",

  "dialog.saveChangesTitle": "Jotpad",
  "dialog.saveChangesMsg": "Do you want to save changes to {name}?",
  "dialog.save": "Save",
  "dialog.dontSave": "Don't Save",
  "dialog.cancel": "Cancel",
  "dialog.confirmCloseTitle": "Confirm Close",
  "dialog.confirmExitMsg": "You have unsaved changes. Save before exiting?",
  "dialog.fileNotFound": "File not found: {name}",
  "dialog.openError": "Failed to open file",
  "dialog.saveError": "Failed to save file",
  "dialog.reloadTitle": "File Changed",
  "dialog.reloadMsg": "“{name}” has been modified by another program. Reload it?",
  "dialog.reload": "Reload",
  "dialog.reloadKeep": "Keep Editing",

  "status.line": "Line",
  "status.col": "Col",
  "status.chars": "chars",
  "status.selected": "selected",
  "status.lines": "lines",
  "status.zoom": "Zoom",
  "status.encoding": "Encoding",

  "settings.title": "Settings",
  "settings.appearance": "Appearance",
  "settings.editor": "Editor",
  "settings.general": "General",
  "settings.language": "Language",
  "settings.font": "Font",
  "settings.fontSize": "Font Size",
  "settings.behavior": "Behavior",
  "settings.showStatusBar": "Show status bar",
  "settings.wordWrap": "Word wrap",
  "settings.lineNumbers": "Show line numbers",
  "settings.accent": "Accent color",
  "settings.done": "Done",
  "settings.system": "System integration",
  "settings.shellNewTextFile": "Show “New Text File” in context menu",
  "settings.shellOpenWith": "Open text files with Jotpad",
  "settings.shellHint": "Adds Finder / Explorer context-menu items. Full “Open With” needs an installed build.",
  "settings.shellError": "Could not update system integration. Check permissions and try again.",

  "misc.emptyHint": "Create a new tab to start writing",
  "misc.about": "About Jotpad",
  "misc.aboutText": "A cross-platform notepad",
};

const DICTS: Record<Locale, Dict> = {
  "zh-CN": zhCN,
  en,
};

export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const dict = DICTS[locale] ?? zhCN;
  let s = dict[key] ?? zhCN[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}

/** React hook returning a translator bound to the current UI locale. */
export function useT() {
  const locale = useStore((s) => s.settings.locale);
  return useCallback(
    (key: string, params?: Record<string, string | number>) => translate(locale, key, params),
    [locale],
  );
}
