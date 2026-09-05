import { readFile } from "node:fs/promises";

const tag = process.argv[2];
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || tag !== `v${version}`) {
  throw new Error(`Release tag must match the stable desktop version: v${version}`);
}
console.log(`Validated ${tag}`);
