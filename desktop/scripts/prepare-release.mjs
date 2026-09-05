import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [input, output, version] = process.argv.slice(2);
if (!input || !output || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? "")) {
  throw new Error("Usage: prepare-release.mjs <input-directory> <new-output-directory> <stable-version>");
}

const assets = [];
for (const arch of ["arm64", "x64"]) {
  for (const extension of ["dmg", "zip"]) {
    const name = `InkMind-${version}-${arch}.${extension}`;
    const path = join(input, `inkmind-macos-${arch}`, name);
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) throw new Error(`Missing or empty artifact: ${name}`);
    assets.push({ path, name, arch, extension });
  }
}
// Require a fresh directory so stale assets from another version cannot leak.
await mkdir(output);
for (const asset of assets) {
  await copyFile(asset.path, join(output, asset.name));
  if (asset.extension === "dmg") {
    await copyFile(asset.path, join(output, `InkMind-mac-${asset.arch}.dmg`));
  }
}
const sums = [];
for (const name of (await readdir(output)).sort()) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(output, name))) hash.update(chunk);
  sums.push(`${hash.digest("hex")}  ${name}`);
}
await writeFile(join(output, "SHA256SUMS"), `${sums.join("\n")}\n`);
console.log(`Prepared InkMind ${version}: DMG and ZIP for arm64/x64, stable download names, SHA256SUMS.`);
