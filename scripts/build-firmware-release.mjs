#!/usr/bin/env node

import { createPrivateKey, createPublicKey, createHash, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = path.join(repositoryRoot, "firmware", "release-inventory.json");
const manifestPath = path.join(repositoryRoot, "firmware", "release-manifest.json");
const keyId = "meshcore-mqtt-webflasher-2026-08";
const expectedPublicKey = "ZeZvaCPRslfhfdYo1JKmLBMX1YTR79T8qSH1vAsDwXI=";

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  throw new Error("Release inventory contains an unsupported value");
}

async function enrichSegment(board, segment) {
  const relativePath = segment.path.replace(/^\//, "");
  const artifactPath = path.join(repositoryRoot, relativePath);
  const bytes = await readFile(artifactPath);
  return {
    ...segment,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    chipId: board.chipId
  };
}

async function buildManifest(inventory) {
  const boards = [];
  for (const board of inventory.boards) {
    boards.push({
      ...board,
      modes: {
        full: await Promise.all(board.modes.full.map((segment) => enrichSegment(board, segment))),
        update: await Promise.all(board.modes.update.map((segment) => enrichSegment(board, segment)))
      }
    });
  }
  return {
    schemaVersion: 1,
    release: inventory.release,
    boards
  };
}

function catalogFromManifest(manifest) {
  return {
    generatedAt: manifest.release.generatedAt,
    branch: "main",
    boards: manifest.boards.map((board) => {
      const full = board.modes.full.find((segment) => segment.name === "merged");
      const update = board.modes.update.find((segment) => segment.name === "firmware");
      if (!full || !update) throw new Error(`${board.id} must provide merged and firmware segments`);
      const artifactBase = `${path.posix.dirname(full.path)}/`;
      return {
        id: board.id,
        label: board.label,
        firmwareName: board.firmwareName,
        firmwareVersion: board.firmwareVersion,
        chipFamily: board.chipName,
        hardwareStatus: board.hardwareStatus,
        ...(board.notes ? { notes: board.notes } : {}),
        manifestPath: "/firmware/release-manifest.json",
        artifactBase,
        artifacts: {
          full: path.posix.basename(full.path),
          update: path.posix.basename(update.path)
        }
      };
    })
  };
}

async function main() {
  const signingKeyPath = process.env.FIRMWARE_SIGNING_KEY;
  if (!signingKeyPath) throw new Error("Set FIRMWARE_SIGNING_KEY to the offline Ed25519 private-key path");

  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const privateKey = createPrivateKey(await readFile(signingKeyPath));
  const publicDer = createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const actualPublicKey = publicDer.subarray(publicDer.length - 32).toString("base64");
  if (actualPublicKey !== expectedPublicKey) throw new Error("Signing key does not match the public key pinned in the flasher");

  const unsigned = await buildManifest(inventory);
  const signature = sign(null, Buffer.from(canonicalize(unsigned)), privateKey).toString("base64");
  const manifest = {
    ...unsigned,
    signature: { algorithm: "Ed25519", keyId, value: signature }
  };
  const catalog = `window.FIRMWARE_DATA = ${JSON.stringify(catalogFromManifest(manifest), null, 2)};\n`;

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(repositoryRoot, "assets", "firmware-data.js"), catalog);
  await writeFile(path.join(repositoryRoot, "new", "assets", "firmware-data.js"), catalog);
  process.stdout.write(`Signed ${manifest.boards.length} boards and regenerated both catalogs.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
