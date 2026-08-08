---
name: jotpad-release
description: >-
  Release a new Jotpad version (repo ZturnLibs/jotpad, dir mactxt). Bumps the
  4 version files, commits "发布 vX.Y.Z", tags v*, and pushes to trigger the
  GitHub Actions Tauri build + GitHub Release. Use when the user asks to
  发布版本 / 发版 / release / ship / cut a release / bump version for Jotpad.
---

# Jotpad 发布

仓库 `ZturnLibs/jotpad`。推送 `v*` tag → `.github/workflows/release.yml` 构建多平台安装包并写 GitHub Release（含 updater `latest.json`）。

## 一键发布

```bash
pnpm release                  # 默认 patch +1
pnpm release minor            # minor bump
pnpm release major
pnpm release 1.2.0            # 指定具体版本
pnpm release patch "多光标"   # 附变更摘要（写进 commit message）
```

`scripts/release.mjs` 会依次：检查工作区干净 + 在 `main` + tag 未占用 → 改四处版本号（`package.json` / `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` / `src-tauri/tauri.conf.json`）→ `cargo check` 刷新 lock → `git commit "发布 vX.Y.Z"` → `git tag vX.Y.Z` → `git push origin main` + tag → `gh run list` 确认 CI 已触发。任一步失败即中止。

## 前置（脚本内置检查）

- 在 `main` 且工作区干净（待发布的改动需先 commit）。
- 目标 tag `vX.Y.Z` 未占用（`git tag -l 'v*'`）。
- 已认证 `gh`、可用 `cargo`。

## 发版后

- CI 约 **8–15 分钟**。
- 监控：`gh run watch` 或 https://github.com/ZturnLibs/jotpad/actions
- Release：https://github.com/ZturnLibs/jotpad/releases/tag/vX.Y.Z

## 约定与红线

- 版本号四处必须一致（脚本自动维护）。
- tag 带 `v` 前缀（如 `v0.1.10`）。
- **仅当用户明确要求发布时执行**；不要主动发版。
- **不要** `--force` 推 tag；已发布 tag 勿改写，应发下一版本。
- 签名/更新密钥约定见 `.github/workflows/release.yml` 与组织 Secret（`RELEASE_TOKEN`、`TAURI_SIGNING_PRIVATE_KEY`）。

## 回复用户

简短给出：新版本号、tag、CI run 链接、预计时长（约 8–15 分钟）、Release 链接（构建完才有资产）。
