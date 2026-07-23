// Build a padded macOS .icns from icon.iconset via `iconutil` (mac only).
import { execSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";

const root = new URL("../", import.meta.url);
const iconset = fileURLToPath(new URL("icon.iconset", root));
const out = fileURLToPath(new URL("src-tauri/icons/icon.icns", root));

try {
  execSync(`iconutil -c icns "${iconset}" -o "${out}"`, { stdio: "inherit" });
  console.log("wrote src-tauri/icons/icon.icns (macOS, padded)");
} catch (e) {
  console.warn("iconutil not available (not macOS?) — skipping .icns:", e.message);
}
