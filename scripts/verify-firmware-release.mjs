#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const security = require(path.join(repositoryRoot, "assets", "security.js"));

function parseCatalog(source) {
  const match = source.match(/^window\.FIRMWARE_DATA\s*=\s*([\s\S]+);\s*$/);
  if (!match) throw new Error("Catalog must be a JSON assignment to window.FIRMWARE_DATA");
  return JSON.parse(match[1]);
}

async function listBins(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await listBins(child));
    else if (entry.isFile() && entry.name.endsWith(".bin")) found.push(child);
  }
  return found;
}

function inventoryProjection(board) {
  return {
    id: board.id,
    label: board.label,
    firmwareName: board.firmwareName,
    firmwareVersion: board.firmwareVersion,
    chipId: board.chipId,
    chipName: board.chipName,
    hardwareStatus: board.hardwareStatus,
    ...(board.notes ? { notes: board.notes } : {}),
    modes: board.modes
  };
}

async function main() {
  const inventory = JSON.parse(await readFile(path.join(repositoryRoot, "firmware", "release-inventory.json"), "utf8"));
  const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "firmware", "release-manifest.json"), "utf8"));
  await security.verifyManifest(manifest);
  assert.deepEqual(manifest.release, inventory.release, "signed release metadata drifted from the inventory");
  assert.equal(manifest.boards.length, inventory.boards.length, "signed manifest board count drifted from inventory");

  const advertisedBins = new Set();
  for (const sourceBoard of inventory.boards) {
    const signedBoard = manifest.boards.find((board) => board.id === sourceBoard.id);
    assert(signedBoard, `signed manifest omits ${sourceBoard.id}`);
    const { modes: _signedModes, ...signedMetadata } = inventoryProjection(signedBoard);
    const { modes: _sourceModes, ...sourceMetadata } = inventoryProjection(sourceBoard);
    assert.deepEqual(signedMetadata, sourceMetadata, `${sourceBoard.id} metadata drifted from inventory`);

    for (const mode of ["full", "update"]) {
      assert.equal(signedBoard.modes[mode].length, sourceBoard.modes[mode].length, `${sourceBoard.id} ${mode} segment count drifted`);
      for (let index = 0; index < sourceBoard.modes[mode].length; index += 1) {
        const sourceSegment = sourceBoard.modes[mode][index];
        const segment = signedBoard.modes[mode][index];
        assert.deepEqual(
          { name: segment.name, path: segment.path, offset: segment.offset, imageHeader: segment.imageHeader },
          sourceSegment,
          `${sourceBoard.id} ${mode} inventory drifted`
        );
        const artifactPath = path.join(repositoryRoot, segment.path.replace(/^\//, ""));
        const bytes = await readFile(artifactPath);
        assert.equal(bytes.byteLength, segment.size, `${segment.path} size mismatch`);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), segment.sha256, `${segment.path} digest mismatch`);
        if (segment.imageHeader) assert.equal(security.parseEspImageChipId(new Uint8Array(bytes)), segment.chipId, `${segment.path} chip mismatch`);
        advertisedBins.add(path.resolve(artifactPath));
      }
    }
  }

  const committedBins = new Set((await listBins(path.join(repositoryRoot, "firmware"))).map((file) => path.resolve(file)));
  assert.deepEqual(advertisedBins, committedBins, "every committed firmware binary must be advertised exactly once or shared explicitly");

  const rootCatalog = parseCatalog(await readFile(path.join(repositoryRoot, "assets", "firmware-data.js"), "utf8"));
  const newCatalog = parseCatalog(await readFile(path.join(repositoryRoot, "new", "assets", "firmware-data.js"), "utf8"));
  assert.deepEqual(rootCatalog, newCatalog, "legacy and /new/ catalogs must be identical");
  assert.equal(rootCatalog.boards.length, manifest.boards.length, "catalog board count differs from manifest");
  rootCatalog.boards.forEach((catalogBoard) => {
    const signedBoard = manifest.boards.find((board) => board.id === catalogBoard.id);
    assert(signedBoard, `catalog advertises unknown board ${catalogBoard.id}`);
    assert.equal(catalogBoard.chipFamily, signedBoard.chipName, `${catalogBoard.id} chip label mismatch`);
    assert.equal(catalogBoard.manifestPath, "/firmware/release-manifest.json", `${catalogBoard.id} does not use the signed release manifest`);
    const full = signedBoard.modes.full.find((segment) => segment.name === "merged");
    const update = signedBoard.modes.update.find((segment) => segment.name === "firmware");
    assert.equal(`${catalogBoard.artifactBase}${catalogBoard.artifacts.full}`, full.path, `${catalogBoard.id} full catalog path mismatch`);
    assert.equal(`${catalogBoard.artifactBase}${catalogBoard.artifacts.update}`, update.path, `${catalogBoard.id} update catalog path mismatch`);
  });

  assert(!existsSync(path.join(repositoryRoot, "assets", "firmware-data-dev.js")), "retired dev catalog must not be present");
  for (const htmlPath of ["index.html", "new/index.html"]) {
    const html = await readFile(path.join(repositoryRoot, htmlPath), "utf8");
    const securityIndex = html.indexOf(htmlPath.startsWith("new/") ? "../assets/security.js" : "assets/security.js");
    const appIndex = html.indexOf("assets/app.js");
    assert(securityIndex >= 0 && securityIndex < appIndex, `${htmlPath} must load the pinned security helper before app.js`);
    assert(!/<option[^>]+value=["']dev["']/i.test(html), `${htmlPath} still exposes the retired dev catalog`);
  }

  process.stdout.write(`Verified signed release inventory, ${manifest.boards.length} boards, and ${committedBins.size} firmware binaries.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
