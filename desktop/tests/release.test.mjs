import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const prepare = fileURLToPath(new URL("../scripts/prepare-release.mjs", import.meta.url));
const validate = fileURLToPath(new URL("../scripts/validate-release-tag.mjs", import.meta.url));
const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url))).version;

test("only the matching stable desktop tag can release", () => {
  execFileSync(process.execPath, [validate, `v${version}`]);
  for (const tag of ["main", "v999.0.0", `v${version}-beta.1`, version, "v01.0.0"]) {
    assert.notEqual(spawnSync(process.execPath, [validate, tag]).status, 0);
  }
});

async function fixture(t, missing) {
  const directory = await mkdtemp(join(tmpdir(), "inkmind-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const arch of ["arm64", "x64"]) {
    const dir = join(directory, `inkmind-macos-${arch}`);
    await mkdir(dir);
    for (const extension of ["dmg", "zip"]) {
      if (`${arch}.${extension}` === missing) continue;
      await writeFile(join(dir, `InkMind-${version}-${arch}.${extension}`), `${arch}-${extension}-fixture`);
    }
  }
  return directory;
}

test("release contains both architectures, fixed download aliases and accurate hashes", async (t) => {
  const directory = await fixture(t);
  const output = join(directory, "output");
  execFileSync(process.execPath, [prepare, directory, output, version]);
  assert.equal((await readdir(output)).length, 7);
  for (const arch of ["arm64", "x64"]) {
    assert.deepEqual(await readFile(join(output, `InkMind-mac-${arch}.dmg`)),
      await readFile(join(output, `InkMind-${version}-${arch}.dmg`)));
  }
  const checksums = (await readFile(join(output, "SHA256SUMS"), "utf8")).trim().split("\n");
  assert.equal(checksums.length, 6);
  for (const line of checksums) {
    const [hash, name] = line.split("  ");
    assert.equal(hash, createHash("sha256").update(await readFile(join(output, name))).digest("hex"));
  }
  assert.notEqual(spawnSync(process.execPath, [prepare, directory, output, version]).status, 0);
});

test("missing Intel artifact prevents preparing a partial release", async (t) => {
  const directory = await fixture(t, "x64.zip");
  assert.notEqual(spawnSync(process.execPath, [prepare, directory, join(directory, "output"), version]).status, 0);
  assert.ok(!(await readdir(directory)).includes("output"));
});
