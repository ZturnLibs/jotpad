// Native menu construction via Tauri's Builder API (macOS system menu bar,
// Windows/Linux window menu bar). The frontend serializes a menu tree; Rust
// rebuilds it and forwards clicks.
//
// Edit actions that the OS already implements (cut/copy/paste/selectAll) must
// use PredefinedMenuItem so accelerators go through the webview responder
// chain instead of the async Web Clipboard API (which shows a "Paste" prompt).
use serde::Deserialize;
use tauri::menu::{
    CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PredefinedKind {
    Cut,
    Copy,
    Paste,
    SelectAll,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum MenuNode {
    Item {
        id: String,
        text: String,
        #[serde(rename = "accelerator")]
        accel: Option<String>,
        #[serde(default = "default_true")]
        enabled: bool,
    },
    /// OS/Tauri built-in edit actions (native clipboard + first-responder).
    Predefined {
        item: PredefinedKind,
        text: Option<String>,
    },
    Check {
        id: String,
        text: String,
        #[serde(default)]
        checked: bool,
        #[serde(default = "default_true")]
        enabled: bool,
    },
    Separator,
    Submenu {
        text: String,
        #[serde(default)]
        items: Vec<MenuNode>,
        #[serde(default = "default_true")]
        enabled: bool,
    },
}

fn default_true() -> bool {
    true
}

fn build_submenu<R: Runtime, M: Manager<R>>(
    app: &M,
    text: &str,
    enabled: bool,
    nodes: &[MenuNode],
) -> tauri::Result<tauri::menu::Submenu<R>> {
    let mut b = SubmenuBuilder::new(app, text).enabled(enabled);
    for node in nodes {
        match node {
            MenuNode::Separator => {
                b = b.separator();
            }
            MenuNode::Predefined { item, text } => {
                let label = text.as_deref();
                let predefined = match item {
                    PredefinedKind::Cut => PredefinedMenuItem::cut(app, label)?,
                    PredefinedKind::Copy => PredefinedMenuItem::copy(app, label)?,
                    PredefinedKind::Paste => PredefinedMenuItem::paste(app, label)?,
                    PredefinedKind::SelectAll => PredefinedMenuItem::select_all(app, label)?,
                };
                b = b.item(&predefined);
            }
            MenuNode::Item {
                id,
                text,
                accel,
                enabled,
            } => {
                // Try with the requested accelerator; if it fails to parse,
                // fall back to no accelerator so one bad value can't break
                // the whole menu.
                let item = if let Some(a) = accel {
                    match MenuItemBuilder::new(text)
                        .id(id)
                        .enabled(*enabled)
                        .accelerator(a)
                        .build(app)
                    {
                        Ok(it) => it,
                        Err(_) => {
                            eprintln!("[menu] bad accelerator '{a}' for '{id}', ignoring");
                            MenuItemBuilder::new(text)
                                .id(id)
                                .enabled(*enabled)
                                .build(app)?
                        }
                    }
                } else {
                    MenuItemBuilder::new(text)
                        .id(id)
                        .enabled(*enabled)
                        .build(app)?
                };
                b = b.item(&item);
            }
            MenuNode::Check {
                id,
                text,
                checked,
                enabled,
            } => {
                let item = CheckMenuItemBuilder::new(text)
                    .id(id)
                    .checked(*checked)
                    .enabled(*enabled)
                    .build(app)?;
                b = b.item(&item);
            }
            MenuNode::Submenu {
                text,
                items,
                enabled,
            } => {
                let sub = build_submenu(app, text, *enabled, items)?;
                b = b.item(&sub);
            }
        }
    }
    b.build()
}

/// Build the menu tree and set it as the app-wide menu.
/// On macOS, `Window::set_menu` is a no-op — the system menu bar requires
/// `AppHandle::set_menu`. On Windows/Linux, `AppHandle::set_menu` also
/// attaches the menu to windows that do not already have one.
pub fn apply<R: Runtime>(app: &AppHandle<R>, nodes: Vec<MenuNode>) -> tauri::Result<()> {
    eprintln!("[menu] apply: {} top-level menus", nodes.len());
    let mut mb = MenuBuilder::new(app);
    for node in &nodes {
        if let MenuNode::Submenu { text, items, enabled } = node {
            eprintln!("[menu]   submenu '{}' with {} items", text, items.len());
            let sub = build_submenu(app, text, *enabled, items)?;
            mb = mb.item(&sub);
        }
    }
    let menu = mb.build()?;
    app.set_menu(menu)?;
    eprintln!("[menu] set_menu OK");
    Ok(())
}

/// Forward menu item clicks to the frontend as "menu://click".
pub fn handle_event<R: Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref().to_string();
    let _ = app.emit("menu://click", id);
}

fn item(id: &str, text: &str, accel: Option<&str>) -> MenuNode {
    MenuNode::Item {
        id: id.to_string(),
        text: text.to_string(),
        accel: accel.map(|s| s.to_string()),
        enabled: true,
    }
}

fn predefined(kind: PredefinedKind, text: &str) -> MenuNode {
    MenuNode::Predefined {
        item: kind,
        text: Some(text.to_string()),
    }
}

fn check(id: &str, text: &str, checked: bool) -> MenuNode {
    MenuNode::Check {
        id: id.to_string(),
        text: text.to_string(),
        checked,
        enabled: true,
    }
}

const SEP: MenuNode = MenuNode::Separator;

/// A full default menu (zh-CN, default settings) applied at startup so the
/// macOS menu bar is populated immediately (runtime `set_menu` on macOS does
/// not reliably refresh an already-shown main menu). The frontend may update
/// it afterwards to sync language / checkmarks.
pub fn default_menu<R: Runtime, M: Manager<R>>(
    app: &M,
) -> tauri::Result<tauri::menu::Menu<R>> {
    let app_menu = MenuNode::Submenu {
        text: "Jotpad".to_string(),
        enabled: true,
        items: vec![
            item("about", "关于 Jotpad", None),
            SEP,
            item("exit", "退出", Some("CmdOrCtrl+Q")),
        ],
    };

    let file_menu = MenuNode::Submenu {
        text: "文件".to_string(),
        enabled: true,
        items: vec![
            item("new", "新建标签页", Some("CmdOrCtrl+N")),
            item("newWindow", "新建窗口", Some("CmdOrCtrl+Shift+N")),
            item("open", "打开…", Some("CmdOrCtrl+O")),
            SEP,
            item("save", "保存", Some("CmdOrCtrl+S")),
            item("saveAs", "另存为…", Some("CmdOrCtrl+Shift+S")),
            SEP,
            item("pageSetup", "页面设置…", None),
            item("print", "打印…", Some("CmdOrCtrl+P")),
        ],
    };

    let edit_menu = MenuNode::Submenu {
        text: "编辑".to_string(),
        enabled: true,
        items: vec![
            // Undo/redo stay custom: CodeMirror owns its history stack.
            item("undo", "撤销", Some("CmdOrCtrl+Z")),
            item("redo", "重做", Some("CmdOrCtrl+Y")),
            SEP,
            predefined(PredefinedKind::Cut, "剪切"),
            predefined(PredefinedKind::Copy, "复制"),
            predefined(PredefinedKind::Paste, "粘贴"),
            // No Delete accelerator — let the editor handle the key natively.
            item("delete", "删除", None),
            SEP,
            item("find", "查找…", Some("CmdOrCtrl+F")),
            item("findNext", "查找下一个", Some("F3")),
            item("findPrev", "查找上一个", Some("Shift+F3")),
            item("replace", "替换…", Some("CmdOrCtrl+H")),
            item("goto", "转到…", Some("CmdOrCtrl+G")),
            SEP,
            predefined(PredefinedKind::SelectAll, "全选"),
            item("timeDate", "时间/日期", Some("F5")),
        ],
    };

    let view_menu = MenuNode::Submenu {
        text: "查看".to_string(),
        enabled: true,
        items: vec![
            MenuNode::Submenu {
                text: "缩放".to_string(),
                enabled: true,
                items: vec![
                    item("zoomIn", "放大", Some("CmdOrCtrl+=")),
                    item("zoomOut", "缩小", Some("CmdOrCtrl+-")),
                    SEP,
                    item("zoomReset", "恢复默认大小", Some("CmdOrCtrl+0")),
                ],
            },
            SEP,
            check("alwaysOnTop", "窗口置顶", false),
            check("wordWrap", "自动换行", true),
            check("statusBar", "状态栏", true),
            MenuNode::Submenu {
                text: "主题".to_string(),
                enabled: true,
                items: vec![
                    check("theme-light", "浅色", false),
                    check("theme-dark", "深色", false),
                    check("theme-system", "使用系统设置", true),
                ],
            },
            MenuNode::Submenu {
                text: "语言".to_string(),
                enabled: true,
                items: vec![
                    check("lang-zh-CN", "中文（简体）", true),
                    check("lang-en", "English", false),
                ],
            },
            MenuNode::Submenu {
                text: "编码".to_string(),
                enabled: true,
                items: vec![
                    check("enc-UTF-8", "UTF-8", true),
                    check("enc-UTF-16LE", "UTF-16LE", false),
                    check("enc-UTF-16BE", "UTF-16BE", false),
                    check("enc-GBK", "GBK", false),
                    check("enc-Big5", "Big5", false),
                    check("enc-Shift-JIS", "Shift-JIS", false),
                    check("enc-EUC-KR", "EUC-KR", false),
                    check("enc-Windows-1252", "Windows-1252", false),
                ],
            },
            MenuNode::Submenu {
                text: "行尾".to_string(),
                enabled: true,
                items: vec![
                    check("le-CRLF", "CRLF", true),
                    check("le-LF", "LF", false),
                    check("le-CR", "CR", false),
                ],
            },
            SEP,
            item("settings", "设置…", Some("CmdOrCtrl+,")),
        ],
    };

    let nodes = [app_menu, file_menu, edit_menu, view_menu];
    let mut mb = MenuBuilder::new(app);
    for node in &nodes {
        if let MenuNode::Submenu { text, items, enabled } = node {
            let sub = build_submenu(app, text, *enabled, items)?;
            mb = mb.item(&sub);
        }
    }
    mb.build()
}
