//! 本地历史：内容寻址快照（学 Git blob，不嵌 Git）。
//! 目录：`{app_data}/history/blobs/{hh}/{hash}` + `history/files/{pathKey}.json`

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const DEFAULT_MAX_ENTRIES: usize = 50;
const DEFAULT_MAX_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_MERGE_MS: u64 = 15_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub content_hash: String,
    pub created_at: u64,
    pub source: String,
    pub byte_len: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct FileHistory {
    path: String,
    entries: Vec<HistoryEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub tag: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResult {
    pub entry: Option<HistoryEntry>,
    pub skipped: bool,
    pub reason: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn history_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = crate::data_dir(app)?.join("history");
    fs::create_dir_all(dir.join("blobs")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("files")).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn normalize_path(path: &str) -> String {
    let p = path.trim_start_matches("file://");
    // 尽量规范绝对路径，失败则用原始字符串（仍可稳定哈希）
    fs::canonicalize(p)
        .map(|x| x.to_string_lossy().into_owned())
        .unwrap_or_else(|_| p.to_string())
}

fn path_key(abs_path: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(abs_path.as_bytes());
    hex::encode(hasher.finalize())
}

fn content_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    hex::encode(hasher.finalize())
}

/// 快照统一存 LF，避免 CRLF/LF 造成无意义去重失败。
fn normalize_text_lf(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn blob_path(root: &Path, hash: &str) -> PathBuf {
    let prefix = hash.get(..2).unwrap_or("00");
    root.join("blobs").join(prefix).join(hash)
}

fn file_index_path(root: &Path, key: &str) -> PathBuf {
    root.join("files").join(format!("{key}.json"))
}

fn read_file_history(path: &Path) -> Result<FileHistory, String> {
    if !path.exists() {
        return Ok(FileHistory {
            path: String::new(),
            entries: vec![],
        });
    }
    let s = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&s).map_err(|e| e.to_string())
}

fn write_file_history(path: &Path, hist: &FileHistory) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let s = serde_json::to_string_pretty(hist).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, s).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(())
}

fn write_blob(root: &Path, hash: &str, text: &str) -> Result<(), String> {
    let path = blob_path(root, hash);
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })?;
    Ok(())
}

fn read_blob(root: &Path, hash: &str) -> Result<String, String> {
    let path = blob_path(root, hash);
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// 删除文件历史时顺便回收不再被任何 index 引用的 blob（简单全扫）。
fn gc_orphaned_blobs(root: &Path) -> Result<(), String> {
    let files_dir = root.join("files");
    let mut live = std::collections::HashSet::new();
    if files_dir.is_dir() {
        for ent in fs::read_dir(&files_dir).map_err(|e| e.to_string())? {
            let ent = ent.map_err(|e| e.to_string())?;
            let p = ent.path();
            if p.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(h) = read_file_history(&p) {
                for e in h.entries {
                    live.insert(e.content_hash);
                }
            }
        }
    }
    let blobs_dir = root.join("blobs");
    if !blobs_dir.is_dir() {
        return Ok(());
    }
    for prefix in fs::read_dir(&blobs_dir).map_err(|e| e.to_string())? {
        let prefix = prefix.map_err(|e| e.to_string())?;
        let prefix_path = prefix.path();
        if !prefix_path.is_dir() {
            continue;
        }
        for blob in fs::read_dir(&prefix_path).map_err(|e| e.to_string())? {
            let blob = blob.map_err(|e| e.to_string())?;
            let bp = blob.path();
            let name = bp
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() || name.ends_with(".tmp") {
                continue;
            }
            if !live.contains(&name) {
                let _ = fs::remove_file(&bp);
            }
        }
    }
    Ok(())
}

fn prune_entries(entries: &mut Vec<HistoryEntry>, max_entries: usize) -> Vec<String> {
    let mut dropped_hashes = Vec::new();
    while entries.len() > max_entries {
        if let Some(old) = entries.pop() {
            dropped_hashes.push(old.content_hash);
        }
    }
    dropped_hashes
}

/// 写入快照；同内容跳过；合并窗口内替换最近一条。
pub fn put_snapshot(
    app: &AppHandle,
    file_path: &str,
    text: &str,
    source: &str,
    max_entries: Option<usize>,
    max_bytes: Option<u64>,
    merge_ms: Option<u64>,
) -> Result<SnapshotResult, String> {
    let max_entries = max_entries.unwrap_or(DEFAULT_MAX_ENTRIES).max(1);
    let max_bytes = max_bytes.unwrap_or(DEFAULT_MAX_BYTES);
    let merge_ms = merge_ms.unwrap_or(DEFAULT_MERGE_MS);

    let text = normalize_text_lf(text);
    let byte_len = text.len() as u64;
    if byte_len > max_bytes {
        return Ok(SnapshotResult {
            entry: None,
            skipped: true,
            reason: Some("too_large".into()),
        });
    }

    let abs = normalize_path(file_path);
    let key = path_key(&abs);
    let hash = content_hash(&text);
    let root = history_root(app)?;
    let index_path = file_index_path(&root, &key);

    let mut hist = read_file_history(&index_path)?;
    hist.path = abs.clone();

    // 与最新一条内容相同：不新增
    if let Some(latest) = hist.entries.first() {
        if latest.content_hash == hash {
            return Ok(SnapshotResult {
                entry: Some(latest.clone()),
                skipped: true,
                reason: Some("unchanged".into()),
            });
        }
    }

    write_blob(&root, &hash, &text)?;

    let now = now_ms();
    let entry = HistoryEntry {
        id: format!("{now}_{}", &hash[..8.min(hash.len())]),
        content_hash: hash.clone(),
        created_at: now,
        source: source.to_string(),
        byte_len,
    };

    // 合并窗口：替换最近一条（仍保留旧 blob，后续 gc）
    if let Some(latest) = hist.entries.first_mut() {
        if now.saturating_sub(latest.created_at) <= merge_ms {
            *latest = entry.clone();
            write_file_history(&index_path, &hist)?;
            let _ = gc_orphaned_blobs(&root);
            return Ok(SnapshotResult {
                entry: Some(entry),
                skipped: false,
                reason: Some("merged".into()),
            });
        }
    }

    hist.entries.insert(0, entry.clone());
    prune_entries(&mut hist.entries, max_entries);
    write_file_history(&index_path, &hist)?;
    let _ = gc_orphaned_blobs(&root);

    Ok(SnapshotResult {
        entry: Some(entry),
        skipped: false,
        reason: None,
    })
}

pub fn list_entries(app: &AppHandle, file_path: &str) -> Result<Vec<HistoryEntry>, String> {
    let abs = normalize_path(file_path);
    let key = path_key(&abs);
    let root = history_root(app)?;
    let hist = read_file_history(&file_index_path(&root, &key))?;
    Ok(hist.entries)
}

pub fn get_content(app: &AppHandle, content_hash: &str) -> Result<String, String> {
    let root = history_root(app)?;
    read_blob(&root, content_hash)
}

pub fn delete_entry(app: &AppHandle, file_path: &str, entry_id: &str) -> Result<(), String> {
    let abs = normalize_path(file_path);
    let key = path_key(&abs);
    let root = history_root(app)?;
    let index_path = file_index_path(&root, &key);
    let mut hist = read_file_history(&index_path)?;
    let before = hist.entries.len();
    hist.entries.retain(|e| e.id != entry_id);
    if hist.entries.len() == before {
        return Err("entry not found".into());
    }
    if hist.entries.is_empty() {
        let _ = fs::remove_file(&index_path);
    } else {
        write_file_history(&index_path, &hist)?;
    }
    let _ = gc_orphaned_blobs(&root);
    Ok(())
}

pub fn clear_file(app: &AppHandle, file_path: &str) -> Result<(), String> {
    let abs = normalize_path(file_path);
    let key = path_key(&abs);
    let root = history_root(app)?;
    let index_path = file_index_path(&root, &key);
    let _ = fs::remove_file(&index_path);
    let _ = gc_orphaned_blobs(&root);
    Ok(())
}

pub fn diff_texts(left: &str, right: &str) -> Vec<DiffHunk> {
    use similar::{ChangeTag, TextDiff};
    let diff = TextDiff::from_lines(left, right);
    let mut out = Vec::new();
    for change in diff.iter_all_changes() {
        let tag = match change.tag() {
            ChangeTag::Equal => "equal",
            ChangeTag::Delete => "delete",
            ChangeTag::Insert => "insert",
        };
        out.push(DiffHunk {
            tag: tag.into(),
            text: change.to_string(),
        });
    }
    out
}

// ---------- Tauri commands ----------

#[tauri::command]
pub fn history_put(
    app: AppHandle,
    path: String,
    text: String,
    source: String,
    max_entries: Option<usize>,
    max_bytes: Option<u64>,
    merge_ms: Option<u64>,
) -> Result<SnapshotResult, String> {
    put_snapshot(
        &app,
        &path,
        &text,
        &source,
        max_entries,
        max_bytes,
        merge_ms,
    )
}

#[tauri::command]
pub fn history_list(app: AppHandle, path: String) -> Result<Vec<HistoryEntry>, String> {
    list_entries(&app, &path)
}

#[tauri::command]
pub fn history_get(app: AppHandle, content_hash: String) -> Result<String, String> {
    get_content(&app, &content_hash)
}

#[tauri::command]
pub fn history_delete_entry(
    app: AppHandle,
    path: String,
    entry_id: String,
) -> Result<(), String> {
    delete_entry(&app, &path, &entry_id)
}

#[tauri::command]
pub fn history_clear(app: AppHandle, path: String) -> Result<(), String> {
    clear_file(&app, &path)
}

#[tauri::command]
pub fn history_diff(left: String, right: String) -> Result<Vec<DiffHunk>, String> {
    Ok(diff_texts(&left, &right))
}
