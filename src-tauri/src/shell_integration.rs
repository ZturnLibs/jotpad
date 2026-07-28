//! System shell integration: Finder/Explorer context menus + file open handling.
//!
//! - 「新建文本文件」: Finder Quick Action / Explorer context menu / Nautilus·Dolphin
//! - 「使用 Jotpad 打开」: Open-with registration + context menu item (not forced default)

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

const BUNDLE_ID: &str = "com.jotpad.app";
const NEW_SERVICE_NAME: &str = "Jotpad 新建文本文件.workflow";
const OPEN_SERVICE_NAME: &str = "使用 Jotpad 打开.workflow";
const NEW_MENU: &str = "Jotpad 新建文本文件";
const OPEN_MENU: &str = "使用 Jotpad 打开";
const MARKER_DIR: &str = "shell-integration";
const MARKER_NEW: &str = "new-text-file";
const MARKER_OPEN: &str = "open-with";

/// Paths received before the frontend is ready (esp. macOS Opened).
static PENDING_PATHS: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationStatus {
    pub new_text_file: bool,
    pub open_with: bool,
    pub platform: String,
}

fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn marker_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(MARKER_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

fn has_marker(app: &AppHandle, name: &str) -> bool {
    marker_path(app, name)
        .map(|p| p.exists())
        .unwrap_or(false)
}

fn set_marker(app: &AppHandle, name: &str, enabled: bool) -> Result<(), String> {
    let path = marker_path(app, name)?;
    if enabled {
        fs::write(&path, b"1").map_err(|e| e.to_string())
    } else {
        let _ = fs::remove_file(&path);
        Ok(())
    }
}

/// Prefer Chinese UI labels when the OS locale looks Chinese.
#[cfg(any(target_os = "windows", all(unix, not(target_os = "macos"))))]
fn locale_zh() -> bool {
    #[cfg(target_os = "windows")]
    {
        let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey(r"Control Panel\International") {
            if let Ok(name) = key.get_value::<String, _>("LocaleName") {
                return name.to_lowercase().starts_with("zh");
            }
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        for var in ["LC_ALL", "LC_MESSAGES", "LANG"] {
            if let Ok(v) = std::env::var(var) {
                if v.to_lowercase().starts_with("zh") {
                    return true;
                }
            }
        }
        false
    }
}

#[cfg(any(target_os = "windows", all(unix, not(target_os = "macos"))))]
fn label_new_text() -> &'static str {
    if locale_zh() {
        "Jotpad 新建文本文件"
    } else {
        "New Text File (Jotpad)"
    }
}

#[cfg(any(target_os = "windows", all(unix, not(target_os = "macos"))))]
fn label_open_with() -> &'static str {
    if locale_zh() {
        "使用 Jotpad 打开"
    } else {
        "Open with Jotpad"
    }
}

/// Resolve the .app bundle (macOS) or the executable path.
pub fn app_launch_path() -> PathBuf {
    let exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::from("jotpad"));
    #[cfg(target_os = "macos")]
    {
        for ancestor in exe.ancestors() {
            if ancestor.extension().and_then(|e| e.to_str()) == Some("app") {
                return ancestor.to_path_buf();
            }
        }
    }
    exe
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Push opened file paths and notify the frontend when possible.
pub fn enqueue_open_paths(app: &AppHandle, paths: Vec<String>) {
    let paths: Vec<String> = paths
        .into_iter()
        .map(|p| p.trim_start_matches("file://").to_string())
        .filter(|p| !p.is_empty() && Path::new(p).exists())
        .collect();
    if paths.is_empty() {
        return;
    }
    if let Ok(mut pending) = PENDING_PATHS.lock() {
        for p in &paths {
            if !pending.iter().any(|x| x == p) {
                pending.push(p.clone());
            }
        }
    }
    let _ = app.emit("open-paths", paths);
}

/// Parse argv / CLI for file paths and `--new-in <dir>`.
pub fn collect_launch_paths() -> Vec<String> {
    let mut files = Vec::new();
    let mut args = std::env::args().skip(1).peekable();
    while let Some(arg) = args.next() {
        if arg == "--new-in" {
            if let Some(dir) = args.next() {
                if let Ok(path) = create_new_text_file(&dir) {
                    files.push(path);
                }
            }
            continue;
        }
        if arg.starts_with('-') {
            continue;
        }
        if let Some(rest) = arg.strip_prefix("file://") {
            let p = PathBuf::from(rest);
            if p.exists() {
                files.push(path_to_string(&p));
            }
            continue;
        }
        let p = PathBuf::from(&arg);
        if p.exists() {
            files.push(path_to_string(&p));
        }
    }
    files
}

/// Create an uniquely named empty text file in `dir`.
pub fn create_new_text_file(dir: &str) -> Result<String, String> {
    let dir = Path::new(dir.trim_start_matches("file://"));
    if !dir.is_dir() {
        return Err(format!("not a directory: {}", dir.display()));
    }
    let candidates = ["未命名.txt", "untitled.txt", "New Text File.txt"];
    for name in candidates {
        let path = dir.join(name);
        if !path.exists() {
            fs::write(&path, b"").map_err(|e| e.to_string())?;
            return Ok(path_to_string(&path));
        }
    }
    for i in 2..1000 {
        let path = dir.join(format!("未命名 {i}.txt"));
        if !path.exists() {
            fs::write(&path, b"").map_err(|e| e.to_string())?;
            return Ok(path_to_string(&path));
        }
    }
    Err("could not allocate file name".into())
}

/// Re-install enabled integrations so executable paths stay current after updates.
pub fn resync_if_enabled(app: &AppHandle) {
    if has_marker(app, MARKER_NEW) {
        if let Err(e) = install_new_text_file(app) {
            eprintln!("[shell] resync new-text-file failed: {e}");
        }
    }
    if has_marker(app, MARKER_OPEN) {
        if let Err(e) = install_open_with(app) {
            eprintln!("[shell] resync open-with failed: {e}");
        }
    }
}

#[tauri::command]
pub fn take_pending_open_paths() -> Vec<String> {
    PENDING_PATHS
        .lock()
        .map(|mut g| std::mem::take(&mut *g))
        .unwrap_or_default()
}

#[tauri::command]
pub fn shell_integration_status(app: AppHandle) -> ShellIntegrationStatus {
    ShellIntegrationStatus {
        new_text_file: is_new_text_file_enabled(&app),
        open_with: is_open_with_enabled(&app),
        platform: platform_name().into(),
    }
}

#[tauri::command]
pub fn set_shell_new_text_file(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        install_new_text_file(&app)?;
    } else {
        uninstall_new_text_file(&app)?;
    }
    set_marker(&app, MARKER_NEW, enabled)?;
    Ok(())
}

#[tauri::command]
pub fn set_shell_open_with(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        install_open_with(&app)?;
    } else {
        uninstall_open_with(&app)?;
    }
    set_marker(&app, MARKER_OPEN, enabled)?;
    Ok(())
}

fn is_new_text_file_enabled(app: &AppHandle) -> bool {
    let _ = app;
    #[cfg(target_os = "macos")]
    {
        services_dir()
            .map(|d| d.join(NEW_SERVICE_NAME).exists())
            .unwrap_or(false)
            && macos::is_service_context_menu_enabled(NEW_MENU)
    }
    #[cfg(target_os = "windows")]
    {
        windows::new_text_registered()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        linux::new_text_installed()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        false
    }
}

fn is_open_with_enabled(app: &AppHandle) -> bool {
    let _ = app;
    #[cfg(target_os = "macos")]
    {
        services_dir()
            .map(|d| d.join(OPEN_SERVICE_NAME).exists())
            .unwrap_or(false)
            && macos::is_service_context_menu_enabled(OPEN_MENU)
    }
    #[cfg(target_os = "windows")]
    {
        windows::open_with_registered()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        linux::open_with_installed()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        false
    }
}

fn install_new_text_file(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos::install_new_text_workflow()
    }
    #[cfg(target_os = "windows")]
    {
        windows::install_new_text(app)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        linux::install_new_text(app)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        let _ = app;
        Err("unsupported platform".into())
    }
}

fn uninstall_new_text_file(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos::uninstall_workflow(NEW_SERVICE_NAME, NEW_MENU)
    }
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        windows::uninstall_new_text()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = app;
        linux::uninstall_new_text()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        let _ = app;
        Ok(())
    }
}

fn install_open_with(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos::install_open_with_workflow()
    }
    #[cfg(target_os = "windows")]
    {
        windows::install_open_with(app)
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        linux::install_open_with(app)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        let _ = app;
        Err("unsupported platform".into())
    }
}

fn uninstall_open_with(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        macos::uninstall_workflow(OPEN_SERVICE_NAME, OPEN_MENU)
    }
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        windows::uninstall_open_with()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = app;
        linux::uninstall_open_with()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn services_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    Ok(PathBuf::from(home).join("Library/Services"))
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::process::Command;

    pub fn install_new_text_workflow() -> Result<(), String> {
        let script = r#"dir=""
for item in "$@"; do
  if [ -d "$item" ]; then
    dir="$item"
    break
  fi
done
if [ -z "$dir" ]; then
  dir=$(/usr/bin/osascript -e 'tell application "Finder" to POSIX path of (insertion location as alias)' 2>/dev/null)
fi
[ -n "$dir" ] || exit 0
dir="${dir%/}"
name="未命名.txt"
if [ -e "$dir/$name" ]; then
  name="untitled.txt"
fi
if [ -e "$dir/$name" ]; then
  i=2
  while [ -e "$dir/未命名 $i.txt" ]; do i=$((i+1)); done
  name="未命名 $i.txt"
fi
/usr/bin/touch "$dir/$name"
"#;
        write_workflow(
            NEW_SERVICE_NAME,
            NEW_MENU,
            "new-text-file",
            &["public.folder"],
            script,
            "com.apple.Automator.fileSystemObject.folder",
            "A1B2C3D4-1111-4EAE-8588-EFEC8A48B0D1",
            "B2C3D4E5-2222-4A51-8CC1-477A68B23B21",
            "C3D4E5F6-3333-4FE4-8F38-F3FA66EB5822",
        )?;
        set_service_context_menu(NEW_MENU, true)?;
        refresh_services();
        Ok(())
    }

    pub fn install_open_with_workflow() -> Result<(), String> {
        let launch = app_launch_path();
        let launch_s = path_to_string(&launch);
        let is_app = launch.extension().and_then(|e| e.to_str()) == Some("app");
        let script = if is_app {
            format!(
                r#"app={app}
for item in "$@"; do
  [ -e "$item" ] || continue
  /usr/bin/open -b {bundle} "$item" 2>/dev/null || /usr/bin/open -a "$app" "$item"
done
"#,
                app = shell_single_quote(&launch_s),
                bundle = shell_single_quote(BUNDLE_ID),
            )
        } else {
            format!(
                r#"app={app}
# Dev / unpackaged binary — open by path; full Open With needs an installed .app.
/usr/bin/open -b {bundle} "$@" 2>/dev/null && exit 0
for item in "$@"; do
  [ -e "$item" ] || continue
  "$app" "$item" &
done
"#,
                app = shell_single_quote(&launch_s),
                bundle = shell_single_quote(BUNDLE_ID),
            )
        };
        write_workflow(
            OPEN_SERVICE_NAME,
            OPEN_MENU,
            "open-with",
            &[
                "public.plain-text",
                "public.text",
                "public.source-code",
                "public.data",
            ],
            &script,
            "com.apple.Automator.fileSystemObject",
            "D4E5F6A7-4444-4EAE-8588-EFEC8A48B0D2",
            "E5F6A7B8-5555-4A51-8CC1-477A68B23B22",
            "F6A7B8C9-6666-4FE4-8F38-F3FA66EB5823",
        )?;
        if is_app {
            let _ = Command::new("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
                .args(["-f", &launch_s])
                .status();
        }
        set_service_context_menu(OPEN_MENU, true)?;
        refresh_services();
        Ok(())
    }

    pub fn uninstall_workflow(name: &str, menu: &str) -> Result<(), String> {
        if let Ok(dir) = services_dir() {
            let path = dir.join(name);
            if path.exists() {
                fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
            }
        }
        let _ = set_service_context_menu(menu, false);
        refresh_services();
        Ok(())
    }

    pub fn is_service_context_menu_enabled(menu: &str) -> bool {
        let key = format!("(null) - {menu} - runWorkflowAsService");
        let Ok(domain) = read_pbs_domain() else {
            return false;
        };
        service_context_menu_enabled_in_domain(&domain, &key, menu)
    }

    fn set_service_context_menu(menu: &str, enabled: bool) -> Result<(), String> {
        let key = format!("(null) - {menu} - runWorkflowAsService");
        // `defaults write … -dict-add` mis-parses keys that start with `(null)`.
        // Export → mutate → import keeps cfprefsd in sync.
        let mut domain = read_pbs_domain().unwrap_or_else(|_| plist_dict_empty());
        let dict = domain
            .as_dictionary_mut()
            .ok_or_else(|| "pbs domain is not a dictionary".to_string())?;
        if !dict.contains_key("NSServicesStatus") {
            dict.insert("NSServicesStatus".into(), plist_dict_empty());
        }
        let status_dict = dict
            .get_mut("NSServicesStatus")
            .and_then(|v| v.as_dictionary_mut())
            .ok_or_else(|| "NSServicesStatus is not a dictionary".to_string())?;
        if enabled {
            status_dict.insert(key, presentation_modes_value());
        } else {
            status_dict.remove(&key);
            let stale: Vec<String> = status_dict
                .keys()
                .filter(|k| k.contains(menu))
                .cloned()
                .collect();
            for k in stale {
                status_dict.remove(&k);
            }
        }
        write_pbs_domain(&domain)?;
        Ok(())
    }

    fn presentation_modes_value() -> plist::Value {
        let mut modes = plist::Dictionary::new();
        modes.insert("ContextMenu".into(), plist::Value::Integer(1.into()));
        modes.insert("ServicesMenu".into(), plist::Value::Integer(1.into()));
        modes.insert("FinderPreview".into(), plist::Value::Integer(1.into()));
        modes.insert("TouchBar".into(), plist::Value::Integer(1.into()));
        let mut wrap = plist::Dictionary::new();
        wrap.insert("presentation_modes".into(), plist::Value::Dictionary(modes));
        plist::Value::Dictionary(wrap)
    }

    fn plist_dict_empty() -> plist::Value {
        plist::Value::Dictionary(plist::Dictionary::new())
    }

    fn service_context_menu_enabled_in_domain(
        domain: &plist::Value,
        key: &str,
        menu: &str,
    ) -> bool {
        let Some(status) = domain
            .as_dictionary()
            .and_then(|d| d.get("NSServicesStatus"))
            .and_then(|v| v.as_dictionary())
        else {
            return false;
        };
        let entry = status.get(key).or_else(|| {
            status
                .iter()
                .find(|(k, _)| k.contains(menu))
                .map(|(_, v)| v)
        });
        let Some(entry) = entry.and_then(|v| v.as_dictionary()) else {
            return false;
        };
        entry
            .get("presentation_modes")
            .and_then(|v| v.as_dictionary())
            .and_then(|m| m.get("ContextMenu"))
            .and_then(|v| v.as_signed_integer())
            .map(|n| n != 0)
            .unwrap_or(false)
    }

    fn read_pbs_domain() -> Result<plist::Value, String> {
        let output = Command::new("/usr/bin/defaults")
            .args(["export", "pbs", "-"])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() || output.stdout.is_empty() {
            return Ok(plist_dict_empty());
        }
        plist::from_bytes(&output.stdout).map_err(|e| e.to_string())
    }

    fn write_pbs_domain(domain: &plist::Value) -> Result<(), String> {
        let mut xml = Vec::new();
        plist::to_writer_xml(&mut xml, domain).map_err(|e| e.to_string())?;
        let mut child = Command::new("/usr/bin/defaults")
            .args(["import", "pbs", "-"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        use std::io::Write;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(&xml).map_err(|e| e.to_string())?;
        }
        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "defaults import pbs failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        Ok(())
    }

    fn write_workflow(
        name: &str,
        menu: &str,
        service_id: &str,
        file_types: &[&str],
        command: &str,
        input_type: &str,
        action_uuid: &str,
        input_uuid: &str,
        output_uuid: &str,
    ) -> Result<(), String> {
        let dir = services_dir()?.join(name).join("Contents");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let types_xml: String = file_types
            .iter()
            .map(|t| format!("\t\t\t\t<string>{t}</string>\n"))
            .collect();

        let info = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>English</string>
	<key>CFBundleExecutable</key>
	<string></string>
	<key>CFBundleIdentifier</key>
	<string>{bundle}.service.{service_id}</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>{menu}</string>
	<key>CFBundlePackageType</key>
	<string>BNDL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSBackgroundColorName</key>
			<string>background</string>
			<key>NSIconName</key>
			<string>NSTouchBarAdd</string>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>{menu}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSApplicationIdentifier</key>
				<string>com.apple.finder</string>
			</dict>
			<key>NSSendFileTypes</key>
			<array>
{types_xml}			</array>
		</dict>
	</array>
</dict>
</plist>
"#,
            bundle = BUNDLE_ID,
        );
        fs::write(dir.join("Info.plist"), info).map_err(|e| e.to_string())?;

        let escaped = command
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");

        let wflow = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>528</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.path</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMParameterProperties</key>
				<dict>
					<key>COMMAND_STRING</key>
					<dict/>
					<key>CheckedForUserDefaultShell</key>
					<dict/>
					<key>inputMethod</key>
					<dict/>
					<key>shell</key>
					<dict/>
					<key>source</key>
					<dict/>
				</dict>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>{escaped}</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>{input_uuid}</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
				</array>
				<key>OutputUUID</key>
				<string>{output_uuid}</string>
				<key>UUID</key>
				<string>{action_uuid}</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
			</dict>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>applicationBundleID</key>
		<string>com.apple.finder</string>
		<key>applicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>presentationMode</key>
		<integer>15</integer>
		<key>processesInput</key>
		<false/>
		<key>serviceApplicationBundleID</key>
		<string>com.apple.finder</string>
		<key>serviceApplicationPath</key>
		<string>/System/Library/CoreServices/Finder.app</string>
		<key>serviceInputTypeIdentifier</key>
		<string>{input_type}</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<false/>
		<key>systemImageName</key>
		<string>NSTouchBarAdd</string>
		<key>useAutomaticInputType</key>
		<false/>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
"#
        );
        fs::write(dir.join("document.wflow"), wflow).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn refresh_services() {
        let _ = Command::new("/System/Library/CoreServices/pbs")
            .arg("-flush")
            .status();
    }

    fn shell_single_quote(s: &str) -> String {
        format!("'{}'", s.replace('\'', "'\"'\"'"))
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::*;
    use winreg::enums::*;
    use winreg::RegKey;

    const NEW_KEY: &str = r"Software\Classes\Directory\Background\shell\JotpadNewText";
    const NEW_DIR_KEY: &str = r"Software\Classes\Directory\shell\JotpadNewText";
    const OPEN_KEY: &str = r"Software\Classes\SystemFileAssociations\text\shell\JotpadOpen";
    const OPEN_TXT: &str = r"Software\Classes\.txt\shell\JotpadOpen";
    const PROGID: &str = r"Software\Classes\Jotpad.txt";
    const PROGID_OPENWITH: &str = r"Software\Classes\.txt\OpenWithProgids";

    pub fn new_text_registered() -> bool {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        hkcu.open_subkey(NEW_KEY).is_ok()
    }

    pub fn open_with_registered() -> bool {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        hkcu.open_subkey(OPEN_KEY).is_ok() || hkcu.open_subkey(PROGID).is_ok()
    }

    pub fn install_new_text(app: &AppHandle) -> Result<(), String> {
        let _ = app;
        let exe = path_to_string(&app_launch_path());
        let label = label_new_text();
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for key_path in [NEW_KEY, NEW_DIR_KEY] {
            let (key, _) = hkcu.create_subkey(key_path).map_err(|e| e.to_string())?;
            key.set_value("", &label).map_err(|e| e.to_string())?;
            key.set_value("Icon", &format!("\"{exe}\",0"))
                .map_err(|e| e.to_string())?;
            let (cmd, _) = key.create_subkey("command").map_err(|e| e.to_string())?;
            let command = if key_path.contains("Background") {
                format!("\"{exe}\" --new-in \"%V\"")
            } else {
                format!("\"{exe}\" --new-in \"%1\"")
            };
            cmd.set_value("", &command).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn uninstall_new_text() -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let _ = hkcu.delete_subkey_all(NEW_KEY);
        let _ = hkcu.delete_subkey_all(NEW_DIR_KEY);
        Ok(())
    }

    pub fn install_open_with(app: &AppHandle) -> Result<(), String> {
        let _ = app;
        let exe = path_to_string(&app_launch_path());
        let label = label_open_with();
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let (prog, _) = hkcu.create_subkey(PROGID).map_err(|e| e.to_string())?;
        prog.set_value("", &"Jotpad Text Document")
            .map_err(|e| e.to_string())?;
        let (cmd, _) = prog
            .create_subkey(r"shell\open\command")
            .map_err(|e| e.to_string())?;
        cmd.set_value("", &format!("\"{exe}\" \"%1\""))
            .map_err(|e| e.to_string())?;

        let (ow, _) = hkcu
            .create_subkey(PROGID_OPENWITH)
            .map_err(|e| e.to_string())?;
        ow.set_value("Jotpad.txt", &"").map_err(|e| e.to_string())?;

        for key_path in [OPEN_KEY, OPEN_TXT] {
            let (key, _) = hkcu.create_subkey(key_path).map_err(|e| e.to_string())?;
            key.set_value("", &label).map_err(|e| e.to_string())?;
            key.set_value("Icon", &format!("\"{exe}\",0"))
                .map_err(|e| e.to_string())?;
            let (cmd, _) = key.create_subkey("command").map_err(|e| e.to_string())?;
            cmd.set_value("", &format!("\"{exe}\" \"%1\""))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn uninstall_open_with() -> Result<(), String> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let _ = hkcu.delete_subkey_all(OPEN_KEY);
        let _ = hkcu.delete_subkey_all(OPEN_TXT);
        let _ = hkcu.delete_subkey_all(PROGID);
        if let Ok(ow) = hkcu.open_subkey_with_flags(PROGID_OPENWITH, KEY_ALL_ACCESS) {
            let _ = ow.delete_value("Jotpad.txt");
        }
        Ok(())
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
mod linux {
    use super::*;

    fn home() -> Result<PathBuf, String> {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or_else(|| "HOME not set".into())
    }

    fn nautilus_scripts() -> Result<PathBuf, String> {
        Ok(home()?.join(".local/share/nautilus/scripts"))
    }

    fn dolphin_servicemenus() -> Result<PathBuf, String> {
        Ok(home()?.join(".local/share/kio/servicemenus"))
    }

    fn applications_dir() -> Result<PathBuf, String> {
        Ok(home()?.join(".local/share/applications"))
    }

    fn new_script_name() -> &'static str {
        if locale_zh() {
            "Jotpad-新建文本文件"
        } else {
            "Jotpad-New-Text-File"
        }
    }

    pub fn new_text_installed() -> bool {
        let nautilus = nautilus_scripts()
            .map(|d| d.join(new_script_name()).exists() || d.join("新建文本文件").exists())
            .unwrap_or(false);
        let dolphin = dolphin_servicemenus()
            .map(|d| d.join("jotpad-new-text.desktop").exists())
            .unwrap_or(false);
        nautilus || dolphin
    }

    pub fn open_with_installed() -> bool {
        applications_dir()
            .map(|d| d.join("jotpad-open-text.desktop").exists())
            .unwrap_or(false)
    }

    pub fn install_new_text(app: &AppHandle) -> Result<(), String> {
        let _ = app;
        let exe = path_to_string(&app_launch_path());
        let label = label_new_text();

        // Nautilus scripts (appear under Scripts submenu).
        let dir = nautilus_scripts()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        // Remove legacy name if present.
        let _ = fs::remove_file(dir.join("新建文本文件"));
        let script = format!(
            r#"#!/bin/bash
set -euo pipefail
DIR=""
if [ -n "${{NAUTILUS_SCRIPT_SELECTED_FILE_PATHS:-}}" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ -d "$line" ]; then DIR="$line"; break; fi
    DIR="$(dirname "$line")"
    break
  done <<< "$NAUTILUS_SCRIPT_SELECTED_FILE_PATHS"
fi
if [ -z "$DIR" ]; then
  DIR="${{NAUTILUS_SCRIPT_CURRENT_URI:-}}"
  DIR="${{DIR#file://}}"
fi
if [ -z "$DIR" ] || [ ! -d "$DIR" ]; then
  DIR="$(pwd)"
fi
exec "{exe}" --new-in "$DIR"
"#
        );
        let path = dir.join(new_script_name());
        fs::write(&path, script).map_err(|e| e.to_string())?;
        set_executable(&path)?;

        // Dolphin service menu.
        let ddir = dolphin_servicemenus()?;
        fs::create_dir_all(&ddir).map_err(|e| e.to_string())?;
        let desktop = format!(
            r#"[Desktop Entry]
Type=Service
ServiceTypes=inode/directory
Actions=newText
X-KDE-Priority=TopLevel

[Desktop Action newText]
Name={label}
Name[zh_CN]={zh}
Icon=text-plain
Exec="{exe}" --new-in %f
"#,
            zh = "Jotpad 新建文本文件",
        );
        fs::write(ddir.join("jotpad-new-text.desktop"), desktop).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn uninstall_new_text() -> Result<(), String> {
        if let Ok(dir) = nautilus_scripts() {
            let _ = fs::remove_file(dir.join(new_script_name()));
            let _ = fs::remove_file(dir.join("新建文本文件"));
            let _ = fs::remove_file(dir.join("Jotpad-New-Text-File"));
            let _ = fs::remove_file(dir.join("Jotpad-新建文本文件"));
        }
        if let Ok(dir) = dolphin_servicemenus() {
            let _ = fs::remove_file(dir.join("jotpad-new-text.desktop"));
        }
        Ok(())
    }

    pub fn install_open_with(app: &AppHandle) -> Result<(), String> {
        let _ = app;
        let exe = path_to_string(&app_launch_path());
        let label = label_open_with();
        let dir = applications_dir()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let desktop = format!(
            r#"[Desktop Entry]
Type=Application
Name=Jotpad
Name[zh_CN]=Jotpad
Comment=Open text files with Jotpad
Comment[zh_CN]={label}
Exec="{exe}" %F
Icon=jotpad
MimeType=text/plain;text/markdown;text/x-log;text/csv;application/json;application/xml;application/x-yaml;text/x-toml;
NoDisplay=false
StartupNotify=true
Categories=Utility;TextEditor;
"#
        );
        fs::write(dir.join("jotpad-open-text.desktop"), desktop).map_err(|e| e.to_string())?;

        // Dolphin / file-manager "Open with" style action for text files.
        let ddir = dolphin_servicemenus()?;
        fs::create_dir_all(&ddir).map_err(|e| e.to_string())?;
        let svc = format!(
            r#"[Desktop Entry]
Type=Service
ServiceTypes=text/plain,text/markdown,text/x-log
Actions=openJotpad
X-KDE-Priority=TopLevel

[Desktop Action openJotpad]
Name={label}
Name[zh_CN]=使用 Jotpad 打开
Icon=jotpad
Exec="{exe}" %f
"#
        );
        fs::write(ddir.join("jotpad-open-text.desktop"), svc).map_err(|e| e.to_string())?;

        let _ = std::process::Command::new("update-desktop-database")
            .arg(&dir)
            .status();
        // Register as an available handler only — do not change the user default.
        Ok(())
    }

    pub fn uninstall_open_with() -> Result<(), String> {
        if let Ok(dir) = applications_dir() {
            let _ = fs::remove_file(dir.join("jotpad-open-text.desktop"));
            let _ = std::process::Command::new("update-desktop-database")
                .arg(&dir)
                .status();
        }
        if let Ok(dir) = dolphin_servicemenus() {
            let _ = fs::remove_file(dir.join("jotpad-open-text.desktop"));
        }
        Ok(())
    }

    fn set_executable(path: &Path) -> Result<(), String> {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(path, perms).map_err(|e| e.to_string())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    #[test]
    fn macos_install_enables_context_menu() {
        macos::install_new_text_workflow().expect("install new");
        macos::install_open_with_workflow().expect("install open");

        let services = services_dir().unwrap();
        assert!(services.join(NEW_SERVICE_NAME).exists());
        assert!(services.join(OPEN_SERVICE_NAME).exists());
        assert!(
            macos::is_service_context_menu_enabled(NEW_MENU),
            "new-text ContextMenu should be enabled in NSServicesStatus"
        );
        assert!(
            macos::is_service_context_menu_enabled(OPEN_MENU),
            "open-with ContextMenu should be enabled in NSServicesStatus"
        );

        macos::uninstall_workflow(NEW_SERVICE_NAME, NEW_MENU).expect("uninstall new");
        macos::uninstall_workflow(OPEN_SERVICE_NAME, OPEN_MENU).expect("uninstall open");
        assert!(!macos::is_service_context_menu_enabled(NEW_MENU));
        assert!(!macos::is_service_context_menu_enabled(OPEN_MENU));
    }
}
