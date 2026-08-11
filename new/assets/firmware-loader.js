"use strict";

const CATALOG_PATH = "/new/assets/firmware-data.json";

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== "object" || catalog.schemaVersion !== 1 || !Array.isArray(catalog.boards) || catalog.boards.length === 0) {
    throw new Error("Firmware catalog has an invalid schema");
  }

  const boardIds = new Set();
  for (const board of catalog.boards) {
    if (!board || typeof board !== "object" || !/^[A-Za-z0-9_-]+$/.test(board.id || "") || boardIds.has(board.id)) {
      throw new Error("Firmware catalog has a duplicate or invalid board ID");
    }
    boardIds.add(board.id);
    if (!board.label || !board.firmwareName || !board.firmwareVersion || !board.chipFamily ||
        !/^\/firmware\/release-manifest\.json$/.test(board.manifestPath || "") ||
        !/^\/firmware\/[A-Za-z0-9_.-]+\/$/.test(board.artifactBase || "") ||
        !board.artifacts || typeof board.artifacts.full !== "string" || typeof board.artifacts.update !== "string") {
      throw new Error(`Firmware catalog entry is invalid for ${board.id}`);
    }
  }

  return catalog;
}

async function bootstrap() {
  const response = await fetch(CATALOG_PATH, { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to load firmware catalog (${response.status})`);
  window.FIRMWARE_DATA = validateCatalog(await response.json());
  await import("./app.js?v=20260811-security1");
}

bootstrap().catch((error) => {
  console.error("Firmware catalog failed to load:", error);
  document.body.dataset.firmwareLoadError = "true";
});
