const assert = require("node:assert/strict");
const { createHash, webcrypto } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.atob) globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");

const repositoryRoot = path.resolve(__dirname, "..");
const security = require(path.join(repositoryRoot, "assets", "security.js"));
const rootApp = fs.readFileSync(path.join(repositoryRoot, "assets/app.js"), "utf8");
const newApp = fs.readFileSync(path.join(repositoryRoot, "new/assets/app.js"), "utf8");
const rootHtml = fs.readFileSync(path.join(repositoryRoot, "index.html"), "utf8");
const newHtml = fs.readFileSync(path.join(repositoryRoot, "new/index.html"), "utf8");

test("the esptool MD5 callback hashes binary strings correctly", () => {
  const binary = String.fromCharCode(0, 1, 0x7f, 0x80, 0xff);
  const expected = createHash("md5").update(Buffer.from(binary, "latin1")).digest("hex");
  assert.equal(security.md5Hex(binary), expected);
  assert.equal(security.md5Hex("abc"), "900150983cd24fb0d6963f7d28e17f72");
});

test("both flash flows request final MD5 readback and use signed segment offsets", async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "firmware/release-manifest.json"), "utf8"));
  const board = manifest.boards.find((entry) => entry.id === "Heltec_v3_repeater");
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
    boardId: board.id,
    mode: "update",
    pageHref: "https://flasher.example/new/",
    fetchImpl: fetchFromRepository
  });

  assert.deepEqual(
    loaded.artifacts.map((artifact) => ({ name: artifact.name, offset: artifact.offset, size: artifact.size })),
    board.modes.update.map((segment) => ({ name: segment.name, offset: segment.offset, size: segment.size }))
  );
  for (const source of [rootApp, newApp]) {
    assert.match(source, /calculateMD5Hash:\s*\(data\)\s*=>\s*security\.md5Hex\(data\)/);
    assert.match(source, /address:\s*artifact\.address/);
  }
});

test("serial command responses are registered before writes and queued", () => {
  for (const source of [rootApp, newApp]) {
    assert.match(source, /function enqueueSerialRequest\(operation\)/);
    assert.match(source, /return enqueueSerialRequest\(async \(\) =>/);
    const reply = source.slice(source.indexOf("runCommandExpectReply"));
    assert.ok(reply.indexOf("waitForLine(request.predicate") < reply.indexOf("await writeSerialCommand(request.command)"));
    const status = source.slice(source.indexOf("async function readMqttStatus"), source.indexOf("async function readMqttStatus") + 600);
    assert.match(status, /runCommandExpectReply\(/);
    assert.doesNotMatch(status, /await writeSerialCommand/);
  }
});

test("bootloader retries cancel and settle the previous bounded attempt", () => {
  for (const source of [rootApp, newApp]) {
    assert.match(source, /runLoaderMainWithTimeout\(/);
    assert.match(source, /reportedError\.pendingOperation = operation/);
    assert.match(source, /cleanupBootloaderAttempt\(error, transport\)/);
    assert.match(source, /cleanupBootloaderAttempt\(retryError, transport\)/);
    assert.doesNotMatch(source, /await loader\.main\(/);
  }
});

test("verification covers the exact applied plan and MQTT runtime state", () => {
  const verifyStart = newApp.indexOf("async function verifyNow");
  const verifyEnd = newApp.indexOf("/* ── Wire all buttons", verifyStart);
  const verifyBody = newApp.slice(verifyStart, verifyEnd);
  assert.match(verifyBody, /lastAppliedPlan\.mqtt/);
  assert.match(verifyBody, /for \(const entry of/);
  assert.match(verifyBody, /readMqttStatus\(\)/);
  assert.doesNotMatch(verifyBody, /\.forEach\(/);
  assert.match(rootApp, /verifyConfiguredDevice/);
  assert.match(rootApp, /collectVerificationResult\(lastAppliedPlan\)/);
  assert.match(rootApp, /function buildExpectedVerifyState\(plan = null\)/);
  assert.match(rootApp, /const expected = buildExpectedVerifyState\(plan\)/);
  assert.match(rootHtml, /id="verify-config-button"/);
});

test("default topics stay tokenized and deployment credentials require explicit entry", () => {
  assert.match(rootApp, /buildDefaultPacketsTopic\(iata, publicKey = "\{PUBLIC_KEY\}"\)/);
  assert.doesNotMatch(rootApp, /Read Current Device Info first so the flasher can build the full default MQTT topic path/);
  assert.doesNotMatch(rootApp, /Apply the private key first, then read the device info again before using the default MQTT topic path/);
  for (const source of [rootApp, newApp, rootHtml, newHtml]) {
    assert.doesNotMatch(source, /UKMesh-Radio/);
    assert.doesNotMatch(source, /password123/);
    assert.doesNotMatch(source, /observer-password/);
  }
  assert.match(rootApp, /buildConfigurationPlan\(\{ validatePrivateKey: false, requireMqtt: false, requireWifi: false \}\)/);
  assert.match(rootApp, /requireWifi/);
  assert.match(newApp, /WiFi SSID and password are required before applying settings/);
});
