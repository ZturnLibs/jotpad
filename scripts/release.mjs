#!/usr/bin/env node
// Jotpad release helper.
// Usage:
//   node scripts/release.mjs                # patch +1
//   node scripts/release.mjs minor          # minor bump
//   node scripts/release.mjs major
//   node scripts/release.mjs 1.2.0          # explicit version
//   node scripts/release.mjs patch "摘要"    # with changelog summary
//
// Checks tree is clean and tag is free, bumps the 4 version files
// (package.json, Cargo.toml, Cargo.lock, tauri.conf.json), commits
// "发布 vX.Y.Z", tags v*, pushes main + tag, then prints the CI run.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}
function capture(cmd) {
  return execSync(cmd, { stdio: ["pipe", "pipe", "pipe"] }).toString().trim();
}
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  if (!m) throw new Error(`invalid version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function bump(base, type) {
  const [maj, min, pat] = base;
  if (type === "major") return `${maj + 1}.0.0`;
  if (type === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

const [arg, ...rest] = process.argv.slice(2);
const summary = rest.join(" ").trim();

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const cur = pkg.version;

let next;
if (!arg || arg === "patch") next = bump(parseVersion(cur), "patch");
else if (arg === "minor" || arg === "major") next = bump(parseVersion(cur), arg);
else next = parseVersion(arg).join(".");

if (next === cur) {
  console.error(`✗ next version equals current (${cur})`);
  process.exit(1);
}

// Pre-checks.
const dirty = capture("git status --porcelain");
if (dirty) {
  console.error("✗ working tree not clean — commit your changes first:\n" + dirty);
  process.exit(1);
}
if (capture(`git rev-parse --abbrev-ref HEAD`) !== "main") {
  console.error("✗ not on main branch");
  process.exit(1);
}
if (capture(`git tag -l v${next}`)) {
  console.error(`✗ tag v${next} already exists`);
  process.exit(1);
}

console.log(`→ releasing ${cur} → ${next}${summary ? ` (${summary})` : ""}`);

// 1) Bump version files.
pkg.version = next;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
tauri.version = next;
writeFileSync("src-tauri/tauri.conf.json", JSON.stringify(tauri, null, 2) + "\n");

const cargoPath = "src-tauri/Cargo.toml";
const cargo = readFileSync(cargoPath, "utf8");
writeFileSync(cargoPath, cargo.replace(/^version = ".*"/m, `version = "${next}"`));

// 2) Refresh Cargo.lock.
try {
  execSync("cargo check --manifest-path src-tauri/Cargo.toml", { stdio: "pipe" });
} catch (e) {
  process.stderr.write((e.stderr?.toString() || e.message) + "\n");
  process.exit(1);
}

// 3) Commit, tag, push.
run("git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json");
const message =
  `发布 v${next}\n\n` +
  (summary ? `同步版本号以发布含${summary}的安装包。` : "同步版本号以发布。");
execSync("git commit -F -", {
  input: message,
  stdio: ["pipe", "inherit", "inherit"],
});
run(`git tag v${next}`);
run("git push origin main");
run(`git push origin v${next}`);

// 4) Confirm CI triggered.
console.log("\nCI:");
run("gh run list --workflow=release.yml --limit 1");
console.log(`\n✓ released v${next}`);
console.log(`  https://github.com/ZturnLibs/jotpad/releases/tag/v${next}`);
