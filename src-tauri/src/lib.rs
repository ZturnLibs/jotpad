// Jotpad backend: multi-encoding file I/O + persistent state (drafts/settings/recents).
mod menu;
mod shell_integration;

use encoding_rs::{BIG5, EUC_KR, GBK, SHIFT_JIS, UTF_8, UTF_16BE, UTF_16LE, WINDOWS_1252, Encoding};
use serde::Serialize;
use std::fs;
use tauri::Manager;

#[derive(Serialize)]
struct ReadResult {
    text: String,
    encoding: String,
    line_ending: String,
    has_bom: bool,
    size: u64,
    mtime_ms: u64,
}

fn file_mtime_ms(path: &str) -> Result<u64, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let mtime = meta.modified().map_err(|e| e.to_string())?;
    let dur = mtime
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok(dur.as_millis() as u64)
}

/// Resolve an encoding by its display name.
fn encoding_from_name(name: &str) -> &'static Encoding {
    match name {
        "UTF-8" => &UTF_8,
        "UTF-16LE" => &UTF_16LE,
        "UTF-16BE" => &UTF_16BE,
        "GBK" => &GBK,
        "Big5" => &BIG5,
        "Shift-JIS" => &SHIFT_JIS,
        "EUC-KR" => &EUC_KR,
        "Windows-1252" => &WINDOWS_1252,
        _ => &UTF_8,
    }
}

/// Decode raw bytes to text, auto-detecting encoding via BOM then heuristics.
/// Returns (text, encoding_name, has_bom).
fn decode_bytes(bytes: &[u8]) -> (String, String, bool) {
    // 1. BOM detection
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let cow = UTF_16LE
            .decode_without_bom_handling(&bytes[2..])
            .0;
        return (cow.into_owned(), "UTF-16LE".into(), true);
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let cow = UTF_16BE
            .decode_without_bom_handling(&bytes[2..])
            .0;
        return (cow.into_owned(), "UTF-16BE".into(), true);
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        let cow = UTF_8
            .decode_without_bom_handling(&bytes[3..])
            .0;
        return (cow.into_owned(), "UTF-8".into(), true);
    }
    // 2. Strict UTF-8 (most common today)
    if let Some(cow) = UTF_8.decode_without_bom_handling_and_without_replacement(bytes) {
        return (cow.into_owned(), "UTF-8".into(), false);
    }
    // 3. CJK heuristics (ordered by likelihood)
    if let Some(cow) = GBK.decode_without_bom_handling_and_without_replacement(bytes) {
        return (cow.into_owned(), "GBK".into(), false);
    }
    if let Some(cow) = SHIFT_JIS.decode_without_bom_handling_and_without_replacement(bytes) {
        return (cow.into_owned(), "Shift-JIS".into(), false);
    }
    if let Some(cow) = EUC_KR.decode_without_bom_handling_and_without_replacement(bytes) {
        return (cow.into_owned(), "EUC-KR".into(), false);
    }
    if let Some(cow) = BIG5.decode_without_bom_handling_and_without_replacement(bytes) {
        return (cow.into_owned(), "Big5".into(), false);
    }
    // 4. Fallback: Windows-1252 (always succeeds, lossy for high bytes)
    let cow = WINDOWS_1252.decode_without_bom_handling(bytes).0;
    (cow.into_owned(), "Windows-1252".into(), false)
}

/// Detect the dominant line ending style of a text.
fn detect_line_ending(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "CRLF"
    } else if text.contains('\r') {
        "CR"
    } else if text.contains('\n') {
        "LF"
    } else {
        "CRLF" // default (Windows convention)
    }
}

/// Normalize all line endings to LF for in-editor representation.
fn normalize_to_lf(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

#[tauri::command]
fn read_file(path: String) -> Result<ReadResult, String> {
    let path = path.trim_start_matches("file://");
    let mtime_ms = file_mtime_ms(path)?;
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let size = bytes.len() as u64;
    let (raw, encoding, has_bom) = decode_bytes(&bytes);
    let line_ending = detect_line_ending(&raw).to_string();
    let text = normalize_to_lf(&raw);
    Ok(ReadResult {
        text,
        encoding,
        line_ending,
        has_bom,
        size,
        mtime_ms,
    })
}

#[tauri::command]
fn file_mtime(path: String) -> Result<u64, String> {
    let path = path.trim_start_matches("file://");
    file_mtime_ms(path)
}

#[tauri::command]
fn rename_file(from: String, to: String) -> Result<(), String> {
    let from = from.trim_start_matches("file://");
    let to = to.trim_start_matches("file://");
    if from == to {
        return Ok(());
    }
    let to_path = std::path::Path::new(to);
    if to_path.exists() {
        return Err("target exists".into());
    }
    if let Some(parent) = to_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(from, to).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(
    path: String,
    text: String,
    encoding: String,
    line_ending: String,
    with_bom: bool,
) -> Result<(), String> {
    let path = path.trim_start_matches("file://");
    let normalized = normalize_to_lf(&text);
    let final_text = match line_ending.as_str() {
        "CRLF" => normalized.replace('\n', "\r\n"),
        "CR" => normalized.replace('\n', "\r"),
        _ => normalized,
    };
    let enc = encoding_from_name(&encoding);
    let (cow, _, _) = enc.encode(&final_text);
    let mut out: Vec<u8> = Vec::with_capacity(cow.len() + 4);
    if with_bom {
        match encoding.as_str() {
            "UTF-16LE" => out.extend_from_slice(&[0xFF, 0xFE]),
            "UTF-16BE" => out.extend_from_slice(&[0xFE, 0xFF]),
            "UTF-8" => out.extend_from_slice(&[0xEF, 0xBB, 0xBF]),
            _ => {}
        }
    }
    out.extend_from_slice(cow.as_ref());
    // Atomic write via temp + rename
    let p = std::path::Path::new(path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("jottmp");
    fs::write(&tmp, &out).map_err(|e| e.to_string())?;
    fs::rename(&tmp, p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(())
}

fn state_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("jotpad-state.json"))
}

#[tauri::command]
fn read_state(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = state_path(&app)?;
    if path.exists() {
        let s = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let v: serde_json::Value = serde_json::from_str(&s).map_err(|e| e.to_string())?;
        Ok(Some(v))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn write_state(app: tauri::AppHandle, state: serde_json::Value) -> Result<(), String> {
    let path = state_path(&app)?;
    let s = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, s).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(())
}

#[tauri::command]
fn set_app_menu(
    app: tauri::AppHandle,
    menus: Vec<menu::MenuNode>,
) -> Result<(), String> {
    eprintln!("[menu] set_app_menu invoked: {} top menus", menus.len());
    menu::apply(&app, menus).map_err(|e| {
        eprintln!("[menu] apply ERROR: {e}");
        e.to_string()
    })
}

/// Read clipboard text via the OS clipboard (avoids WebView Clipboard API prompts).
#[tauri::command]
fn clipboard_read_text() -> Result<String, String> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.get_text())
        .map_err(|e| e.to_string())
}

/// Write clipboard text via the OS clipboard.
#[tauri::command]
fn clipboard_write_text(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text))
        .map_err(|e| e.to_string())
}

/// Best-effort system accent color as [r, g, b].
#[tauri::command]
fn get_system_accent() -> [u8; 3] {
    system_accent()
}

#[cfg(windows)]
fn system_accent() -> [u8; 3] {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(colors) = hkcu.open_subkey("Control Panel\\Colors") {
        if let Ok(val) = colors.get_value::<String, _>("Hilight") {
            let parts: Vec<&str> = val.split_whitespace().collect();
            if parts.len() == 3 {
                let r = parts[0].parse::<u8>().unwrap_or(0);
                let g = parts[1].parse::<u8>().unwrap_or(103);
                let b = parts[2].parse::<u8>().unwrap_or(192);
                return [r, g, b];
            }
        }
    }
    [0, 120, 212]
}

#[cfg(not(windows))]
fn system_accent() -> [u8; 3] {
    // Default Jotpad blue; close to macOS/Windows system blue.
    [0, 120, 212]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            file_mtime,
            rename_file,
            read_state,
            write_state,
            set_app_menu,
            clipboard_read_text,
            clipboard_write_text,
            get_system_accent,
            shell_integration::take_pending_open_paths,
            shell_integration::shell_integration_status,
            shell_integration::set_shell_new_text_file,
            shell_integration::set_shell_open_with,
        ])
        .on_menu_event(|app, event| menu::handle_event(app, event))
        .setup(|app| {
            // App-wide menu (required on macOS; Window::set_menu is a no-op there).
            let menu = menu::default_menu(app)?;
            app.set_menu(menu)?;
            eprintln!("[menu] startup app menu set");

            // Windows / Linux (and macOS argv fallback): open files from launch args.
            let launch = shell_integration::collect_launch_paths();
            if !launch.is_empty() {
                shell_integration::enqueue_open_paths(app.handle(), launch);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = event {
            let files: Vec<String> = urls
                .into_iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|p| p.to_string_lossy().into_owned())
                .collect();
            shell_integration::enqueue_open_paths(app, files);
        }
    });
}
