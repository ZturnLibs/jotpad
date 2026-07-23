// Render icon sources:
//  - app-icon.png      : full-bleed 1024 (source for `tauri icon` -> Windows/Linux)
//  - icon.iconset/*    : macOS-sized PNGs from the padded mac icon
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";

const root = new URL("../", import.meta.url);

const render = (svgRel, size) => {
  const svg = readFileSync(new URL(svgRel, root));
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
};

// 1. Full-bleed source PNG (Windows/Linux + tauri icon source).
writeFileSync(fileURLToPath(new URL("app-icon.png", root)), render("app-icon.svg", 1024));
console.log("wrote app-icon.png");

// 2. macOS iconset (padded icon) -> iconutil -> icon.icns.
const iconsetUrl = new URL("icon.iconset/", root);
rmSync(iconsetUrl, { recursive: true, force: true });
mkdirSync(iconsetUrl, { recursive: true });

const entries = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
];
for (const [size, name] of entries) {
  writeFileSync(
    fileURLToPath(new URL("icon.iconset/" + name, root)),
    render("app-icon-mac.svg", size),
  );
}
console.log("wrote icon.iconset/*");
