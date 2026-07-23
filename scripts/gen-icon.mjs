// Render app-icon.svg -> app-icon.png (1024x1024) for `tauri icon`.
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";

const svg = readFileSync(new URL("../app-icon.svg", import.meta.url));
const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1024 },
  background: "#00000000",
});
const png = resvg.render().asPng();
const out = new URL("../app-icon.png", import.meta.url);
writeFileSync(out, png);
console.log("wrote", out.pathname, png.length, "bytes");
