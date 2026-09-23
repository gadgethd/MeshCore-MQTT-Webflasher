const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");

const security = require("../assets/security.js");
const serialLifecycle = require("../assets/serial-lifecycle.js");
const repositoryRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "firmware/release-manifest.json"), "utf8"));

test("the committed release manifest has a valid pinned signature", async () => {
  await security.verifyManifest(manifest);
  const tampered = structuredClone(manifest);
  tampered.boards[0].modes.full[0].size += 1;
  await assert.rejects(() => security.verifyManifest(tampered), /signature verification failed/);
});

test("same-origin policy rejects cross-origin manifests and artifacts", () => {
  assert.equal(
    security.assertSameOrigin("/firmware/release-manifest.json", "https://flasher.example/new/").href,
    "https://flasher.example/firmware/release-manifest.json"
  );
  assert.throws(
    () => security.assertSameOrigin("https://evil.example/firmware.bin", "https://flasher.example/new/"),
    /Cross-origin firmware URL rejected/
  );
});

test("verified loader checks signature, size, digest, and image chip header", async () => {
  const baseHref = "https://flasher.example/new/";
  const fetchFromRepository = async (url) => {
    const parsed = new URL(url);
    const filePath = path.join(repositoryRoot, parsed.pathname.replace(/^\//, ""));
    const body = fs.readFileSync(filePath);
    return {
      ok: true,
      status: 200,
      url: parsed.href,
      json: async () => JSON.parse(body.toString("utf8")),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    };
  };
  const loaded = await security.loadVerifiedFirmware({
    manifestPath: "/firmware/release-manifest.json",
    boardId: "Heltec_v3_repeater",
    mode: "full",
    pageHref: baseHref,
    fetchImpl: fetchFromRepository
  });
  assert.equal(loaded.artifacts.length, 1);
  assert.equal(security.parseEspImageChipId(loaded.artifacts[0].bytes), 9);
  assert.equal(security.assertChipCompatibility(loaded.board, loaded.artifacts, "ESP32-S3"), true);
  assert.throws(
    () => security.assertChipCompatibility(loaded.board, loaded.artifacts, "ESP32"),
    /Wrong chip for this firmware/
  );

  const fetchTamperedArtifact = async (url, options) => {
    const response = await fetchFromRepository(url, options);
    if (!new URL(url).pathname.endsWith(".bin")) return response;
    const original = new Uint8Array(await response.arrayBuffer());
    original[original.length - 1] ^= 0xff;
    return { ...response, arrayBuffer: async () => original.buffer };
  };
  await assert.rejects(
    () => security.loadVerifiedFirmware({
      manifestPath: "/firmware/release-manifest.json",
      boardId: "Heltec_v3_repeater",
      mode: "full",
      pageHref: baseHref,
      fetchImpl: fetchTamperedArtifact
    }),
    /SHA-256 does not match/
  );
});

test("all private-key and password transcript classes are redacted by command context", () => {
  const privateKey = "a".repeat(64);
  const cases = [
    ["get prv.key", `  -> > ${privateKey}`, privateKey],
    ["get guest.password", "  -> > guest-secret", "guest-secret"],
    ["password admin-secret", "  -> password now: admin-secret", "admin-secret"],
    ["get mqtt.wifi.pass", "  -> > wifi-secret", "wifi-secret"],
    ["get mqtt.4.password", "  -> > indexed-secret", "indexed-secret"],
    ["get mqtt.password", "  -> > legacy-secret", "legacy-secret"]
  ];

  for (const [command, response, secret] of cases) {
    const context = security.classifySerialCommand(command);
    assert.equal(context.sensitive, true, `${command} was not classified as sensitive`);
    const redacted = security.redactSerialText(response, context);
    assert(!redacted.includes(secret), `${command} leaked its response`);
    assert.match(redacted, /redacted/);
    assert(!security.maskSensitiveCommand(command).includes(secret), `${command} leaked in command logging`);
  }

  assert.equal(
    security.redactSerialText(`  -> > ${privateKey}`),
    "  -> > ********",
    "prefixed private-key fallback did not redact"
  );
});

test("both UIs redact at the logger and sensitive read request boundary", () => {
  const rootApp = fs.readFileSync(path.join(repositoryRoot, "assets/app.js"), "utf8");
  const newApp = fs.readFileSync(path.join(repositoryRoot, "new/assets/app.js"), "utf8");
  for (const source of [rootApp, newApp]) {
    assert.match(source, /security\.redactSerialText\(message|security\.redactSerialText\(line/);
    assert.match(source, /sensitive:\s*security\.isSensitiveSettingKey\(key\)/);
    assert.doesNotMatch(source, /\[match\]\s*\$\{line\}/);
  }
});

test("both flash flows verify before Web Serial and enforce chip compatibility before writing", () => {
  const sources = [
    fs.readFileSync(path.join(repositoryRoot, "assets/app.js"), "utf8"),
    fs.readFileSync(path.join(repositoryRoot, "new/assets/app.js"), "utf8")
  ];
  for (const source of sources) {
    const start = source.indexOf("async function flashFirmware(kind)");
    assert(start >= 0, "flashFirmware was not found");
    const flow = source.slice(start, start + 14000);
    const verification = flow.indexOf("buildFlashArtifacts(selectedBoard, kind)");
    const serialChooser = flow.indexOf("navigator.serial.requestPort()");
    const chipCheck = flow.indexOf("security.assertChipCompatibility");
    const write = flow.indexOf("loader.writeFlash");
    assert(verification >= 0 && verification < serialChooser, "firmware was not verified before Web Serial");
    assert(chipCheck >= 0 && chipCheck < write, "chip compatibility was not enforced before writing");
  }
});

test("device backups are encrypted, authenticated, and expire after seven days", async () => {
  const secretText = "Private Key: private-device-key\nAdmin Password: admin-secret";
  const passphrase = "a-long-backup-passphrase";
  const now = Date.UTC(2026, 8, 23, 12, 0, 0);
  const envelope = await security.encryptDeviceBackup(secretText, passphrase, { now });
  const serialized = JSON.stringify(envelope);
  assert(!serialized.includes("private-device-key"));
  assert(!serialized.includes("admin-secret"));
  assert.equal(await security.decryptDeviceBackup(envelope, passphrase, { now }), secretText);
  await assert.rejects(() => security.decryptDeviceBackup(envelope, "wrong-passphrase", { now }), /could not be decrypted/);
  await assert.rejects(() => security.decryptDeviceBackup(envelope, passphrase, { now: now + security.deviceBackupTtlMs + 1 }), /expired/);

  const extended = { ...envelope, expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString() };
  await assert.rejects(() => security.decryptDeviceBackup(extended, passphrase, { now }), /could not be decrypted/);
});

test("captured settings are not autosaved and session clear controls exist in both UIs", () => {
  const rootApp = fs.readFileSync(path.join(repositoryRoot, "assets/app.js"), "utf8");
  const newApp = fs.readFileSync(path.join(repositoryRoot, "new/assets/app.js"), "utf8");
  for (const source of [rootApp, newApp]) {
    assert.match(source, /meshcore-mqtt-device-info:/);
    assert.match(source, /meshcore-mqtt-step4-settings:/);
  }
  assert.doesNotMatch(rootApp, /localStorage\.setItem\(browser(?:Capture|Settings)Key/);
  assert.match(rootApp, /clear-device-data-button/);
  assert.match(newApp, /btn-clear-device-data/);
  assert.match(rootApp, /await clearDeviceData\(\{ notify: false \}\)/);
  assert.match(newApp, /await clearDeviceData\(\);\s*ok\("Settings verified;/);
});

test("serial lifecycle reports whether a prior bootloader attempt actually settled", async () => {
  const resolved = await serialLifecycle.waitForSettlement(Promise.resolve(), 100);
  assert.deepEqual(resolved, { settled: true, outcome: "resolved" });
  const rejected = await serialLifecycle.waitForSettlement(Promise.reject(new Error("closed")), 100);
  assert.deepEqual(rejected, { settled: true, outcome: "rejected" });
  const pending = await serialLifecycle.waitForSettlement(new Promise(() => {}), 5);
  assert.deepEqual(pending, { settled: false, outcome: "timeout" });

  const rootApp = fs.readFileSync(path.join(repositoryRoot, "assets/app.js"), "utf8");
  const newApp = fs.readFileSync(path.join(repositoryRoot, "new/assets/app.js"), "utf8");
  for (const source of [rootApp, newApp]) {
    assert.match(source, /MeshCoreSerialLifecycle\.waitForSettlement\(error\.pendingOperation, 1200\)/);
    assert.match(source, /if \(!previousAttemptStopped\)[\s\S]*?no retry was started/);
  }
});
