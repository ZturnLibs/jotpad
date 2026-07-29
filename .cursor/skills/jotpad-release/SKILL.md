---
name: jotpad-release
description: >-
  Bumps Jotpad version, commits, tags v*, and pushes to trigger the GitHub
  Actions Tauri release. Use when the user asks to 发布版本, release, ship,
  cut a release, bump version, or push a v* tag for jotpad/mactxt.
---

# Jotpad 发布

仓库：`ZturnLibs/jotpad`。推送 `v*` tag → `.github/workflows/release.yml` 构建多平台包并写 GitHub Release（含 updater `latest.json`）。

**仅在用户明确要求发布时执行**；不要主动发版。

## 前置检查

1. `git status`：工作区干净，或仅含本次要发布的已确认改动。
2. 在 `main` 且与 `origin/main` 同步（或先推送待发布 commit）。
3. `git tag -l 'v*'` / `gh release list`：确认下一版本未占用。
4. 可选冒烟：`pnpm test`；需要时再 `pnpm build`。

## 版本号

三处 + lock 必须一致（semver，通常 patch +1）：

| 文件 | 字段 |
| --- | --- |
| `package.json` | `"version"` |
| `src-tauri/Cargo.toml` | `version` |
| `src-tauri/tauri.conf.json` | `"version"` |
| `src-tauri/Cargo.lock` | `name = "jotpad"` 下的 `version`（改 Cargo.toml 后跑 `cargo check` 刷新） |

示例：`0.1.2` → `0.1.3`；tag 为 `v0.1.3`（带 `v` 前缀）。

## 发版步骤

1. **改版本**（上表四处）。
2. **提交**（仅版本文件）：

```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -m "$(cat <<'EOF'
发布 vX.Y.Z

同步版本号以发布含 <一句话变更摘要> 的安装包。
EOF
)"
```

3. **打 tag 并推送**：

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

4. **确认 CI**：

```bash
gh run list --workflow=release.yml --limit 3
# 期望：vX.Y.Z 为 in_progress / queued
```

完成后 Release：`https://github.com/ZturnLibs/jotpad/releases/tag/vX.Y.Z`  
Actions：`gh run watch` 或打开对应 run URL。

## 回复用户

简短给出：新版本号、tag、workflow run 链接、预计约 8–15 分钟、Release 链接（构建完才有资产）。

## 约定与坑

- **鉴权**：组织禁用默认 `GITHUB_TOKEN` 写权限 → Secret `RELEASE_TOKEN`（repo 写）。签名：`TAURI_SIGNING_PRIVATE_KEY`（+ 可选 password）。私钥备份 `~/.tauri/jotpad.key`，丢失则已装客户端无法验签升级。
- **Updater**：endpoint 为 `.../releases/latest/download/latest.json`；需 Release 上的 `latest.json` 与 `.sig`。
- **Linux**：应用内更新仅 **AppImage**；`.deb` 需手动装。
- **不要** `--force` 推 tag；已发布 tag 勿改写，应发下一版本。
- **不要** 在未要求时 `gh release edit` 大改说明；workflow 已带默认 release body。
- 也可 `gh workflow run release.yml` 手动跑，但仍须版本号与 tag 一致，优先走 push tag。

## 发布前功能清单（用户未要求可跳过）

详见 `README.md`「发布前检查清单」：打开/保存、外部变更重载、未保存确认、各平台窗口/菜单冒烟。
