//! 语音速记：按需下载 SenseVoice 语音包 + 本地离线转写。
//! 安装包不内置模型；就绪判定以 manifest + 可执行文件 + 模型文件为准。

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

const PACK_VERSION: &str = "1";
const ENGINE_ID: &str = "sensevoice-int8-2024-07-17";
const RUNTIME_VERSION: &str = "1.12.15";

const MODEL_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2";
const MODEL_DIR_NAME: &str = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17";

/// 下载进行中 / 取消请求（设置页与引导对话框共用）。
pub struct VoiceDownloadFlag {
    pub downloading: Arc<AtomicBool>,
    pub cancel: Arc<AtomicBool>,
}

impl Default for VoiceDownloadFlag {
    fn default() -> Self {
        Self {
            downloading: Arc::new(AtomicBool::new(false)),
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoicePackStatus {
    pub state: String, // missing | downloading | ready | error
    pub version: Option<String>,
    pub engine: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
    pub received: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    version: String,
    engine: String,
    runtime_version: String,
    bin: String,
    model: String,
    tokens: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressPayload {
    phase: String,
    received: u64,
    total: u64,
}

fn voice_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::data_dir(app)?.join("voice");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn pack_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(voice_root(app)?.join("pack"))
}

fn manifest_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(pack_dir(app)?.join("manifest.json"))
}

fn staging_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(voice_root(app)?.join("staging"))
}

fn runtime_url() -> Result<&'static str, String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let url = match (os, arch) {
        ("macos", _) => {
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.15/sherpa-onnx-v1.12.15-osx-universal2-static-no-tts.tar.bz2"
        }
        ("linux", "x86_64") => {
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.15/sherpa-onnx-v1.12.15-linux-x64-static-no-tts.tar.bz2"
        }
        ("linux", "aarch64") => {
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.15/sherpa-onnx-v1.12.15-linux-aarch64-static.tar.bz2"
        }
        ("windows", "x86_64") => {
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.15/sherpa-onnx-v1.12.15-win-x64-static.tar.bz2"
        }
        _ => {
            return Err(format!(
                "unsupported platform for voice pack: {os}/{arch}"
            ))
        }
    };
    Ok(url)
}

fn read_manifest(app: &AppHandle) -> Option<Manifest> {
    let path = manifest_path(app).ok()?;
    let s = fs::read_to_string(path).ok()?;
    serde_json::from_str(&s).ok()
}

fn pack_is_ready(app: &AppHandle) -> Option<(Manifest, PathBuf)> {
    let root = pack_dir(app).ok()?;
    let m = read_manifest(app)?;
    let bin = root.join(&m.bin);
    let model = root.join(&m.model);
    let tokens = root.join(&m.tokens);
    if bin.is_file() && model.is_file() && tokens.is_file() {
        Some((m, root))
    } else {
        None
    }
}

fn emit_progress(app: &AppHandle, phase: &str, received: u64, total: u64) {
    let _ = app.emit(
        "voice-pack-progress",
        ProgressPayload {
            phase: phase.into(),
            received,
            total,
        },
    );
}

async fn download_file(
    app: &AppHandle,
    url: &str,
    dest: &Path,
    phase: &str,
    cancel: &AtomicBool,
) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let total = resp.content_length().unwrap_or(0);
    let mut stream = resp.bytes_stream();
    let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    emit_progress(app, phase, 0, total);
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            let _ = fs::remove_file(dest);
            return Err("cancelled".into());
        }
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        emit_progress(app, phase, received, total);
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(())
}

fn extract_bz2_tar(archive: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    let decoder = bzip2::read::BzDecoder::new(file);
    let mut tar = tar::Archive::new(decoder);
    tar.unpack(dest).map_err(|e| e.to_string())?;
    Ok(())
}

fn find_file_named(root: &Path, name: &str) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).ok()?;
        for ent in entries.flatten() {
            let path = ent.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.file_name().and_then(|s| s.to_str()) == Some(name) {
                return Some(path);
            }
        }
    }
    None
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(path).map_err(|e| e.to_string())?.permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms).map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn install_from_staging(app: &AppHandle, staging: &Path) -> Result<(), String> {
    let pack = pack_dir(app)?;
    // 原子替换：先写到 pack.tmp，再 rename
    let tmp = voice_root(app)?.join("pack.tmp");
    if tmp.exists() {
        fs::remove_dir_all(&tmp).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;

    let model_src = staging
        .join("model_extract")
        .join(MODEL_DIR_NAME);
    let model_onnx = model_src.join("model.int8.onnx");
    let tokens = model_src.join("tokens.txt");
    if !model_onnx.is_file() || !tokens.is_file() {
        return Err("model files missing after extract".into());
    }

    let model_dest = tmp.join("model");
    fs::create_dir_all(&model_dest).map_err(|e| e.to_string())?;
    fs::copy(&model_onnx, model_dest.join("model.int8.onnx")).map_err(|e| e.to_string())?;
    fs::copy(&tokens, model_dest.join("tokens.txt")).map_err(|e| e.to_string())?;

    let runtime_root = staging.join("runtime_extract");
    let bin_name = if cfg!(windows) {
        "sherpa-onnx-offline.exe"
    } else {
        "sherpa-onnx-offline"
    };
    let bin_src =
        find_file_named(&runtime_root, bin_name).ok_or_else(|| format!("{bin_name} not found"))?;
    let bin_dest_dir = tmp.join("bin");
    fs::create_dir_all(&bin_dest_dir).map_err(|e| e.to_string())?;
    let bin_dest = bin_dest_dir.join(bin_name);
    fs::copy(&bin_src, &bin_dest).map_err(|e| e.to_string())?;
    make_executable(&bin_dest)?;

    let manifest = Manifest {
        version: PACK_VERSION.into(),
        engine: ENGINE_ID.into(),
        runtime_version: RUNTIME_VERSION.into(),
        bin: format!("bin/{bin_name}"),
        model: "model/model.int8.onnx".into(),
        tokens: "model/tokens.txt".into(),
    };
    let man_s = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    fs::write(tmp.join("manifest.json"), man_s).map_err(|e| e.to_string())?;

    if pack.exists() {
        fs::remove_dir_all(&pack).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &pack).map_err(|e| e.to_string())?;
    Ok(())
}

fn strip_sense_voice_tags(raw: &str) -> String {
    let mut out = String::new();
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '<' && chars.peek() == Some(&'|') {
            while let Some(x) = chars.next() {
                if x == '>' {
                    break;
                }
            }
            continue;
        }
        out.push(c);
    }
    out.trim().to_string()
}

fn is_effectively_empty_transcript(text: &str) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return true;
    }
    // 仅标点/省略号，视为无有效正文
    t.chars().all(|c| {
        c.is_whitespace()
            || matches!(c, '.' | '。' | '…' | ',' | '，' | '?' | '？' | '!' | '！' | ';' | '；' | ':' | '：')
    })
}

struct ParsedTranscript {
    text: String,
    no_speech: bool,
}

fn parse_transcript(combined: &str) -> ParsedTranscript {
    // sherpa 常把 JSON 打到 stderr；调用方应传入 stdout+stderr 合并文本
    let mut raw = String::new();
    let mut no_speech = false;

    for line in combined.lines().rev() {
        let trimmed = line.trim();
        // JSON 可能夹在同一行其它日志后面，尝试截取第一个 `{...}`
        if let Some(start) = trimmed.find('{') {
            if let Some(end) = trimmed.rfind('}') {
                if end > start {
                    let slice = &trimmed[start..=end];
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(slice) {
                        if let Some(lang) = v.get("lang").and_then(|x| x.as_str()) {
                            if lang.contains("nospeech") {
                                no_speech = true;
                            }
                        }
                        if let Some(t) = v.get("text").and_then(|x| x.as_str()) {
                            raw = t.trim().to_string();
                            break;
                        }
                    }
                }
            }
        }
        if let Some(rest) = trimmed.strip_prefix("text:") {
            raw = rest.trim().to_string();
            break;
        }
    }

    if raw.is_empty() {
        raw = combined
            .lines()
            .map(str::trim)
            .filter(|l| {
                !l.is_empty()
                    && !l.starts_with('{')
                    && !l.contains("ms")
                    && !l.contains('/')
                    && !l.contains("OfflineRecognizerConfig")
                    && !l.contains("Creating recognizer")
                    && !l.contains("Started")
                    && !l.contains("Done!")
                    && !l.contains("Elapsed")
                    && !l.contains("num threads")
            })
            .last()
            .unwrap_or("")
            .to_string();
    }

    let text = strip_sense_voice_tags(&raw);
    if combined.contains("<|nospeech|>") {
        no_speech = true;
    }
    ParsedTranscript { text, no_speech }
}

#[tauri::command]
pub fn voice_pack_status(app: AppHandle, flag: State<'_, VoiceDownloadFlag>) -> VoicePackStatus {
    if flag.downloading.load(Ordering::SeqCst) {
        // 下载过程中前端主要靠 progress 事件；这里仍返回 downloading
        return VoicePackStatus {
            state: "downloading".into(),
            version: None,
            engine: Some(ENGINE_ID.into()),
            path: pack_dir(&app).ok().map(|p| p.to_string_lossy().into()),
            error: None,
            received: 0,
            total: 0,
        };
    }
    if let Some((m, root)) = pack_is_ready(&app) {
        VoicePackStatus {
            state: "ready".into(),
            version: Some(m.version),
            engine: Some(m.engine),
            path: Some(root.to_string_lossy().into()),
            error: None,
            received: 0,
            total: 0,
        }
    } else {
        VoicePackStatus {
            state: "missing".into(),
            version: None,
            engine: Some(ENGINE_ID.into()),
            path: pack_dir(&app).ok().map(|p| p.to_string_lossy().into()),
            error: None,
            received: 0,
            total: 0,
        }
    }
}

#[tauri::command]
pub async fn voice_pack_download(
    app: AppHandle,
    flag: State<'_, VoiceDownloadFlag>,
) -> Result<VoicePackStatus, String> {
    if pack_is_ready(&app).is_some() {
        return Ok(voice_pack_status(app, flag));
    }
    if flag
        .downloading
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("download already in progress".into());
    }
    flag.cancel.store(false, Ordering::SeqCst);
    let cancel = flag.cancel.clone();
    let downloading = flag.downloading.clone();
    let result = async {
        let staging = staging_dir(&app)?;
        if staging.exists() {
            fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

        let model_archive = staging.join("model.tar.bz2");
        download_file(&app, MODEL_URL, &model_archive, "model", &cancel).await?;
        let model_extract = staging.join("model_extract");
        extract_bz2_tar(&model_archive, &model_extract)?;
        let _ = fs::remove_file(&model_archive);

        let rt_url = runtime_url()?;
        let rt_archive = staging.join("runtime.tar.bz2");
        download_file(&app, rt_url, &rt_archive, "runtime", &cancel).await?;
        let rt_extract = staging.join("runtime_extract");
        extract_bz2_tar(&rt_archive, &rt_extract)?;
        let _ = fs::remove_file(&rt_archive);

        emit_progress(&app, "install", 0, 1);
        install_from_staging(&app, &staging)?;
        emit_progress(&app, "install", 1, 1);

        let _ = fs::remove_dir_all(&staging);
        Ok::<(), String>(())
    }
    .await;

    downloading.store(false, Ordering::SeqCst);
    cancel.store(false, Ordering::SeqCst);

    match result {
        Ok(()) => Ok(VoicePackStatus {
            state: "ready".into(),
            version: Some(PACK_VERSION.into()),
            engine: Some(ENGINE_ID.into()),
            path: pack_dir(&app).ok().map(|p| p.to_string_lossy().into()),
            error: None,
            received: 0,
            total: 0,
        }),
        Err(e) => {
            let _ = fs::remove_dir_all(staging_dir(&app).unwrap_or_default());
            Err(e)
        }
    }
}

#[tauri::command]
pub fn voice_pack_cancel_download(flag: State<'_, VoiceDownloadFlag>) -> Result<(), String> {
    flag.cancel.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn voice_pack_delete(app: AppHandle) -> Result<(), String> {
    let pack = pack_dir(&app)?;
    if pack.exists() {
        fs::remove_dir_all(&pack).map_err(|e| e.to_string())?;
    }
    let staging = staging_dir(&app)?;
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    Ok(())
}

#[tauri::command]
pub fn write_bytes(path: String, contents_b64: String) -> Result<(), String> {
    use base64::Engine;
    let path = path.trim_start_matches("file://");
    let contents = base64::engine::general_purpose::STANDARD
        .decode(contents_b64.trim())
        .map_err(|e| e.to_string())?;
    let p = Path::new(path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("jottmp");
    fs::write(&tmp, &contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(())
}

#[tauri::command]
pub async fn voice_transcribe(app: AppHandle, wav_b64: String) -> Result<String, String> {
    use base64::Engine;
    let wav_bytes = base64::engine::general_purpose::STANDARD
        .decode(wav_b64.trim())
        .map_err(|e| e.to_string())?;
    let (manifest, root) = pack_is_ready(&app).ok_or_else(|| {
        crate::app_log::warn("voice", "transcribe skipped: voice pack not ready");
        "voice:pack_missing".to_string()
    })?;
    let bin = root.join(&manifest.bin);
    let model = root.join(&manifest.model);
    let tokens = root.join(&manifest.tokens);

    let tmp_dir = voice_root(&app)?.join("tmp");
    fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let wav_path = tmp_dir.join(format!("rec-{}.wav", std::process::id()));
    fs::write(&wav_path, &wav_bytes).map_err(|e| e.to_string())?;

    let bin_c = bin.clone();
    let model_c = model.clone();
    let tokens_c = tokens.clone();
    let wav_c = wav_path.clone();

    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new(&bin_c)
            .arg(format!("--tokens={}", tokens_c.display()))
            .arg(format!("--sense-voice-model={}", model_c.display()))
            .arg("--num-threads=2")
            .arg("--sense-voice-use-itn=true")
            .arg("--debug=0")
            .arg(wav_c.as_os_str())
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let _ = fs::remove_file(&wav_path);

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    if !output.status.success() {
        crate::app_log::error(
            "voice",
            format!("transcribe process failed; stdout={stdout} stderr={stderr}"),
        );
        return Err("voice:engine".into());
    }

    // sherpa-onnx-offline 常把结果 JSON 写到 stderr
    let combined = if stdout.is_empty() {
        stderr.clone()
    } else if stderr.is_empty() {
        stdout.clone()
    } else {
        format!("{stdout}\n{stderr}")
    };
    let parsed = parse_transcript(&combined);

    if parsed.no_speech || is_effectively_empty_transcript(&parsed.text) {
        crate::app_log::info(
            "voice",
            format!("no speech / empty transcript; text={:?}", parsed.text),
        );
        return Err("voice:nospeech".into());
    }

    crate::app_log::info(
        "voice",
        format!("transcribe ok; chars={}", parsed.text.chars().count()),
    );
    Ok(parsed.text)
}
