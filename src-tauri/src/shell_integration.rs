//! System shell integration: Finder/Explorer context menus + file open handling.
//!
//! - 「新建文本文件」: Finder Quick Action / Explorer context menu / Nautilus script
//! - 「使用 Jotpad 打开」: Open-with handler + context menu item

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

const BUNDLE_ID: &str = "com.jotpad.app";
const NEW_SERVICE_NAME: &str = "Jotpad 新建文本文件.workflow";
const OPEN_SERVICE_NAME: &str = "使用 Jotpad 打开.workflow";
const MARKER_DIR: &str = "shell-integration";

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

fn set_marker(app: &AppHandle, name: &str, enabled: bool) -> Result<(), String> {
    let path = marker_path(app, name)?;
    if enabled {
        fs::write(&path, b"1").map_err(|e| e.to_string())
    } else {
        let _ = fs::remove_file(&path);
        Ok(())
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
    let candidates = [
        "未命名.txt",
        "untitled.txt",
        "New Text File.txt",
    ];
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
    set_marker(&app, "new-text-file", enabled)?;
    Ok(())
}

#[tauri::command]
pub fn set_shell_open_with(app: AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        install_open_with(&app)?;
    } else {
        uninstall_open_with(&app)?;
    }
    set_marker(&app, "open-with", enabled)?;
    Ok(())
}

fn is_new_text_file_enabled(app: &AppHandle) -> bool {
    let _ = app;
    #[cfg(target_os = "macos")]
    {
        services_dir()
            .map(|d| d.join(NEW_SERVICE_NAME).exists())
            .unwrap_or(false)
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
        macos::uninstall_workflow(NEW_SERVICE_NAME)
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
        macos::install_open_with_workflow()?;
        macos::set_default_text_handler(true)
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
        macos::uninstall_workflow(OPEN_SERVICE_NAME)
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
            "新建文本文件",
            &["public.folder", "public.directory"],
            script,
            "com.apple.Automator.fileSystemObject.folder",
        )?;
        refresh_services();
        Ok(())
    }

    pub fn install_open_with_workflow() -> Result<(), String> {
        let launch = app_launch_path();
        let launch_q = shell_single_quote(&path_to_string(&launch));
        let script = format!(
            r#"app={launch_q}
for item in "$@"; do
  [ -e "$item" ] || continue
  if [ -d "$app" ] && [[ "$app" == *.app ]]; then
    /usr/bin/open -a "$app" "$item"
  else
    "$app" "$item" &
  fi
done
"#
        );
        write_workflow(
            OPEN_SERVICE_NAME,
            "使用 Jotpad 打开",
            &[
                "public.plain-text",
                "public.text",
                "public.source-code",
                "public.data",
            ],
            &script,
            "com.apple.Automator.fileSystemObject",
        )?;
        // Register with Launch Services when we have a .app bundle.
        if launch.extension().and_then(|e| e.to_str()) == Some("app") {
            let _ = Command::new("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
                .args(["-f", &path_to_string(&launch)])
                .status();
        }
        refresh_services();
        Ok(())
    }

    pub fn uninstall_workflow(name: &str) -> Result<(), String> {
        if let Ok(dir) = services_dir() {
            let path = dir.join(name);
            if path.exists() {
                fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
            }
        }
        refresh_services();
        Ok(())
    }

    pub fn set_default_text_handler(enable: bool) -> Result<(), String> {
        if !enable {
            // Leaving the previous default alone avoids clobbering the user's choice
            // (e.g. VS Code / TextEdit) when the toggle is turned off.
            return Ok(());
        }
        let handler = BUNDLE_ID;
        // JXA → CoreServices LSSetDefaultRoleHandlerForContentType
        let types = ["public.plain-text", "public.text", "public.utf8-plain-text"];
        for ty in types {
            let script = format!(
                r#"ObjC.import('CoreServices');
ObjC.import('CoreFoundation');
var status = $.LSSetDefaultRoleHandlerForContentType('{ty}', $.kLSRolesAll, '{handler}');
if (status !== 0) {{ throw new Error('LSSetDefaultRoleHandlerForContentType failed: ' + status); }}"#
            );
            let status = Command::new("/usr/bin/osascript")
                .args(["-l", "JavaScript", "-e", &script])
                .status()
                .map_err(|e| e.to_string())?;
            if !status.success() {
                // Non-fatal in dev (unsigned / no bundle registration yet).
                eprintln!("[shell] set default handler for {ty} failed (status {status})");
            }
        }
        Ok(())
    }

    fn write_workflow(
        name: &str,
        menu: &str,
        file_types: &[&str],
        command: &str,
        input_type: &str,
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
	<key>CFBundleIdentifier</key>
	<string>{bundle}.service.{menu_id}</string>
	<key>CFBundleName</key>
	<string>{menu}</string>
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
            menu_id = menu.replace(' ', "-"),
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
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>UUID</key>
				<string>9918289D-6238-44AE-8588-EFEC8A48B0D0</string>
			</dict>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>serviceApplicationBundleID</key>
		<string>com.apple.finder</string>
		<key>serviceInputTypeIdentifier</key>
		<string>{input_type}</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<true/>
		<key>systemImageName</key>
		<string>NSTouchBarAdd</string>
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
        // Soft refresh; ignore failures on newer macOS where pbs may be gone.
        let _ = Command::new("killall").args(["-KILL", "pbs"]).status();
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
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        for key_path in [NEW_KEY, NEW_DIR_KEY] {
            let (key, _) = hkcu.create_subkey(key_path).map_err(|e| e.to_string())?;
            key.set_value("", &"新建文本文件").map_err(|e| e.to_string())?;
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
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let (prog, _) = hkcu.create_subkey(PROGID).map_err(|e| e.to_string())?;
        prog.set_value("", &"Jotpad Text Document")
            .map_err(|e| e.to_string())?;
        let (cmd, _) = prog
            .create_subkey(r"shell\open\command")
            .map_err(|e| e.to_string())?;
        cmd.set_value("", &format!("\"{exe}\" \"%1\""))
            .map_err(|e| e.to_string())?;

        let (ow, _) = hkcu.create_subkey(PROGID_OPENWITH).map_err(|e| e.to_string())?;
        ow.set_value("Jotpad.txt", &"").map_err(|e| e.to_string())?;

        for key_path in [OPEN_KEY, OPEN_TXT] {
            let (key, _) = hkcu.create_subkey(key_path).map_err(|e| e.to_string())?;
            key.set_value("", &"使用 Jotpad 打开")
                .map_err(|e| e.to_string())?;
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

    fn applications_dir() -> Result<PathBuf, String> {
        Ok(home()?.join(".local/share/applications"))
    }

    pub fn new_text_installed() -> bool {
        nautilus_scripts()
            .map(|d| d.join("新建文本文件").exists())
            .unwrap_or(false)
    }

    pub fn open_with_installed() -> bool {
        applications_dir()
            .map(|d| d.join("jotpad-open-text.desktop").exists())
            .unwrap_or(false)
    }

    pub fn install_new_text(app: &AppHandle) -> Result<(), String> {
        let _ = app;
        let exe = path_to_string(&app_launch_path());
        let dir = nautilus_scripts()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let script = format!(
            "#!/bin/bash\nDIR=\"${{1:-$(pwd)}}\"\nexec \"{exe}\" --new-in \"$DIR\"\n"
        );
        let path = dir.join("新建文本文件");
        fs::write(&path, script).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&path, perms).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn uninstall_new_text() -> Result<(), String> {
        if let Ok(dir) = nautilus_scripts() {
            let _ = fs::remove_file(dir.join("新建文本文件"));
        }
        Ok(())
    }

    pub fn install_open_with(app: &AppHandle) -> Result<(), String> {
        let _ = app;
        let exe = path_to_string(&app_launch_path());
        let dir = applications_dir()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let desktop = format!(
            "[Desktop Entry]\nType=Application\nName=Jotpad\nComment=Open text files with Jotpad\nExec=\"{exe}\" %F\nIcon=jotpad\nMimeType=text/plain;text/markdown;text/x-log;\nNoDisplay=false\nStartupNotify=true\n"
        );
        fs::write(dir.join("jotpad-open-text.desktop"), desktop).map_err(|e| e.to_string())?;
        let _ = std::process::Command::new("update-desktop-database")
            .arg(&dir)
            .status();
        let _ = std::process::Command::new("xdg-mime")
            .args(["default", "jotpad-open-text.desktop", "text/plain"])
            .status();
        Ok(())
    }

    pub fn uninstall_open_with() -> Result<(), String> {
        if let Ok(dir) = applications_dir() {
            let _ = fs::remove_file(dir.join("jotpad-open-text.desktop"));
            let _ = std::process::Command::new("update-desktop-database")
                .arg(&dir)
                .status();
        }
        Ok(())
    }
}
