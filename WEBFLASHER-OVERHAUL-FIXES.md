# MeshCore MQTT Webflasher — Overhaul Fix Plan (v1)

**STATUS: ALL FIXES IMPLEMENTED + DEPLOYED 2026-08-01** (commits `017e628`, `e137c91` on `main`, container rebuilt, live verified)

**Repo:** `gadgethd/MeshCore-MQTT-Webflasher` (working tree on `flasher-ukmesh` = 192.168.100.106)
**Live site:** `https://flasher.ukmesh.com/new/` — served by `meshcore-mqtt-webflasher` nginx container (built from this working tree, port 8080), behind Cloudflare remote tunnel (`cloudflared.service`, token).
**Firmware validated against:** `/home/ben/MeshCore` (gadgethd/MeshCore-MQTT, v1.16.0), `CommonCLI.cpp`, `MyMesh.cpp`, `MqttReporter.cpp`, `MqttSettingsStore`.

Severity legend: 🔴 CRITICAL (broken flow) · 🟠 HIGH (will bite users) · 🟡 MEDIUM (correctness/hygiene)

---

## 🔴 FIX 1 — Flashing always fails: port is pre-opened before esptool-js

**File:** `new/assets/app.js` (~line 1285, inside `flashFirmware()`)

**Problem:** The new flasher calls `await port.open({ baudRate: 115200 })` after `navigator.serial.requestPort()`. esptool-js's `Transport.connect()` then calls `device.open()` **again** on the already-open port → Chromium rejects with `InvalidStateError: The port is already open` → the flash dies at "Connecting to bootloader" every time. The old flasher at `/` does **not** pre-open the port (verified) — this is a regression introduced in the new build.

**Why it's subtle:** On some UART bridges the double-open can *appear* to limp along before failing; on native USB-serial-JTAG (VID `303a`) it also corrupts the USB endpoint state so later retries hang. Never pre-open.

**Fix:**

```js
// BEFORE (broken):
port = await navigator.serial.requestPort();
if (typeof port.getInfo === "function") preferredSerialPortInfo = port.getInfo();
await port.open({ baudRate: 115200 });   // ← REMOVE THIS LINE
log("Serial device selected for flashing.");

// AFTER (correct):
port = await navigator.serial.requestPort();
if (typeof port.getInfo === "function") preferredSerialPortInfo = port.getInfo();
log("Serial device selected for flashing.");
```

Pass the **unopened** port to esptool-js — `new Transport(port, ...)` must be the only code path that calls `device.open()`. Do not open/close/reopen the same port object anywhere else in the flash flow (`connectBootloaderWithFallback`, `releaseFlashSession` already operate on the transport — leave them).

**Verify:** flash a Heltec v3 — progress must reach "Writing full image..." and complete with "Flash complete".

---

## 🔴 FIX 2 — `loader.main()` hangs forever when the chip is not in download mode

**File:** `new/assets/app.js` — `connectBootloaderWithFallback()`

**Problem:** `loader.main()` retries sync indefinitely if the chip isn't in download mode. The current code only falls back to manual bootloader entry when the error matches `/setSignals|control signals/` — a plain sync timeout never triggers it, so the UI hangs at "Connecting to bootloader" with no guidance. This is the #1 complaint scenario for native USB-serial-JTAG boards (VID `303a`): auto-reset via DTR/RTS does not exist, so the user MUST hold BOOT + tap RESET manually, and nothing in the UI tells them.

**Fix — wrap `loader.main()` in a timeout and treat timeout as "manual bootloader needed":**

```js
async function withTimeout(promise, ms, msg) {
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(msg || `Timed out after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timer]);
}

async function connectBootloaderWithFallback({ ESPLoader, HardReset, Transport, port, flashOptions, boardLabel }) {
  const makeLoader = () => {
    const transport = new Transport(port, true);
    const loader = new ESPLoader({ ...flashOptions, transport });
    loader.hr = new HardReset(transport);
    return { transport, loader };
  };

  let { transport, loader } = makeLoader();
  try {
    const chip = await withTimeout(loader.main(), 12000,
      "Timed out. Enter download mode: hold BOOT, tap RESET, release BOOT.");
    return { chip, loader, transport };
  } catch (error) {
    const needsManual = /setSignals|control signals|Timed out|Failed to connect/i.test(String(error && error.message || error));
    if (!needsManual) throw error;

    log("Automatic bootloader entry failed — manual entry required.");
    const usbVid = port.getInfo && port.getInfo().usbVendorId ? port.getInfo().usbVendorId.toString(16) : "";
    const isNative = usbVid === "303a";
    window.alert(
      "Manual bootloader entry required\n\n" +
      `Please perform these steps on your ${boardLabel}:\n\n` +
      "1. Hold down the BOOT button\n" +
      "2. Tap the RESET button\n" +
      "3. Keep BOOT held for 2 seconds, then release\n\n" +
      (isNative
        ? "This board uses native USB-serial-JTAG — manual bootloader entry is always required.\n\n"
        : "") +
      "Click OK when ready and the flasher will retry connecting."
    );
    try { await releaseFlashSession(transport, null); } catch (e) { log(`Flash reconnect warning: ${e.message}`); }
    await delay(2500);
    ({ transport, loader } = makeLoader());
    const chip = await withTimeout(loader.main("no_reset"), 12000,
      "Still can't connect. Power-cycle the board and try again.");
    return { chip, loader, transport };
  }
}
```

Also show the VID-derived hint inline in the log at connect time:
```js
const usbVid = port.getInfo && port.getInfo().usbVendorId ? port.getInfo().usbVendorId.toString(16) : "";
if (usbVid === "303a") log("Native USB-serial-JTAG detected — manual bootloader entry required (hold BOOT, tap RESET, release BOOT).", "orange");
```

**Verify:** connect a Heltec v3 WITHOUT pressing BOOT → after ~12 s a clear manual-entry dialog appears; after entering bootloader mode the flash proceeds.

---

## 🟠 FIX 3 — MQTT topic root bakes in a resolved public key; should store the template

**Files:** `new/assets/app.js` — `brokerTopicRoot()`, `buildPlan()`

**Problem:** The flasher resolves `{PUBLIC_KEY}` client-side (from the captured device) and sends `set mqtt.N.topic.root meshcore/LHR/<resolved-pubkey>/packets`. The firmware (`MqttReporter.cpp::expandTopicTokens`) is designed to resolve `{PUBLIC_KEY}` / `{IATA}` **at runtime** from the device's actual identity on every boot. Baking the resolved key means:
- if the private key is rotated after flashing, topics silently point at the old key until manually fixed;
- the current guard ("Apply the private key first, then read the device info again") forces an awkward re-read cycle for no reason.

**Fix:** send the template with placeholders and let the firmware expand it:

```js
// brokerTopicRoot(): always keep the template form
function brokerTopicRoot(b, { realPublicKey = true } = {}) {
  if (b.useDefault) {
    return buildDefaultPacketsTopic(b.iata);   // → meshcore/{IATA}/{PUBLIC_KEY}/packets
  }
  return b.topicRootInput;
}
```

- `buildDefaultPacketsTopic()` must stop substituting the captured public key — output `meshcore/{IATA}/{PUBLIC_KEY}/packets` verbatim (with the user's IATA).
- Remove the `buildPlan()` validation that errors when `privateKey !== capturedPrivateKey` for default-topic brokers (no longer needed — the firmware resolves from the identity it actually boots with).
- Keep the "Read Current Device Info first" requirement only as an advisory (the UI still *displays* the expanded preview for clarity — compute it for display only, never for the command).
- In the UI topic preview, show the *expanded* form for readability but note it is stored as a template.

**Verify:** flash + configure a device, then run `set prv.key <new>` afterwards (or on a second flash) — packets/status topics must still be correct after reboot without re-reading.

---

## 🟠 FIX 4 — Admin password echoed in plaintext into the visible log pane

**File:** `new/assets/app.js` — `pushSerialLine()` / `log()`

**Problem:** The firmware replies to `password <admin>` with `  -> password now: <plaintext>`. Every serial line is logged via `pushSerialLine()` → the admin password lands in the on-screen log pane and the copyable log buffer. The *sent* command is masked (`maskSensitiveCommand`), but the *reply* is not. Same exposure for `get guest.password` / `get prv.key` replies during device read (those are shown in the capture UI by design, but the raw log also holds them).

**Fix:** filter sensitive payloads from log output:

```js
function maskSensitiveLine(line) {
  // firmware echoes the new admin password in the reply to `password <new>`
  if (/password now:\s*\S+/i.test(line)) {
    return line.replace(/(password now:\s*)\S+/i, "$1********");
  }
  // guard the raw key/password readbacks as well
  if (/^(?:>\s*)?[0-9a-fA-F]{64,128}$/.test(line.trim())) return "********"; // prv.key blob
  return line;
}

// in pushSerialLine():
if (line.length < 300) log("[rx] " + maskSensitiveLine(line));
```

Also apply `maskSensitiveLine` in `verifyNow()` rows and any place raw `get` replies are rendered. Do **not** mask the captured-values chips in step 1 (that's the backup/restore feature and is user-requested), but the raw log pane must never contain secrets.

**Verify:** apply settings with an admin password → log pane shows `password now: ********`; `Download Backup` still contains the real values (backup is deliberate).

---

## 🟡 FIX 5 — Commit the `new/` flasher + working-tree changes to git

**Problem:** The entire `new/` directory is untracked (`?? new/`), plus 85 modified files (Dockerfile, `index.html`, `assets/app.js`, `assets/firmware-data.js`, v1.16.0 firmware trees, etc.). The live container is baked from this uncommitted state — anyone rebuilding from the repo loses the new flasher entirely.

**Fix (deployment hygiene):**

```bash
cd /home/ben/MeshCore-MQTT-WebFlasher
git add new/ Dockerfile nginx.conf compose.yml index.html assets/ firmware/
git commit -m "Add v2 flasher (/new): 5-step flow, WebSerial CLI config, v1.16.0 firmware"

# push to the fork (HTTPS remote already set)
git push origin main
```

Then rebuild + redeploy:
```bash
docker compose up -d --build
curl -sI http://127.0.0.1:8080/new/ | head -3   # 200, Server: nginx
```

Future releases: commit firmware-data.js + firmware/ bumps together, bump the `?v=` query strings in `new/index.html`, then `docker compose up -d --build`. The Cloudflare tunnel (`cloudflared.service`) needs no changes.

**Verify:** fresh clone of the repo builds the container with `/new/` present; live site md5s match the committed files.

---

## 🟡 FIX 6 — Add `Permissions-Policy: serial=(self)` header

**File:** `nginx.conf` (both the root server block and the `^~ /new/` block)

**Problem:** No `Permissions-Policy` header is emitted. Today Chrome works because the serial default allowlist is `self`, but Brave (Strict shields), some enterprise Chromium policies, and future Chromium defaults can silently disable `navigator.serial` even on HTTPS — the page then appears "dead" with no error.

**Fix:**

```nginx
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), serial=(self)" always;
```

Add alongside the existing `add_header` lines in **both** server blocks. Restart the container (`docker compose up -d --build`).

**Verify:** `curl -sI https://flasher.ukmesh.com/new/ | grep -i permissions-policy` returns the header; `'serial' in navigator` is true in Chrome and Brave.

---

## 🟡 FIX 7 — Bump cache-bust query strings after any asset edit

**File:** `new/index.html`

**Problem:** All assets are referenced as `?v=20260610`, but `app.js` was last modified Jun 23 — the version string was never bumped, so Cloudflare/nginx (1-day cache on css/js) can serve stale JS to repeat visitors after a deploy.

**Fix:** after editing any asset, bump ALL three query strings together in `new/index.html`:
```html
<link rel="stylesheet" href="assets/styles.css?v=YYYYMMDD">
<script src="assets/firmware-data.js?v=YYYYMMDD"></script>
<script type="module" src="assets/app.js?v=YYYYMMDD"></script>
```
Use the deploy date. This is a manual step — add it to the release checklist (see Fix 5).

**Verify:** after deploy, `curl -s "https://flasher.ukmesh.com/new/assets/app.js?v=<new>"` returns the new content (compare sha256 with the container file).

---

## 🟡 FIX 8 — Extend the Verify step to cover the full plan

**File:** `new/assets/app.js` — `verifyNow()`

**Problem:** Verify only checks Name, Lat, Lon, Guest, WiFi SSID, MQTT1 URI. Radio, private key, WiFi password, MQTT2–6, topic roots, IATA, retain status, and enabled flags are never read back.

**Fix:** after applying settings, read back and compare:
- `radio` (normalize: freq 3 decimals, bw, sf, cr) — compare to the applied `set radio` args
- `mqtt.wifi.pass` (compare, then mask in display)
- `mqtt.1..6.{uri,username,topic.root,iata,retain.status,enabled}` for every enabled/configured broker
- skip `prv.key` display but compare hash-equality (readback is allowed; show only ✓/✗, never the key)

Render each row `label: value ✓/✗` as today, plus an overall "N of M matched" summary and a warning row when any ✗ appears. Do not fail the flow on readback mismatch — just surface it loudly.

**Verify:** apply a full config, click Verify → every applied setting matches; intentionally corrupt one broker URI and confirm the ✗ shows.

---

## 🟡 FIX 9 — Update `firmware-data.js` hardware status (board coverage)

**File:** `new/assets/firmware-data.js` (+ `firmware/*/manifest.json` on rebuild)

**Problem:** 13 boards are listed; only `Heltec_v3_repeater` is "Verified on hardware", the rest are "Compile validated". Users picking a board labelled only as compile-validated may hit real-hardware quirks (antenna switch, TCXO, USB-JTAG vs UART) with no warning.

**Fix (after on-device testing):**
- Mark each board that has been physically flashed+verified as `"hardwareStatus": "Verified on hardware"`.
- For boards not yet hardware-verified, show a warning in the Board step: `"This board is compile-validated only — hardware quirks may apply. Flash at your own risk."`
- Keep `firmware-data.js` generatedAt/version in sync with the manifests.

**Verify:** UI shows the warning for unverified boards and no warning for Heltec v3.

---

## 🟡 FIX 10 — Remove stale/broken deploy artifacts

**Problem (minor):** `/home/ben/MeshCore-MQTT-WebFlasher/http-preview.log`, `http-preview.pid` (dead Python preview from March, pid 17090 no longer running) and `/home/ben/firmware.bin` are leftovers that confuse future scans. `new/firmware/` is intentionally empty (binaries live in the root `firmware/` tree, shared with the old flasher) — add a `.gitkeep` + README note so nobody "fixes" it.

**Fix:**
```bash
rm -f /home/ben/MeshCore-MQTT-WebFlasher/http-preview.log \
      /home/ben/MeshCore-MQTT-WebFlasher/http-preview.pid
# add new/firmware/README.md explaining it is intentionally empty
```
Also delete the stray `/home/ben/firmware.bin` after confirming it is not referenced by any build script (`grep -rn firmware.bin /home/ben/MeshCore* --include='*.sh' --include='*.py'` first).

**Verify:** no references found; clean `git status` after commit.

---

## Implementation order

| Step | Fix | Why first |
|---|---|---|
| 1 | 🔴 FIX 1 (pre-open port) | Flashing is 100% broken without this |
| 2 | 🔴 FIX 2 (timeout + manual entry) | Second-most common failure mode |
| 3 | 🟠 FIX 4 (password leak) | Security — do before any public announcement |
| 4 | 🟠 FIX 3 (topic template) | Settings correctness for key rotation |
| 5 | 🟡 FIX 5 (git commit) | Protect the work before more edits |
| 6 | 🟡 FIX 6–8 (headers, cache, verify) | Hardening |
| 7 | 🟡 FIX 9–10 (board status, cleanup) | Polish |

## Post-implementation verification checklist

- [ ] `curl -s http://127.0.0.1:8080/new/` → 200, and live site md5s match the container
- [ ] Real-device flash on Heltec v3: full flash completes (progress to 100%), device boots
- [ ] Real-device flash without BOOT held: 12 s timeout → clear manual-entry dialog → flash succeeds after manual entry
- [ ] Apply settings: all commands return `OK`; topic root stored as `meshcore/{IATA}/{PUBLIC_KEY}/packets`
- [ ] Verify step: every applied setting read back ✓
- [ ] Log pane contains no plaintext passwords/keys
- [ ] `Permissions-Policy` header present on `/new/` and `/`
- [ ] `git log` shows the v2 flasher commit; fresh clone rebuilds `/new/` correctly
- [ ] Cloudflare tunnel untouched; `cloudflared.service` still running
