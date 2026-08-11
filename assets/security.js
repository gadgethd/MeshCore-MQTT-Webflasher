(function initMeshCoreSecurity(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MeshCoreSecurity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createMeshCoreSecurity(root) {
  "use strict";

  const MANIFEST_SCHEMA_VERSION = 1;
  const SIGNING_KEY_ID = "meshcore-mqtt-webflasher-2026-08";
  const SIGNING_PUBLIC_KEY_BASE64 = "ZeZvaCPRslfhfdYo1JKmLBMX1YTR79T8qSH1vAsDwXI=";
  const SHA256_PATTERN = /^[0-9a-f]{64}$/;
  const CHIP_IDS = Object.freeze({
    ESP32: 0x0000,
    "ESP32-S2": 0x0002,
    "ESP32-C3": 0x0005,
    "ESP32-S3": 0x0009,
    "ESP32-C6": 0x000d,
    "ESP32-H2": 0x0010
  });

  function canonicalize(value) {
    if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
    if (typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
    }
    throw new Error("Manifest contains a value that cannot be signed");
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function sha256Hex(bytes) {
    if (!root.crypto?.subtle) throw new Error("Web Crypto is required to verify firmware");
    const digest = await root.crypto.subtle.digest("SHA-256", bytes);
    return bytesToHex(new Uint8Array(digest));
  }

  function unsignedManifest(manifest) {
    const copy = { ...manifest };
    delete copy.signature;
    return copy;
  }

  function validateSegment(segment, board, mode) {
    if (!segment || typeof segment !== "object") throw new Error(`${board.id} ${mode} contains an invalid segment`);
    if (!/^[a-z0-9_-]+$/i.test(segment.name || "")) throw new Error(`${board.id} ${mode} has an invalid segment name`);
    if (typeof segment.path !== "string" || !/^\/firmware\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.bin$/.test(segment.path)) {
      throw new Error(`${board.id} ${mode} has an invalid artifact path`);
    }
    if (!Number.isSafeInteger(segment.offset) || segment.offset < 0) throw new Error(`${board.id} ${mode} has an invalid offset`);
    if (!Number.isSafeInteger(segment.size) || segment.size <= 0) throw new Error(`${board.id} ${mode} has an invalid size`);
    if (segment.offset + segment.size > 16 * 1024 * 1024) throw new Error(`${board.id} ${mode} exceeds the supported flash address range`);
    if (!SHA256_PATTERN.test(segment.sha256 || "")) throw new Error(`${board.id} ${mode} has an invalid SHA-256 digest`);
    if (segment.chipId !== board.chipId) throw new Error(`${board.id} ${mode} segment chip ID does not match its board`);
    if (typeof segment.imageHeader !== "boolean") throw new Error(`${board.id} ${mode} must declare imageHeader for every segment`);
  }

  function validateMode(board, mode) {
    const segments = board.modes?.[mode];
    if (!Array.isArray(segments) || segments.length === 0) throw new Error(`${board.id} does not publish a ${mode} image`);
    segments.forEach((segment) => validateSegment(segment, board, mode));
    const sorted = [...segments].sort((left, right) => left.offset - right.offset);
    for (let index = 1; index < sorted.length; index += 1) {
      const previousEnd = sorted[index - 1].offset + sorted[index - 1].size;
      if (sorted[index].offset < previousEnd) throw new Error(`${board.id} ${mode} segments overlap`);
    }
    if (!segments.some((segment) => segment.imageHeader)) {
      throw new Error(`${board.id} ${mode} has no ESP image header to validate`);
    }
  }

  function validateManifestSchema(manifest) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("Firmware manifest is not an object");
    if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) throw new Error("Unsupported firmware manifest schema");
    if (!manifest.release || typeof manifest.release !== "object") throw new Error("Firmware manifest release metadata is missing");
    if (!Array.isArray(manifest.boards) || manifest.boards.length === 0) throw new Error("Firmware manifest contains no boards");

    const boardIds = new Set();
    manifest.boards.forEach((board) => {
      if (!board || typeof board !== "object" || !/^[A-Za-z0-9_-]+$/.test(board.id || "")) throw new Error("Firmware manifest has an invalid board ID");
      if (boardIds.has(board.id)) throw new Error(`Firmware manifest repeats board ${board.id}`);
      boardIds.add(board.id);
      if (!Number.isSafeInteger(board.chipId) || board.chipId < 0) throw new Error(`${board.id} has an invalid chip ID`);
      if (!CHIP_IDS[normalizeChipName(board.chipName)] && board.chipId !== CHIP_IDS.ESP32) {
        throw new Error(`${board.id} has an unsupported chip name`);
      }
      if (CHIP_IDS[normalizeChipName(board.chipName)] !== board.chipId) throw new Error(`${board.id} chip name and ID disagree`);
      validateMode(board, "full");
      validateMode(board, "update");
    });
    return manifest;
  }

  async function verifyManifest(manifest) {
    const signature = manifest?.signature;
    if (signature?.algorithm !== "Ed25519" || signature?.keyId !== SIGNING_KEY_ID || typeof signature?.value !== "string") {
      throw new Error("Firmware manifest is not signed by the expected release key");
    }
    if (!root.crypto?.subtle) throw new Error("Web Crypto is required to verify the firmware manifest");
    const publicKey = await root.crypto.subtle.importKey(
      "raw",
      base64ToBytes(SIGNING_PUBLIC_KEY_BASE64),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const payload = new TextEncoder().encode(canonicalize(unsignedManifest(manifest)));
    const valid = await root.crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      base64ToBytes(signature.value),
      payload
    );
    if (!valid) throw new Error("Firmware manifest signature verification failed");
    return validateManifestSchema(manifest);
  }

  function assertSameOrigin(path, baseHref) {
    const base = new URL(baseHref);
    const resolved = new URL(path, base);
    if (resolved.origin !== base.origin || resolved.username || resolved.password) {
      throw new Error(`Cross-origin firmware URL rejected: ${resolved.origin}`);
    }
    if (resolved.protocol !== "https:" && resolved.protocol !== "http:") throw new Error("Firmware URL must use HTTP or HTTPS");
    return resolved;
  }

  function assertResponseOrigin(response, requestedUrl, pageHref) {
    if (!response.url) return;
    const actual = assertSameOrigin(response.url, pageHref);
    if (actual.origin !== requestedUrl.origin) throw new Error("Cross-origin firmware redirect rejected");
  }

  function parseEspImageChipId(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 14) throw new Error("ESP image header is truncated");
    if (bytes[0] !== 0xe9) throw new Error("ESP image header has invalid magic byte");
    return bytes[12] | (bytes[13] << 8);
  }

  function normalizeChipName(value) {
    return String(value || "")
      .trim()
      .toUpperCase()
      .replace(/_/g, "-")
      .replace(/^ESP32S([236])$/, "ESP32-S$1")
      .replace(/^ESP32C([236])$/, "ESP32-C$1")
      .replace(/^ESP32H2$/, "ESP32-H2");
  }

  async function loadVerifiedFirmware({ manifestPath, boardId, mode, pageHref, fetchImpl = root.fetch }) {
    if (mode !== "full" && mode !== "update") throw new Error("Unsupported flash mode");
    if (typeof fetchImpl !== "function") throw new Error("Firmware fetch is unavailable");
    const manifestUrl = assertSameOrigin(manifestPath, pageHref);
    const manifestResponse = await fetchImpl(manifestUrl.toString(), { cache: "no-store", redirect: "follow" });
    if (!manifestResponse.ok) throw new Error(`Failed to fetch signed firmware manifest (${manifestResponse.status})`);
    assertResponseOrigin(manifestResponse, manifestUrl, pageHref);
    const manifest = await manifestResponse.json();
    await verifyManifest(manifest);

    const board = manifest.boards.find((entry) => entry.id === boardId);
    if (!board) throw new Error(`Signed manifest does not authorize board ${boardId}`);
    const artifacts = [];
    for (const segment of board.modes[mode]) {
      const artifactUrl = assertSameOrigin(segment.path, pageHref);
      const response = await fetchImpl(artifactUrl.toString(), { cache: "no-store", redirect: "follow" });
      if (!response.ok) throw new Error(`Failed to fetch ${segment.path} (${response.status})`);
      assertResponseOrigin(response, artifactUrl, pageHref);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength !== segment.size) throw new Error(`${segment.name} size does not match the signed manifest`);
      const digest = await sha256Hex(bytes);
      if (digest !== segment.sha256) throw new Error(`${segment.name} SHA-256 does not match the signed manifest`);
      if (segment.imageHeader && parseEspImageChipId(bytes) !== segment.chipId) {
        throw new Error(`${segment.name} image header chip ID does not match the signed manifest`);
      }
      artifacts.push({ ...segment, bytes, imageName: segment.path.split("/").pop() });
    }
    return { manifest, board, artifacts };
  }

  function assertChipCompatibility(board, artifacts, detectedChipName) {
    const expectedName = normalizeChipName(board?.chipName);
    const actualName = normalizeChipName(detectedChipName);
    if (!actualName || CHIP_IDS[actualName] === undefined) throw new Error("Connected chip could not be identified safely");
    if (actualName !== expectedName || CHIP_IDS[actualName] !== board.chipId) {
      throw new Error(`Wrong chip for this firmware: selected ${expectedName}, connected ${actualName}`);
    }
    artifacts.filter((artifact) => artifact.imageHeader).forEach((artifact) => {
      const imageChipId = parseEspImageChipId(artifact.bytes);
      if (imageChipId !== board.chipId || imageChipId !== CHIP_IDS[actualName]) {
        throw new Error(`${artifact.name} is not compatible with connected ${actualName}`);
      }
    });
    return true;
  }

  function isSensitiveSettingKey(value) {
    const key = String(value || "").trim().toLowerCase();
    return key === "prv.key" || key === "guest.password" || key === "admin.password" ||
      key === "mqtt.wifi.pass" || key === "mqtt.password" || /^mqtt\.\d+\.password$/.test(key);
  }

  function classifySerialCommand(command) {
    const text = String(command || "").trim();
    const getMatch = text.match(/^get\s+([^\s]+)$/i);
    if (getMatch && isSensitiveSettingKey(getMatch[1])) return { sensitive: true, label: getMatch[1].toLowerCase() };
    const setMatch = text.match(/^set\s+([^\s]+)\s+/i);
    if (setMatch && isSensitiveSettingKey(setMatch[1])) return { sensitive: true, label: setMatch[1].toLowerCase() };
    if (/^password\s+/i.test(text)) return { sensitive: true, label: "admin password" };
    return { sensitive: false, label: "" };
  }

  function maskSensitiveCommand(command) {
    const text = String(command || "");
    if (/^password\s+/i.test(text)) return text.replace(/^(password\s+).*$/i, "$1********");
    return text.replace(
      /^(set\s+(?:prv\.key|guest\.password|mqtt\.wifi\.pass|mqtt\.password|mqtt\.\d+\.password)\s+).*$/i,
      "$1********"
    );
  }

  function redactSerialText(value, context = null) {
    if (context?.sensitive) return `[sensitive response for ${context.label || "credential"} redacted]`;
    let text = String(value == null ? "" : value);
    text = maskSensitiveCommand(text);
    text = text.replace(/(password now:\s*)\S+/gi, "$1********");
    text = text.replace(/((?:prv\.key|guest\.password|admin\.password|mqtt\.wifi\.pass|mqtt\.password|mqtt\.\d+\.password)\s*(?:=|:)\s*)\S+/gi, "$1********");
    text = text.replace(/(->\s*>?\s*)([0-9a-f]{64,128})(?=\s*$)/gi, "$1********");
    return text;
  }

  return Object.freeze({
    CHIP_IDS,
    MANIFEST_SCHEMA_VERSION,
    SIGNING_KEY_ID,
    SIGNING_PUBLIC_KEY_BASE64,
    assertChipCompatibility,
    assertSameOrigin,
    canonicalize,
    classifySerialCommand,
    isSensitiveSettingKey,
    loadVerifiedFirmware,
    maskSensitiveCommand,
    normalizeChipName,
    parseEspImageChipId,
    redactSerialText,
    sha256Hex,
    unsignedManifest,
    validateManifestSchema,
    verifyManifest
  });
});
