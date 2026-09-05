import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const icon = join(root, "icon.png");
// Preserve the artwork's alpha. Extra transparent padding gives the tile
// an optical size comparable to neighbouring macOS Dock icons.
// Apply a fixed app-tile mask so the packaged sizes have a clean silhouette.
const tileMask = Buffer.from('<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg"><rect x="92" y="82" width="840" height="840" rx="200" fill="white"/></svg>');
await sharp(join(root, "assets/icon-master.png"))
  .resize(960, 960, { fit: "contain", background: "#00000000" })
  .extend({ top: 32, bottom: 32, left: 32, right: 32, background: "#00000000" })
  .composite([{ input: tileMask, blend: "dest-in" }])
  .png()
  .toFile(icon);

// Keep the README and browser tab artwork in sync with the desktop icon.
await sharp(icon).resize(320, 320).png().toFile(join(root, "../images/favicon.png"));
await sharp(icon).resize(64, 64).png().toFile(join(root, "../frontend/public/favicon.png"));

if (process.platform === "darwin") {
  const iconset = join(root, "build/InkMind.iconset");
  await mkdir(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      await sharp(icon).resize(size * scale, size * scale)
        .png().toFile(join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`));
    }
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(root, "build/icon.icns")]);
  await rm(iconset, { recursive: true });
}
console.log("Built InkMind icon assets with transparent edges.");
