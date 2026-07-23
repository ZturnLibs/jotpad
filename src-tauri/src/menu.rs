// Native menu construction (macOS system menu bar). The frontend serializes a
// menu tree; Rust rebuilds it via tauri::menu (muda) and forwards clicks.
use serde::Deserialize;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, Runtime, WebviewWindow};

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

fn build_items<R: Runtime>(
    app: &impl Manager<R>,
    nodes: &[MenuNode],
) -> tauri::Result<Vec<Box<dyn IsMenuItem<R>>>> {
    let mut out: Vec<Box<dyn IsMenuItem<R>>> = Vec::with_capacity(nodes.len());
    for node in nodes {
        match node {
            MenuNode::Separator => out.push(Box::new(PredefinedMenuItem::separator(app)?)),
            MenuNode::Check {
                id,
                text,
                checked,
                enabled,
            } => {
                out.push(Box::new(CheckMenuItem::with_id(
                    app,
                    id,
                    text,
                    *enabled,
                    *checked,
                    None::<&str>,
                )?));
            }
            MenuNode::Item {
                id,
                text,
                accel,
                enabled,
            } => {
                out.push(Box::new(MenuItem::with_id(
                    app,
                    id,
                    text,
                    *enabled,
                    accel.as_deref(),
                )?));
            }
            MenuNode::Submenu {
                text,
                items,
                enabled,
            } => {
                let inner = build_items(app, items)?;
                let refs: Vec<&dyn IsMenuItem<R>> = inner.iter().map(|i| i.as_ref()).collect();
                out.push(Box::new(Submenu::with_items(app, text, *enabled, &refs)?));
            }
        }
    }
    Ok(out)
}

/// Build the menu tree and apply it to the given window.
pub fn apply<R: Runtime>(
    app: &impl Manager<R>,
    window: &WebviewWindow<R>,
    nodes: Vec<MenuNode>,
) -> tauri::Result<()> {
    let items = build_items(app, &nodes)?;
    let refs: Vec<&dyn IsMenuItem<R>> = items.iter().map(|i| i.as_ref()).collect();
    let menu = Menu::with_items(app, &refs)?;
    window.set_menu(menu)?;
    Ok(())
}

/// Forward menu item clicks to the frontend as "menu://click".
pub fn handle_event<R: Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref().to_string();
    let _ = app.emit("menu://click", id);
}
