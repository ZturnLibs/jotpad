//! 应用日志：写入 `{app_data}/logs/jotpad.log`，并同步到 stderr。
//! 约定：模块名短横线小写（如 `voice`、`menu`）；用户可见文案走 i18n，细节只打日志。

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

static LOG_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

#[derive(Clone, Copy)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }
}

/// 在 setup 中调用一次，之后各模块可写日志。
pub fn init(app: &AppHandle) -> Result<(), String> {
    let dir = crate::data_dir(app)?.join("logs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("jotpad.log");
    rotate_if_needed(&path)?;
    let mut guard = LOG_PATH.lock().map_err(|e| e.to_string())?;
    *guard = Some(path);
    drop(guard);
    info("log", "logger initialized");
    Ok(())
}

fn rotate_if_needed(path: &PathBuf) -> Result<(), String> {
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() > MAX_LOG_BYTES {
            let bak = path.with_extension("log.1");
            let _ = fs::remove_file(&bak);
            let _ = fs::rename(path, &bak);
        }
    }
    Ok(())
}

fn now_stamp() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    // 简洁时间戳，便于 grep；完整本地时区留给系统控制台
    format!("{ms}")
}

fn write_line(level: Level, module: &str, msg: &str) {
    let line = format!("[{}] [{}] [{}] {}\n", now_stamp(), level.as_str(), module, msg);
    eprint!("{line}");
    let path = {
        let guard = match LOG_PATH.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        guard.clone()
    };
    let Some(path) = path else { return };
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = f.write_all(line.as_bytes());
    }
}

pub fn info(module: &str, msg: impl AsRef<str>) {
    write_line(Level::Info, module, msg.as_ref());
}

pub fn warn(module: &str, msg: impl AsRef<str>) {
    write_line(Level::Warn, module, msg.as_ref());
}

pub fn error(module: &str, msg: impl AsRef<str>) {
    write_line(Level::Error, module, msg.as_ref());
}

/// 供前端把重要错误写入同一日志文件。
#[tauri::command]
pub fn app_log_write(level: String, module: String, message: String) -> Result<(), String> {
    let lv = match level.to_ascii_lowercase().as_str() {
        "error" => Level::Error,
        "warn" | "warning" => Level::Warn,
        _ => Level::Info,
    };
    let mod_name = if module.trim().is_empty() {
        "ui"
    } else {
        module.trim()
    };
    write_line(lv, mod_name, &message);
    Ok(())
}
