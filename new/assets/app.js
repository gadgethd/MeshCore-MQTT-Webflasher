(() => {
  const $ = (id) => document.getElementById(id);

  /* ── Element refs ──────────────────────────── */
  const btnConnect = $("btn-connect");
  const serialStatus = $("serial-status");
  const fwVersion = $("fw-version");

  const step1 = $("step-1"), step2 = $("step-2"), step3 = $("step-3");
  const step4 = $("step-4"), step5 = $("step-5");

  const btnRead = $("btn-read-device");
  const btnUpload = $("btn-upload-backup");
  const btnDownload = $("btn-download-backup");
  const fileInput = $("backup-file");
  const captureSummary = $("capture-summary");
  const toStep2 = $("to-step-2");

  const boardSelect = $("board-select");
  const boardInfo = $("board-info");
  const backTo1 = $("back-to-1");
  const toStep3 = $("to-step-3");

  const radioPreset = $("radio-preset");
  const radioCustom = $("radio-custom");
  const radioFreq = $("radio-freq"), radioBw = $("radio-bw");
  const radioSf = $("radio-sf"), radioCr = $("radio-cr");
  const radioCmd = $("radio-cmd");
  const btnFlashFull = $("btn-flash-full");
  const btnFlashUpdate = $("btn-flash-update");
  const flashBar = $("flash-bar"), flashText = $("flash-text");
  const reconnectFlash = $("reconnect-flash");
  const btnReconnectFlash = $("btn-reconnect-flash");
  const backTo2 = $("back-to-2"), toStep4 = $("to-step-4");

  const cfgName = $("cfg-name"), cfgPrv = $("cfg-prv");
  const cfgGuest = $("cfg-guest"), cfgAdmin = $("cfg-admin");
  const cfgLat = $("cfg-lat"), cfgLon = $("cfg-lon");
  const cfgWifiSsid = $("cfg-wifi-ssid"), cfgWifiPass = $("cfg-wifi-pass");
  const cfgModel = $("cfg-model"), cfgClientVer = $("cfg-client-ver");
  const cfgRadioPreset = $("cfg-radio-preset");
  const cfgFreq = $("cfg-freq"), cfgBw = $("cfg-bw");
  const cfgSf = $("cfg-sf"), cfgCr = $("cfg-cr");
  const cfgRadioCmd = $("cfg-radio-cmd");
  const mqttBrokersEl = $("mqtt-brokers");

  const backTo3 = $("back-to-3"), toStep5 = $("to-step-5");

  const btnApplyAll = $("btn-apply-all"), btnReboot = $("btn-reboot");
  const applyLog = $("apply-log");
  const reconnectApply = $("reconnect-apply");
  const btnReconnectApply = $("btn-reconnect-apply");
  const btnVerify = $("btn-verify");
  const verifySummary = $("verify-summary");
  const backTo4 = $("back-to-4"), btnDone = $("btn-done");

  const logPane = $("log-pane");
  const btnCopyLog = $("btn-copy-log"), btnClearLog = $("btn-clear-log");
  const progressBar = $("progress-bar");
  const progressSteps = document.querySelectorAll(".step");

  const toastContainer = $("toast-container");

  /* ── Constants (mirrors original source-of-truth flasher) ── */
  const MQTT_MAX_BROKERS = 6;
  const FIRMWARE_FETCH_VERSION = "20260309-2102";

  // Default broker 1 credentials match the original flasher's prefill.
  const BROKER1_DEFAULTS = {
    uri: "wss://mqtt.ukmesh.com:443/",
    username: "observer",
    password: "observer-password"
  };

  const SENSITIVE_COMMAND_PREFIXES = [
    "set mqtt.wifi.pass ",
    "set prv.key ",
    "set guest.password ",
    "password "
  ];

  /* ── State ─────────────────────────────────── */
  let firmwareData = window.FIRMWARE_DATA || { boards: [] };
  let currentBoard = null;

  let serialPort = null;
  let serialReader = null;
  let serialReadBuffer = "";
  let serialTextDecoder = new TextDecoder();
  let serialLoopRunning = false;
  let lineListeners = [];
  let serialConnected = false;
  let serialConnectedAt = 0;
  let serialCliReady = false;
  let preferredSerialPortInfo = null;
  let scheduledSerialDisconnect = null;

  let captured = null;
  let flashComplete = false;
  let flashingNow = false;
  let applyingNow = false;
  let esptoolPromise = null;
  let logLines = [];

  /* ── Helpers ───────────────────────────────── */
  function safe(el, fn) { if (el) fn(el); }
  function maybe(v, fallback) { return (v !== undefined && v !== null) ? v : fallback; }
  function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toast(msg, kind = "info") {
    if (!toastContainer) return;
    const t = document.createElement("div");
    t.className = `toast toast--${kind}`;
    t.textContent = msg;
    toastContainer.appendChild(t);
    setTimeout(() => { t.remove(); }, 3200);
  }

  function log(line) {
    if (!logPane) { console.log("[log]", line); return; }
    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
    const p = document.createElement("div");
    p.textContent = `[${ts}] ${line}`;
    logPane.appendChild(p);
    logPane.scrollTop = logPane.scrollHeight;
    logLines.push(p.textContent);
    const preview = $("log-preview");
    if (preview) preview.textContent = line;
    if (logLines.length > 500) {
      logLines.shift();
      if (logPane.firstChild) logPane.removeChild(logPane.firstChild);
    }
  }
  // appendLog mirrors the original flasher's logger name so ported routines read 1:1.
  const appendLog = log;

  function clearLog() { if (logPane) logPane.innerHTML = ""; logLines = []; }

  function ok(msg) { log("OK: " + msg); toast(msg, "success"); }
  function fail(msg) { log("FAIL: " + msg); toast(msg, "error"); }

  window.addEventListener("error", (e) => { try { log("JS error: " + (e.message || e)); } catch (_) {} });
  window.addEventListener("unhandledrejection", (e) => {
    try { log("Unhandled: " + (e.reason && (e.reason.message || e.reason) || e.reason)); } catch (_) {}
  });

  /* ── Log buttons ───────────────────────────── */
  safe(btnClearLog, b => b.addEventListener("click", clearLog));
  safe(btnCopyLog, b => b.addEventListener("click", () => {
    navigator.clipboard.writeText(logLines.join("\n")).then(() => { toast("Log copied"); log("Log copied"); }).catch(() => {});
  }));

  /* ── Progress / steps ──────────────────────── */
  function setProgress(step) {
    if (progressSteps && progressSteps.length) {
      progressSteps.forEach(el => {
        const n = parseInt(el.dataset.step, 10);
        el.classList.toggle("active", n === step);
        el.classList.toggle("done", n < step);
      });
    }
    if (progressBar) progressBar.style.width = Math.round(((step - 1) / 4) * 100) + "%";
  }

  function showStep(n) {
    [step1, step2, step3, step4, step5].forEach((s, i) => { if (s) s.hidden = (i + 1 !== n); });
    setProgress(n);
    updateDisabledStates();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ── Collapsible live-output log ──────────── */
  function expandLog() {
    const body = $("log-body"), toggle = $("log-toggle");
    if (body) body.hidden = false;
    if (toggle) toggle.setAttribute("aria-expanded", "true");
  }

  /* ── Disabled-state logic ──────────────────── */
  function updateDisabledStates() {
    const hasBoard = !!currentBoard;
    const serial = serialConnected && !applyingNow && !flashingNow;
    const canFlash = hasBoard && !applyingNow && !flashingNow;

    const toggle = (el, cond) => { if (el) el.disabled = !cond; };

    toggle(btnFlashFull, canFlash);
    toggle(btnFlashUpdate, canFlash);
    toggle(btnRead, !applyingNow && !flashingNow);
    toggle(btnApplyAll, serial && hasBoard);
    toggle(btnVerify, serial);
    toggle(btnReboot, serial);
    toggle(toStep2, true);
    toggle(toStep3, hasBoard);
    toggle(toStep4, true);
    toggle(toStep5, hasBoard);
  }

  /* ── Serial: line-listener model (matches original) ── */
  function updateSerialUI(connected) {
    serialConnected = connected;
    if (serialStatus) serialStatus.classList.toggle("connected", connected);
    if (btnConnect) btnConnect.textContent = connected ? "Disconnect" : "Connect Serial";
    updateDisabledStates();
  }

  function notifyLineListeners(line) {
    const remaining = [];
    lineListeners.forEach((listener) => {
      if (listener.predicate(line)) { listener.resolve(line); return; }
      remaining.push(listener);
    });
    lineListeners = remaining;
  }

  function clearLineListeners(errorMessage) {
    const remaining = lineListeners;
    lineListeners = [];
    remaining.forEach((listener) => listener.reject(new Error(errorMessage)));
  }

  function maskSensitiveLine(line) {
    if (!line) return line;
    // Firmware echoes the new admin password in the reply to `password <new>`
    if (/password now:\s*\S+/i.test(line)) {
      return line.replace(/(password now:\s*)\S+/i, "$1********");
    }
    // Guard raw key/password readbacks (64-128 hex chars = prv.key blob)
    if (/^[0-9a-fA-F]{64,128}$/.test(String(line).trim())) return "********";
    return line;
  }

  function pushSerialLine(line) {
    if (!line.trim()) return;
    if (line.length < 300) log("[rx] " + maskSensitiveLine(line));
    notifyLineListeners(line);
  }

  function processSerialChunk(text) {
    serialReadBuffer += text.replace(/\r/g, "\n");
    const parts = serialReadBuffer.split("\n");
    serialReadBuffer = parts.pop() || "";
    parts.forEach((line) => pushSerialLine(line));
  }

  async function readSerialLoop() {
    if (!serialPort || serialLoopRunning) return;
    serialLoopRunning = true;
    while (serialPort && serialPort.readable) {
      try {
        serialReader = serialPort.readable.getReader();
        for (;;) {
          const { value, done } = await serialReader.read();
          if (done) break;
          if (value) processSerialChunk(serialTextDecoder.decode(value, { stream: true }));
        }
      } catch (error) {
        log("Serial read error: " + error.message);
        break;
      } finally {
        if (serialReader) { serialReader.releaseLock(); serialReader = null; }
      }
    }
    serialLoopRunning = false;
  }

  function waitForLine(predicate, timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const listener = {
        predicate,
        resolve: (line) => { clearTimeout(timer); resolve(line); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      };
      const timer = setTimeout(() => {
        lineListeners = lineListeners.filter((item) => item !== listener);
        reject(new Error("Timed out waiting for device response"));
      }, timeoutMs);
      lineListeners.push(listener);
    });
  }

  function samePortInfo(left, right) {
    if (!left || !right) return false;
    return left.usbVendorId === right.usbVendorId && left.usbProductId === right.usbProductId;
  }

  async function requestPreferredPort() {
    if (!("serial" in navigator)) throw new Error("Web Serial API is not available in this browser");
    if (preferredSerialPortInfo) {
      const knownPorts = await navigator.serial.getPorts();
      const matchingPort = knownPorts.find((port) => samePortInfo(port.getInfo(), preferredSerialPortInfo));
      if (matchingPort) {
        try {
          await matchingPort.open({ baudRate: 115200 });
          const usable = matchingPort.writable && matchingPort.readable;
          await matchingPort.close();
          if (usable) { log("Reusing the previously flashed serial port."); return matchingPort; }
        } catch (_err) { /* fall through to chooser */ }
        log("Previously flashed serial port is no longer usable. Showing all serial ports.");
        preferredSerialPortInfo = null;
      }
    }
    return navigator.serial.requestPort();
  }

  function finalizeSerialDisconnect({ silent = false } = {}) {
    serialPort = null;
    serialReader = null;
    serialConnected = false;
    serialConnectedAt = 0;
    serialCliReady = false;
    serialReadBuffer = "";
    serialLoopRunning = false;
    clearLineListeners("Serial port closed");
    updateSerialUI(false);
    if (!silent) log("Serial link closed.");
  }

  async function settleSerialOperation(operation, timeoutMs, warningLabel, silent) {
    const result = await Promise.race([
      operation().then(() => ({ status: "ok" })).catch((error) => ({ status: "error", error })),
      delay(timeoutMs).then(() => ({ status: "timeout" }))
    ]);
    if (result.status === "error" && !silent) log(`${warningLabel}: ${result.error.message}`);
    if (result.status === "timeout" && !silent) log(`${warningLabel}: timed out`);
  }

  function disconnectSerialSession({ silent = false } = {}) {
    if (!serialPort) return Promise.resolve();
    cancelScheduledSerialDisconnect();
    const portToClose = serialPort;
    const readerToCancel = serialReader;
    finalizeSerialDisconnect({ silent });
    return (async () => {
      if (readerToCancel) {
        await settleSerialOperation(() => readerToCancel.cancel(), 600, "Serial reader cancel warning", silent);
      }
      await settleSerialOperation(() => portToClose.close(), 900, "Serial port close warning", silent);
    })();
  }

  async function connectSerial() {
    if (!("serial" in navigator)) {
      alert("Web Serial not available. Use Chrome/Edge on desktop.");
      return;
    }
    if (serialConnected) { await disconnectSerialSession(); return; }
    try {
      serialPort = await requestPreferredPort();
      await serialPort.open({ baudRate: 115200 });
      if (!serialPort.writable || !serialPort.readable) {
        serialPort = null;
        throw new Error("Serial port opened but is not usable (device may be disconnected)");
      }
      cancelScheduledSerialDisconnect();
      serialConnectedAt = Date.now();
      serialCliReady = false;
      serialReadBuffer = "";
      serialTextDecoder = new TextDecoder();
      updateSerialUI(true);
      readSerialLoop();
      log("Serial link opened at 115200 baud.");
      log("Waiting for device console to settle.");
      await delay(1200);
      log("Serial console is ready.");
    } catch (e) {
      log("Serial connect failed: " + e.message);
    }
  }

  function cancelScheduledSerialDisconnect() {
    if (scheduledSerialDisconnect !== null) {
      clearTimeout(scheduledSerialDisconnect);
      scheduledSerialDisconnect = null;
    }
  }

  function scheduleSerialDisconnect(delayMs, message) {
    cancelScheduledSerialDisconnect();
    log(message);
    scheduledSerialDisconnect = setTimeout(() => {
      scheduledSerialDisconnect = null;
      disconnectSerialSession({ silent: true }).catch((error) => { log(`Serial disconnect warning: ${error.message}`); });
    }, delayMs);
  }

  /* ── Command write + reply handling (matches original) ── */
  async function writeSerialCommand(command) {
    if (!serialPort || !serialPort.writable) throw new Error("Serial port is not connected");
    const writer = serialPort.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode(`${command}\r\n`));
    } finally {
      writer.releaseLock();
    }
  }

  function maskSensitiveCommand(command) {
    if (/^set mqtt\.\d+\.password\s+/i.test(command)) {
      return command.replace(/^(set mqtt\.\d+\.password\s+).+$/i, "$1********");
    }
    const prefix = SENSITIVE_COMMAND_PREFIXES.find((value) => command.startsWith(value));
    if (!prefix) return command;
    return `${prefix}********`;
  }

  function commandText(entry) { return typeof entry === "string" ? entry : entry.command; }
  function logSerialCommand(command) { log(`> ${maskSensitiveCommand(command)}`); }

  function getCommandSettleDelay(command) {
    const trimmed = String(command || "").trim().toLowerCase();
    if (trimmed.startsWith("set prv.key ")) return 1400;
    if (trimmed.startsWith("set radio ")) return 900;
    if (trimmed.startsWith("set name ")) return 800;
    if (trimmed.startsWith("set guest.password ") || trimmed.startsWith("password ")) return 750;
    if (trimmed.startsWith("set lat ") || trimmed.startsWith("set lon ")) return 650;
    if (trimmed.startsWith("set mqtt.")) return 700;
    if (trimmed.startsWith("get ")) return 300;
    if (trimmed === "ver") return 300;
    if (trimmed === "reboot") return 300;
    return 450;
  }

  async function runCommandExpectReply(command, predicate = (value) => value.includes("->"), timeoutMs = 6000) {
    logSerialCommand(command);
    await writeSerialCommand(command);
    const line = await waitForLine(predicate, timeoutMs);
    log(`[match] ${line}`);
    await delay(getCommandSettleDelay(command));
    return line;
  }

  async function runCommandExpectOk(command, timeoutMs = 6000) {
    logSerialCommand(command);
    await writeSerialCommand(command);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const line = await waitForLine((value) => value.includes("->"), remaining);
      if (/->\s*OK\b/i.test(line)) {
        log(`[match] ${line}`);
        await delay(getCommandSettleDelay(command));
        return line;
      }
      if (/->\s*(ERR|ERROR|FAIL)\b/i.test(line)) {
        log(`[match] ${line}`);
        throw new Error(line);
      }
      log(`[skip] ${line}`);
    }
    throw new Error("Timed out waiting for OK response");
  }

  async function readSettingValue(key, timeoutMs = 6000) {
    const line = await runCommandExpectReply(`get ${key}`, (value) => value.includes("->"), timeoutMs);
    const match = line.match(/->\s*(.+)$/);
    const rawValue = match ? match[1].trim() : "";
    // Firmware replies to `get` as "  -> > value" — strip the leading ">" marker
    // (repeated, for safety) so values never carry it into the UI or backup.
    return { line, value: rawValue.replace(/^(?:>\s*)+/, "") };
  }

  async function readOptionalSettingValue(key, timeoutMs = 6000) {
    try {
      return await readSettingValue(key, timeoutMs);
    } catch (error) {
      log(`Readback warning for ${key}: ${error.message}`);
      return { line: "", value: "" };
    }
  }

  async function runCommands(commands) {
    for (const entry of commands) {
      if (typeof entry === "string") { await runCommandExpectOk(entry); continue; }
      if (entry.replyPredicate) {
        await runCommandExpectReply(entry.command, entry.replyPredicate, entry.timeoutMs || 6000);
        continue;
      }
      try {
        await runCommandExpectOk(entry.command, 4500);
      } catch (error) {
        if (!entry.verifyKey || !/Timed out waiting for device response/i.test(error.message)) throw error;
        log(`No immediate reply for ${maskSensitiveCommand(entry.command)}. Verifying saved value.`);
        const { value } = await readSettingValue(entry.verifyKey, 4500);
        if (value === entry.expectedValue) {
          log(`Verified ${entry.verifyKey} via readback.`);
          await delay(getCommandSettleDelay(entry.command));
          continue;
        }
        throw new Error(`${entry.verifyKey} did not match the requested value`);
      }
    }
  }

  async function ensureSerialCliReady() {
    if (serialCliReady) return;
    log("Checking MeshCore CLI availability.");
    try {
      const line = await runCommandExpectReply("ver", (value) => value.includes("->"), 4000);
      serialCliReady = true;
      log(`MeshCore CLI ready (${line}).`);
      return;
    } catch (error) {
      if (/serial\s*port/i.test(error.message)) throw error;
      log("No immediate reply to ver. Waiting 20 seconds before continuing.");
      await delay(20000);
      serialCliReady = true;
    }
  }

  /* ── Radio ─────────────────────────────────── */
  const RADIO_MAP = {
    EU_UK_RECOMMENDED:   { freq:"869.618", bw:"62.5",  sf:"8",  cr:"8"  },
    EU_UK_LONG_RANGE:     { freq:"869.525", bw:"250",   sf:"11", cr:"5"  },
    EU_UK_MEDIUM_RANGE:   { freq:"869.525", bw:"250",   sf:"10", cr:"5"  },
    US_CA_RECOMMENDED:    { freq:"910.525", bw:"62.5",  sf:"7",  cr:"5"  },
    AU_RECOMMENDED:       { freq:"915.800", bw:"250",   sf:"10", cr:"5"  },
    AU_VICTORIA:          { freq:"916.575", bw:"62.5",  sf:"7",  cr:"8"  },
    NZ_RECOMMENDED:       { freq:"917.375", bw:"250",   sf:"11", cr:"5"  },
    NZ_NARROW:            { freq:"917.375", bw:"62.5",  sf:"7",  cr:"5"  },
    CZECH_NARROW:         { freq:"869.525", bw:"62.5",  sf:"7",  cr:"5"  },
    EU_433_LONG_RANGE:    { freq:"433.650", bw:"250",   sf:"11", cr:"5"  },
    PORTUGAL_433:         { freq:"433.375", bw:"62.5",  sf:"9",  cr:"6"  },
    PORTUGAL_868:         { freq:"869.618", bw:"62.5",  sf:"7",  cr:"6"  },
    SWITZERLAND:          { freq:"869.618", bw:"62.5",  sf:"8",  cr:"8"  },
    VIETNAM:              { freq:"920.250", bw:"250",   sf:"11", cr:"5"  },
  };

  function getRadioFreq()  { return (radioFreq  && radioFreq.value)  || (cfgFreq  && cfgFreq.value)  || "869.618"; }
  function getRadioBw()    { return (radioBw    && radioBw.value)    || (cfgBw    && cfgBw.value)    || "62.5"; }
  function getRadioSf()    { return (radioSf    && radioSf.value)    || (cfgSf    && cfgSf.value)    || "8"; }
  function getRadioCr()    { return (radioCr    && radioCr.value)    || (cfgCr    && cfgCr.value)    || "8"; }
  function buildRadioStr() { return `${getRadioFreq()},${getRadioBw()},${getRadioSf()},${getRadioCr()}`; }

  function updateRadioCmd() {
    // Radio lives in the step-4 Configure panel; the old step-3 select is gone.
    const preset = (radioPreset && radioPreset.value) || (cfgRadioPreset && cfgRadioPreset.value) || "EU_UK_RECOMMENDED";
    const r = RADIO_MAP[preset];
    if (preset === "CUSTOM" || !r) {
      if (radioCustom) radioCustom.hidden = false;
    } else {
      if (radioCustom) radioCustom.hidden = true;
      // Step-3 inputs are gone; write preset values straight into the configure panel.
      if (radioFreq) radioFreq.value = r.freq; else if (cfgFreq) cfgFreq.value = r.freq;
      if (radioBw)   radioBw.value   = r.bw;   else if (cfgBw)   cfgBw.value   = r.bw;
      if (radioSf)   radioSf.value   = r.sf;   else if (cfgSf)   cfgSf.value   = r.sf;
      if (radioCr)   radioCr.value   = r.cr;   else if (cfgCr)   cfgCr.value   = r.cr;
    }
    const cmd = `set radio ${buildRadioStr()}`;
    if (radioCmd) radioCmd.textContent = cmd;

    // keep the configure panel in sync
    if (cfgRadioPreset) cfgRadioPreset.value = (preset === "CUSTOM" || !r) ? "CUSTOM" : preset;
    if (cfgFreq)  cfgFreq.value  = getRadioFreq();
    if (cfgBw)    cfgBw.value    = getRadioBw();
    if (cfgSf)    cfgSf.value    = getRadioSf();
    if (cfgCr)    cfgCr.value    = getRadioCr();
    if (cfgRadioCmd) cfgRadioCmd.textContent = buildRadioStr();
  }

  safe(radioPreset, el => el.addEventListener("change", updateRadioCmd));
  [radioFreq, radioBw, radioSf, radioCr].forEach(el => safe(el, e => e.addEventListener("input", updateRadioCmd)));
  safe(cfgRadioPreset, el => el.addEventListener("change", () => {
    if (radioPreset) radioPreset.value = cfgRadioPreset.value;
    updateRadioCmd();
  }));
  [cfgFreq, cfgBw, cfgSf, cfgCr].forEach(el => safe(el, e => e.addEventListener("input", () => {
    if (cfgRadioCmd) cfgRadioCmd.textContent = buildRadioStr();
  })));

  /* ── Topic helpers (matches original) ── */
  function currentTopicPublicKey({ allowPlaceholder = true } = {}) {
    const value = String((captured && captured.publicKey) || "").trim();
    if (value) return value;
    return allowPlaceholder ? "{PUBLIC_KEY}" : "";
  }

  function buildDefaultPacketsTopic(iata, publicKey = "{PUBLIC_KEY}") {
    const resolvedIata = String(iata || "").trim() || "{IATA}";
    const resolvedPublicKey = String(publicKey || "").trim() || "{PUBLIC_KEY}";
    return `meshcore/${resolvedIata}/${resolvedPublicKey}/packets`;
  }

  function deriveStatusTopic(topicRoot) {
    const normalized = String(topicRoot || "").trim().replace(/\/+$/, "");
    if (!normalized) return "";
    if (!/\/packets$/i.test(normalized)) return "";
    return normalized.replace(/\/packets$/i, "/status");
  }

  /* ── MQTT broker UI (collapsible cards) ───── */
  function buildMqttBrokerUI() {
    if (!mqttBrokersEl) return;
    mqttBrokersEl.innerHTML = "";
    for (let i = 1; i <= MQTT_MAX_BROKERS; i++) {
      const d = i === 1 ? BROKER1_DEFAULTS : { uri: "", username: "", password: "" };
      const card = document.createElement("div");
      card.className = "mqtt-card";
      card.innerHTML = `
        <div class="mqtt-card__head" data-broker-toggle="${i}">
          <h4>Broker ${i}</h4>
          <span class="mqtt-card__status mqtt-card__status--off" data-broker-status="${i}">Empty</span>
        </div>
        <div class="mqtt-card__body">
          <div class="mqtt-grid">
            <div class="field field-full"><label>URI</label><input data-broker="${i}" data-k="uri" type="text" placeholder="mqtt://host:1883" value="${escapeHtml(d.uri)}"></div>
            <div class="field"><label>Username</label><input data-broker="${i}" data-k="username" type="text" value="${escapeHtml(d.username)}"></div>
            <div class="field"><label>Password</label><input data-broker="${i}" data-k="password" type="password" value="${escapeHtml(d.password)}"></div>
            <div class="field"><label>IATA</label><input data-broker="${i}" data-k="iata" type="text" value="LHR" maxlength="16"></div>
            <div class="field field-full checkbox-label">
              <input type="checkbox" data-broker="${i}" data-k="defaultTopic" checked>
              <span>Use default topic root&nbsp;<code>meshcore/{IATA}/{PUBLIC_KEY}/packets</code></span>
            </div>
            <div class="field field-full"><label>Topic Root</label><input data-broker="${i}" data-k="topicRoot" type="text" value="meshcore/{IATA}/{PUBLIC_KEY}/packets" disabled></div>
            <div class="field">
              <label>Retain Status</label>
              <select data-broker="${i}" data-k="retain">
                <option value="0" selected>Off</option>
                <option value="1">On</option>
              </select>
            </div>
          </div>
        </div>`;
      mqttBrokersEl.appendChild(card);
    }

    // Toggle card open/close
    mqttBrokersEl.querySelectorAll("[data-broker-toggle]").forEach(head => {
      head.addEventListener("click", () => { head.parentElement.classList.toggle("mqtt-card--open"); });
    });

    // Default topic checkboxes
    mqttBrokersEl.querySelectorAll('input[type="checkbox"][data-k="defaultTopic"]').forEach(chk => {
      const i = chk.dataset.broker;
      const topicInput = mqttBrokersEl.querySelector(`input[data-broker="${i}"][data-k="topicRoot"]`);
      const iataInput  = mqttBrokersEl.querySelector(`input[data-broker="${i}"][data-k="iata"]`);
      const update = () => {
        if (chk.checked) {
          const iata = (iataInput && iataInput.value) || "{IATA}";
          if (topicInput) { topicInput.value = buildDefaultPacketsTopic(iata); topicInput.disabled = true; }
        } else {
          if (topicInput) topicInput.disabled = false;
        }
      };
      chk.addEventListener("change", update);
      if (iataInput) iataInput.addEventListener("input", () => { if (chk.checked) update(); });
      update();
    });

    // Update broker status badge on URI change
    mqttBrokersEl.querySelectorAll('input[data-k="uri"]').forEach(inp => {
      inp.addEventListener("input", () => {
        const i = inp.dataset.broker;
        const badge = mqttBrokersEl.querySelector(`[data-broker-status="${i}"]`);
        if (badge) {
          const has = inp.value.trim();
          badge.textContent = has ? "Active" : "Empty";
          badge.className = `mqtt-card__status mqtt-card__status--${has ? "on" : "off"}`;
        }
      });
      inp.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Open broker 1 by default, close others
    const cards = mqttBrokersEl.querySelectorAll(".mqtt-card");
    cards.forEach((c, idx) => { if (idx === 0) c.classList.add("mqtt-card--open"); });
  }

  // Refresh default-topic previews when the captured public key changes.
  function refreshDefaultTopicInputs() {
    if (!mqttBrokersEl) return;
    mqttBrokersEl.querySelectorAll('input[type="checkbox"][data-k="defaultTopic"]').forEach(chk => {
      if (!chk.checked) return;
      const i = chk.dataset.broker;
      const topicInput = mqttBrokersEl.querySelector(`input[data-broker="${i}"][data-k="topicRoot"]`);
      const iataInput  = mqttBrokersEl.querySelector(`input[data-broker="${i}"][data-k="iata"]`);
      const iata = (iataInput && iataInput.value) || "{IATA}";
      if (topicInput) topicInput.value = buildDefaultPacketsTopic(iata);
    });
  }

  function getMqttFormBrokers() {
    const out = [];
    if (!mqttBrokersEl) return out;
    for (let i = 1; i <= MQTT_MAX_BROKERS; i++) {
      const q = (sel) => (mqttBrokersEl.querySelector(`[data-broker="${i}"]${sel}`) || {}).value || "";
      const uri = q('[data-k="uri"]').trim();
      const retain = (mqttBrokersEl.querySelector(`select[data-broker="${i}"][data-k="retain"]`) || {}).value || "0";
      const useDefault = !!(mqttBrokersEl.querySelector(`input[data-broker="${i}"][data-k="defaultTopic"]`) || {}).checked;
      const iata = q('[data-k="iata"]').trim();
      const topicRootInput = q('[data-k="topicRoot"]').trim();
      out.push({
        index: i,
        enabled: !!uri,
        uri,
        username: q('[data-k="username"]'),
        password: q('[data-k="password"]'),
        iata,
        useDefault,
        topicRootInput,
        retainStatus: String(retain)
      });
    }
    return out;
  }

  // Final topic root for a broker. The firmware expands {IATA} / {PUBLIC_KEY}
  // tokens at runtime from the device's actual identity, so we ALWAYS store the
  // template form. Display previews may resolve the key, but the stored value
  // must keep the placeholder so key rotation keeps topics correct.
  function brokerTopicRoot(b, { realPublicKey = true } = {}) {
    if (b.useDefault) {
      return buildDefaultPacketsTopic(b.iata);
    }
    return b.topicRootInput;
  }

  function applyCapturedToForm() {
    if (!captured) return;
    if (cfgName && captured.name) cfgName.value = captured.name;
    if (cfgLat && captured.lat) cfgLat.value = captured.lat;
    if (cfgLon && captured.lon) cfgLon.value = captured.lon;
    if (cfgPrv && captured.privateKey) cfgPrv.value = captured.privateKey;
    if (cfgGuest && captured.guestPassword) cfgGuest.value = captured.guestPassword;
    if (cfgWifiSsid && captured.wifiSsid) cfgWifiSsid.value = captured.wifiSsid;
    if (cfgWifiPass && captured.wifiPassword) cfgWifiPass.value = captured.wifiPassword;
    if (cfgModel && captured.model) cfgModel.value = captured.model;
    if (cfgClientVer && captured.clientVersion) cfgClientVer.value = captured.clientVersion;

    (captured.brokers || []).forEach(b => {
      if (!mqttBrokersEl) return;
      const set = (sel, val) => { const el = mqttBrokersEl.querySelector(`[data-broker="${b.index}"]${sel}`); if (el && val !== undefined) el.value = val; };
      set('[data-k="uri"]', b.uri);
      set('[data-k="username"]', b.username);
      set('[data-k="password"]', b.password);
      set('[data-k="iata"]', b.iata);
      const rS = mqttBrokersEl.querySelector(`select[data-broker="${b.index}"][data-k="retain"]`);
      if (rS) rS.value = String(b.retainStatus || "0");
      const tI = mqttBrokersEl.querySelector(`input[data-broker="${b.index}"][data-k="topicRoot"]`);
      const def = mqttBrokersEl.querySelector(`input[data-broker="${b.index}"][data-k="defaultTopic"]`);
      if (def && tI) {
        const isDefaultShape = /^meshcore\/[^/]+\/[^/]+\/packets$/i.test(String(b.topicRoot || ""));
        if (isDefaultShape || !b.topicRoot) {
          def.checked = true; tI.disabled = true;
          tI.value = b.topicRoot || buildDefaultPacketsTopic(b.iata || "{IATA}");
        } else {
          def.checked = false; tI.disabled = false; tI.value = b.topicRoot;
        }
      }
      const uriEl = mqttBrokersEl.querySelector(`input[data-broker="${b.index}"][data-k="uri"]`);
      if (uriEl) uriEl.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function prefillFromCaptureIfAny() { applyCapturedToForm(); }

  /* ── Build configuration plan (exact command surface) ─── */
  function buildPlan({ validatePrivateKey = true, requireMqtt = true } = {}) {
    const v = (el) => el && el.value ? el.value.trim() : "";
    const repeaterName = v(cfgName) || String((captured && captured.name) || "").trim();
    const privateKey = v(cfgPrv);
    const guestPassword = v(cfgGuest);
    const adminPassword = v(cfgAdmin);
    const latitude = v(cfgLat) || String((captured && captured.lat) || "").trim();
    const longitude = v(cfgLon) || String((captured && captured.lon) || "").trim();
    const sharedModel = v(cfgModel);
    const sharedClientVersion = v(cfgClientVer);
    const wifiSsid = cfgWifiSsid ? cfgWifiSsid.value : "";
    const wifiPassword = cfgWifiPass ? cfgWifiPass.value : "";

    const invalidNameChars = repeaterName.match(/[[\]\\:,?*]/g);
    if (repeaterName.length > 31) throw new Error("Repeater name must be 31 characters or fewer");
    if (invalidNameChars) {
      const uniqueChars = [...new Set(invalidNameChars)].join(" ");
      throw new Error(`Repeater name contains unsupported characters: ${uniqueChars}`);
    }
    if (validatePrivateKey && privateKey && !/^[0-9a-fA-F]{128}$/.test(privateKey)) {
      throw new Error("Private key must be exactly 128 hex characters");
    }
    if (guestPassword.length > 15) throw new Error("Guest password must be 15 characters or fewer");
    if (adminPassword.length > 15) throw new Error("Admin password must be 15 characters or fewer");
    if (latitude) {
      const parsed = Number.parseFloat(latitude);
      if (!Number.isFinite(parsed) || parsed < -90 || parsed > 90) throw new Error("Latitude must be a number between -90 and 90");
    }
    if (longitude) {
      const parsed = Number.parseFloat(longitude);
      if (!Number.isFinite(parsed) || parsed < -180 || parsed > 180) throw new Error("Longitude must be a number between -180 and 180");
    }

    const brokers = getMqttFormBrokers();
    const enabledDefaultTopicBrokers = brokers.filter((b) => b.enabled && b.useDefault);
    // NOTE: default topic roots are stored as templates (meshcore/{IATA}/{PUBLIC_KEY}/packets)
    // and expanded by the firmware at runtime, so no captured public key is required here.
    brokers.forEach((b) => {
      if (!b.enabled || String(b.retainStatus || "0") !== "1") return;
      const root = brokerTopicRoot(b);
      if (!deriveStatusTopic(root)) throw new Error(`Broker ${b.index} retain status needs a topic root ending in /packets`);
    });
    if (requireMqtt && (!brokers[0] || !brokers[0].uri)) {
      throw new Error("Primary MQTT URI is required");
    }

    const identity = [];
    if (repeaterName) identity.push(`set name ${repeaterName}`);
    if (latitude) identity.push(`set lat ${latitude}`);
    if (longitude) identity.push(`set lon ${longitude}`);

    const key = [];
    if (privateKey) key.push(`set prv.key ${privateKey}`);

    const auth = [];
    if (guestPassword) {
      auth.push({ command: `set guest.password ${guestPassword}`, verifyKey: "guest.password", expectedValue: guestPassword });
    }
    if (adminPassword) {
      auth.push({ command: `password ${adminPassword}`, timeoutMs: 5000, replyPredicate: (value) => /password now:/i.test(value) });
    }

    const wifi = [
      { command: `set mqtt.wifi.ssid ${wifiSsid}`, verifyKey: "mqtt.wifi.ssid", expectedValue: String(wifiSsid) },
      { command: `set mqtt.wifi.pass ${wifiPassword}`, verifyKey: "mqtt.wifi.pass", expectedValue: String(wifiPassword) }
    ];

    const mqtt = [
      ...(sharedModel ? [{ command: `set mqtt.model ${sharedModel}`, verifyKey: "mqtt.model", expectedValue: sharedModel }] : []),
      ...(sharedClientVersion ? [{ command: `set mqtt.client.version ${sharedClientVersion}`, verifyKey: "mqtt.client.version", expectedValue: sharedClientVersion }] : []),
      ...brokers.flatMap((b) => {
        if (!b.enabled) {
          return [{ command: `set mqtt.${b.index}.enabled 0`, verifyKey: `mqtt.${b.index}.enabled`, expectedValue: "0" }];
        }
        const topicRoot = brokerTopicRoot(b);
        return [
          { command: `set mqtt.${b.index}.uri ${b.uri}`, verifyKey: `mqtt.${b.index}.uri`, expectedValue: b.uri },
          { command: `set mqtt.${b.index}.username ${b.username}`, verifyKey: `mqtt.${b.index}.username`, expectedValue: b.username },
          { command: `set mqtt.${b.index}.password ${b.password}`, verifyKey: `mqtt.${b.index}.password`, expectedValue: b.password },
          { command: `set mqtt.${b.index}.topic.root ${topicRoot}`, verifyKey: `mqtt.${b.index}.topic.root`, expectedValue: topicRoot },
          { command: `set mqtt.${b.index}.iata ${b.iata}`, verifyKey: `mqtt.${b.index}.iata`, expectedValue: b.iata },
          { command: `set mqtt.${b.index}.retain.status ${b.retainStatus}`, verifyKey: `mqtt.${b.index}.retain.status`, expectedValue: b.retainStatus },
          { command: `set mqtt.${b.index}.enabled 1`, verifyKey: `mqtt.${b.index}.enabled`, expectedValue: "1" }
        ];
      })
    ];

    return { radio: [`set radio ${buildRadioStr()}`], identity, auth, wifi, key, mqtt, reboot: ["reboot"] };
  }

  /* ── Read device (capture) — matches original sequence ── */
  async function readDevice() {
    if (applyingNow || flashingNow) return;
    expandLog();
    const openedHere = !serialConnected;
    try {
      if (openedHere) {
        log("Opening serial to read the current device info.");
        await connectSerial();
        if (!serialConnected) { fail("Serial connection required to read device"); return; }
      }
      await ensureSerialCliReady();
      log("Reading current device settings...");

      const get = async (key) => (await readOptionalSettingValue(key)).value;

      const c = { brokers: [] };
      c.name = await get("name");
      c.publicKey = await get("public.key");
      c.lat = await get("lat");
      c.lon = await get("lon");
      c.privateKey = await get("prv.key");
      c.guestPassword = await get("guest.password");
      c.radio = await get("radio");
      c.wifiSsid = await get("mqtt.wifi.ssid");
      c.wifiPassword = await get("mqtt.wifi.pass");
      c.model = await get("mqtt.model");
      c.clientVersion = await get("mqtt.client.version");

      for (let i = 1; i <= MQTT_MAX_BROKERS; i++) {
        const b = { index: i, enabled: false, uri: "", username: "", password: "", topicRoot: "", iata: "", retainStatus: "0" };
        b.enabled = (await get(`mqtt.${i}.enabled`)) === "1";
        b.uri = await get(`mqtt.${i}.uri`);
        b.username = await get(`mqtt.${i}.username`);
        b.password = await get(`mqtt.${i}.password`);
        b.topicRoot = await get(`mqtt.${i}.topic.root`);
        b.iata = await get(`mqtt.${i}.iata`);
        b.retainStatus = (await get(`mqtt.${i}.retain.status`)) || "0";
        c.brokers.push(b);
      }

      // Legacy single-broker key fallback (matches original).
      const b0 = c.brokers[0];
      if (b0 && !b0.uri && !b0.username && !b0.password && !b0.topicRoot && !b0.iata) {
        log("No broker 1 values found in the new MQTT layout. Trying legacy MQTT keys.");
        const lUri = await get("mqtt.uri");
        const lUser = await get("mqtt.username");
        const lPass = await get("mqtt.password");
        const lTopic = await get("mqtt.topic.root");
        const lIata = await get("mqtt.iata");
        const lRetain = await get("mqtt.retain.status");
        c.brokers[0] = {
          index: 1,
          enabled: Boolean(lUri || lUser || lPass || lTopic || lIata),
          uri: lUri, username: lUser, password: lPass, topicRoot: lTopic, iata: lIata,
          retainStatus: lRetain || "0"
        };
      }

      c.capturedAt = new Date().toISOString();
      captured = c;
      renderCapture();
      refreshDefaultTopicInputs();
      applyCapturedToForm();
      if (btnDownload) btnDownload.disabled = false;
      ok("Device read complete");
    } catch (e) {
      fail("Read error: " + e.message);
    } finally {
      if (openedHere) {
        await disconnectSerialSession({ silent: true });
        log("Serial session closed after reading current device info.");
      }
    }
  }

  function renderCapture() {
    const grid = $("capture-grid");
    if (!captured) {
      if (captureSummary) captureSummary.hidden = true;
      if (grid) grid.hidden = true;
      return;
    }
    if (grid) grid.hidden = false;
    if (captureSummary) {
      captureSummary.hidden = false;
      captureSummary.innerHTML = "";
      const chips = [];
      if (captured.name) chips.push(`Name: ${captured.name}`);
      if (captured.lat) chips.push(`Lat: ${captured.lat}`);
      if (captured.lon) chips.push(`Lon: ${captured.lon}`);
      if (captured.privateKey) chips.push("Private key captured");
      if (captured.guestPassword) chips.push("Guest password captured");
      if (captured.wifiSsid) chips.push(`WiFi: ${captured.wifiSsid}`);
      const bc = (captured.brokers || []).filter(b => b.uri).length;
      if (bc) chips.push(`${bc} MQTT broker(s)`);
      chips.forEach(t => { const s = document.createElement("span"); s.className = "capture-chip"; s.textContent = t; captureSummary.appendChild(s); });
    }
    const set = (id, val) => { const el = $(id); if (el) el.textContent = val || "—"; };
    set("cap-name", captured.name);
    set("cap-lat", captured.lat);
    set("cap-lon", captured.lon);
    set("cap-prv", captured.privateKey ? (captured.privateKey.slice(0, 8) + "…") : "—");
    set("cap-guest", captured.guestPassword ? "captured" : "—");
    set("cap-wifi", captured.wifiSsid);
    set("cap-mqtt", (captured.brokers || []).filter(b => b.uri).length + " configured");
  }

  /* ── Backup file (format matches original flasher) ── */
  function snapshotForm() {
    const v = (el) => (el && el.value || "").trim();
    return {
      repeaterName: v(cfgName),
      privateKey: v(cfgPrv),
      guestPassword: v(cfgGuest),
      adminPassword: v(cfgAdmin),
      deviceLat: v(cfgLat),
      deviceLon: v(cfgLon),
      wifiSsid: v(cfgWifiSsid),
      wifiPassword: cfgWifiPass ? cfgWifiPass.value : "",
      model: v(cfgModel),
      clientVersion: v(cfgClientVer)
    };
  }

  function buildBackupFileContents() {
    const lines = [];
    const boardLabel = (currentBoard && currentBoard.label) || "Unknown board";
    const boardId = (currentBoard && currentBoard.id) || "unknown-board";

    lines.push(`Board: ${boardLabel}`);
    lines.push(`Board ID: ${boardId}`);
    lines.push(`Exported At: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("[Captured Device Values]");
    if (captured) {
      lines.push(`Captured At: ${captured.capturedAt || ""}`);
      lines.push(`Name: ${captured.name || ""}`);
      lines.push(`Public Key: ${captured.publicKey || ""}`);
      lines.push(`Latitude: ${captured.lat || ""}`);
      lines.push(`Longitude: ${captured.lon || ""}`);
      lines.push(`Private Key: ${captured.privateKey || ""}`);
      lines.push(`Guest Password: ${captured.guestPassword || ""}`);
      lines.push(`Radio: ${captured.radio || ""}`);
      lines.push(`WiFi SSID: ${captured.wifiSsid || ""}`);
      lines.push(`WiFi Password: ${captured.wifiPassword || ""}`);
      lines.push(`MQTT Model: ${captured.model || ""}`);
      lines.push(`MQTT Client Version: ${captured.clientVersion || ""}`);
      lines.push(`Additional Brokers: 0`);
      (captured.brokers || []).forEach((b) => {
        lines.push(`MQTT Broker ${b.index} Enabled: ${b.enabled ? "1" : "0"}`);
        lines.push(`MQTT Broker ${b.index} URI: ${b.uri || ""}`);
        lines.push(`MQTT Broker ${b.index} Username: ${b.username || ""}`);
        lines.push(`MQTT Broker ${b.index} Password: ${b.password || ""}`);
        lines.push(`MQTT Broker ${b.index} Topic Root: ${b.topicRoot || ""}`);
        lines.push(`MQTT Broker ${b.index} IATA: ${b.iata || ""}`);
        lines.push(`MQTT Broker ${b.index} Retain Status: ${b.retainStatus || ""}`);
      });
    } else {
      lines.push("No captured device values are stored for this board in this browser.");
    }

    lines.push("");
    lines.push("[Step 4 Values Saved In This Browser]");
    const f = snapshotForm();
    lines.push(`Repeater Name: ${f.repeaterName || ""}`);
    lines.push(`Private Key: ${f.privateKey || ""}`);
    lines.push(`Guest Password: ${f.guestPassword || ""}`);
    lines.push(`Admin Password: ${f.adminPassword || ""}`);
    lines.push(`Latitude: ${f.deviceLat || ""}`);
    lines.push(`Longitude: ${f.deviceLon || ""}`);
    lines.push(`WiFi SSID: ${f.wifiSsid || ""}`);
    lines.push(`WiFi Password: ${f.wifiPassword || ""}`);
    lines.push(`MQTT Model: ${f.model || ""}`);
    lines.push(`MQTT Client Version: ${f.clientVersion || ""}`);
    lines.push(`Additional Brokers: 0`);
    getMqttFormBrokers().forEach((b) => {
      const topicRoot = brokerTopicRoot(b);
      lines.push(`MQTT Broker ${b.index} Enabled: ${b.enabled ? "1" : "0"}`);
      lines.push(`MQTT Broker ${b.index} URI: ${b.uri || ""}`);
      lines.push(`MQTT Broker ${b.index} Username: ${b.username || ""}`);
      lines.push(`MQTT Broker ${b.index} Password: ${b.password || ""}`);
      lines.push(`MQTT Broker ${b.index} Topic Root: ${topicRoot || ""}`);
      lines.push(`MQTT Broker ${b.index} IATA: ${b.iata || ""}`);
      lines.push(`MQTT Broker ${b.index} Retain Status: ${b.retainStatus || "0"}`);
    });
    lines.push("");
    lines.push("Admin password cannot be read back from MeshCore CLI.");

    return `${lines.join("\n")}\n`;
  }

  function downloadBackup() {
    if (!captured && !currentBoard) { fail("Nothing to back up yet"); return; }
    const blob = new Blob([buildBackupFileContents()], { type: "text/plain;charset=utf-8" });
    const rawName = (captured && captured.name) || (cfgName && cfgName.value.trim()) || (currentBoard && currentBoard.id) || "device";
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${safeName}-backup-${timestamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    ok("Backup downloaded");
  }

  function parseBackupFile(text) {
    const lines = text.split(/\r?\n/);
    const result = { boardId: null, boardLabel: null, captured: null, step4: null };
    let section = "header";
    const capturedMap = {};
    const step4Map = {};
    const capturedBrokers = {};
    const step4Brokers = {};

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line === "[Captured Device Values]") { section = "captured"; continue; }
      if (line === "[Step 4 Values Saved In This Browser]") { section = "step4"; continue; }

      const colonIdx = line.indexOf(": ");
      if (colonIdx === -1) continue;
      const key = line.substring(0, colonIdx).trim();
      // Backups from older flasher builds can contain get-reply artifacts
      // ("Name: > MyNode") — strip the leading ">" marker so restores stay clean.
      const value = line.substring(colonIdx + 2).replace(/^(?:>\s*)+/, "");

      if (section === "header") {
        if (key === "Board") result.boardLabel = value;
        if (key === "Board ID") result.boardId = value;
      }

      const brokerMatch = key.match(/^MQTT Broker (\d+) (.+)$/);
      if (brokerMatch) {
        const idx = parseInt(brokerMatch[1], 10);
        const bKey = brokerMatch[2].toLowerCase().replace(/ /g, "");
        const bMap = section === "captured" ? capturedBrokers : section === "step4" ? step4Brokers : null;
        if (bMap) {
          if (!bMap[idx]) bMap[idx] = { index: idx };
          const keyMap = { enabled: "enabled", uri: "uri", username: "username", password: "password", topicroot: "topicRoot", iata: "iata", retainstatus: "retainStatus" };
          const nk = keyMap[bKey];
          if (nk) bMap[idx][nk] = nk === "enabled" ? value === "1" : value;
        }
        continue;
      }

      if (section === "captured") capturedMap[key] = value;
      else if (section === "step4") step4Map[key] = value;
    }

    if (Object.keys(capturedMap).length > 0) {
      result.captured = {
        name: capturedMap["Name"] || "",
        publicKey: capturedMap["Public Key"] || "",
        lat: capturedMap["Latitude"] || "",
        lon: capturedMap["Longitude"] || "",
        privateKey: capturedMap["Private Key"] || "",
        guestPassword: capturedMap["Guest Password"] || "",
        radio: capturedMap["Radio"] || "",
        wifiSsid: capturedMap["WiFi SSID"] || "",
        wifiPassword: capturedMap["WiFi Password"] || "",
        model: capturedMap["MQTT Model"] || "",
        clientVersion: capturedMap["MQTT Client Version"] || "",
        capturedAt: capturedMap["Captured At"] || new Date().toISOString(),
        brokers: Object.values(capturedBrokers).sort((a, b) => a.index - b.index)
      };
    }

    if (Object.keys(step4Map).length > 0) {
      result.step4 = {
        repeaterName: step4Map["Repeater Name"] || "",
        privateKey: step4Map["Private Key"] || "",
        guestPassword: step4Map["Guest Password"] || "",
        adminPassword: step4Map["Admin Password"] || "",
        deviceLat: step4Map["Latitude"] || "",
        deviceLon: step4Map["Longitude"] || "",
        wifiSsid: step4Map["WiFi SSID"] || "",
        wifiPassword: step4Map["WiFi Password"] || "",
        model: step4Map["MQTT Model"] || "",
        clientVersion: step4Map["MQTT Client Version"] || "",
        brokers: Object.values(step4Brokers).sort((a, b) => a.index - b.index)
      };
    }

    return result;
  }

  function applyStep4ToForm(step4) {
    if (!step4) return;
    const setVal = (el, val) => { if (el && val !== undefined && val !== null) el.value = val; };
    setVal(cfgName, step4.repeaterName);
    setVal(cfgPrv, step4.privateKey);
    setVal(cfgGuest, step4.guestPassword);
    setVal(cfgAdmin, step4.adminPassword);
    setVal(cfgLat, step4.deviceLat);
    setVal(cfgLon, step4.deviceLon);
    if (step4.wifiSsid) setVal(cfgWifiSsid, step4.wifiSsid);
    if (step4.wifiPassword) setVal(cfgWifiPass, step4.wifiPassword);
    if (step4.model) setVal(cfgModel, step4.model);
    if (step4.clientVersion) setVal(cfgClientVer, step4.clientVersion);
    (step4.brokers || []).forEach((b) => {
      if (!mqttBrokersEl) return;
      const set = (sel, val) => { const el = mqttBrokersEl.querySelector(`[data-broker="${b.index}"]${sel}`); if (el && val !== undefined) el.value = val; };
      set('[data-k="uri"]', b.uri);
      set('[data-k="username"]', b.username);
      set('[data-k="password"]', b.password);
      set('[data-k="iata"]', b.iata);
      const rS = mqttBrokersEl.querySelector(`select[data-broker="${b.index}"][data-k="retain"]`);
      if (rS && b.retainStatus !== undefined) rS.value = String(b.retainStatus);
      const tI = mqttBrokersEl.querySelector(`input[data-broker="${b.index}"][data-k="topicRoot"]`);
      const def = mqttBrokersEl.querySelector(`input[data-broker="${b.index}"][data-k="defaultTopic"]`);
      if (def && tI && b.topicRoot !== undefined) {
        const isDefaultShape = /^meshcore\/[^/]+\/[^/]+\/packets$/i.test(String(b.topicRoot || ""));
        if (isDefaultShape || !b.topicRoot) { def.checked = true; tI.disabled = true; tI.value = b.topicRoot || buildDefaultPacketsTopic(b.iata || "{IATA}"); }
        else { def.checked = false; tI.disabled = false; tI.value = b.topicRoot; }
      }
      const uriEl = mqttBrokersEl.querySelector(`input[data-broker="${b.index}"][data-k="uri"]`);
      if (uriEl) uriEl.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /* ── Board ──────────────────────────────────── */
  function populateBoards() {
    if (!boardSelect) return;
    boardSelect.innerHTML = "";
    (firmwareData.boards || []).forEach(b => {
      const opt = document.createElement("option");
      opt.value = b.id; opt.textContent = b.label;
      boardSelect.appendChild(opt);
    });
    boardSelect.onchange = () => setCurrentBoard((firmwareData.boards || []).find(x => x.id === boardSelect.value));
    if (firmwareData.boards.length) setCurrentBoard(firmwareData.boards[0]);
  }

  function setCurrentBoard(b) {
    currentBoard = b;
    const flashLabel = $("flash-board-label");
    if (flashLabel) flashLabel.textContent = b ? `${b.label} — ${b.firmwareVersion}` : "—";
    if (!boardInfo) return;
    if (!b) { boardInfo.innerHTML = ""; } else {
      const verified = String(b.hardwareStatus || "").toLowerCase().includes("verified");
      boardInfo.innerHTML =
        `<div><strong>${escapeHtml(b.label)}</strong> — ${escapeHtml(b.firmwareName)} ${escapeHtml(b.firmwareVersion)}</div>` +
        `<div class="muted">${escapeHtml(b.chipFamily)} • ${escapeHtml(b.hardwareStatus || "")}</div>` +
        (verified ? "" :
          `<div class="board-warning">⚠ This board is compile-validated only — hardware quirks may apply. Flash at your own risk.</div>`);
    }
    updateDisabledStates();
  }

  /* ── Flash (matches original esptool flow) ── */
  async function loadEspTool() {
    if (!esptoolPromise) {
      esptoolPromise = import(`./vendor/esptool-js-bundle.js?v=${FIRMWARE_FETCH_VERSION}`);
    }
    return esptoolPromise;
  }

  function resolveArtifactUrl(path) { return new URL(path, window.location.href).toString(); }

  async function fetchBinary(path) {
    const url = new URL(resolveArtifactUrl(path), window.location.href);
    url.searchParams.set("v", FIRMWARE_FETCH_VERSION);
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to fetch ${path} (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function blobToBinaryString(u8) {
    let result = "";
    for (let i = 0; i < u8.length; i++) result += String.fromCharCode(u8[i]);
    return result;
  }

  async function buildFlashArtifacts(board, kind) {
    const imageName = kind === "update" ? (board.artifacts.update || board.artifacts.full) : board.artifacts.full;
    const imagePath = `${board.artifactBase}${imageName}`;
    const imageData = await fetchBinary(imagePath);
    log(`Fetched ${imageName} (${imageData.byteLength} bytes).`);
    return [{
      imageName,
      label: kind,
      address: kind === "update" ? 0x10000 : 0x0,
      data: await blobToBinaryString(imageData)
    }];
  }

  function isSerialSignalFailure(error) {
    const message = String((error && error.message) || error || "");
    return /setSignals/i.test(message) || /control signals/i.test(message);
  }

  async function pulseEspReset(transport) {
    if (!transport || typeof transport.setRTS !== "function") return;
    await transport.setRTS(true);
    await delay(100);
    await transport.setRTS(false);
  }

  async function releaseFlashSession(transport, port) {
    if (transport && typeof transport.disconnect === "function") {
      await settleSerialOperation(() => transport.disconnect(), 1200, "Flash disconnect warning", false);
    }
    if (port && (port.readable || port.writable)) {
      await settleSerialOperation(() => port.close(), 1200, "Flash port close warning", false);
    }
    await delay(150);
  }

  async function withTimeout(promise, ms, msg) {
    const timer = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(msg || `Timed out after ${ms}ms`)), ms)
    );
    return Promise.race([promise, timer]);
  }

  function isSerialSignalFailure(error) {
    const message = String((error && error.message) || error || "");
    return /setSignals/i.test(message) || /control signals/i.test(message);
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
      const chip = await withTimeout(
        loader.main(),
        12000,
        "Timed out. Enter download mode: hold BOOT, tap RESET, release BOOT."
      );
      return { chip, loader, transport };
    } catch (error) {
      const needsManual = isSerialSignalFailure(error) ||
        /Timed out|Failed to connect|already open|InvalidStateError/i.test(String((error && error.message) || error));
      if (!needsManual) throw error;

      const usbVid = (port && typeof port.getInfo === "function" && port.getInfo().usbVendorId)
        ? port.getInfo().usbVendorId.toString(16) : "";
      const isNative = usbVid === "303a";
      log("Automatic bootloader entry failed — manual entry required.");
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
      try { await releaseFlashSession(transport, null); } catch (releaseError) { log(`Flash reconnect warning: ${releaseError.message}`); }
      await delay(2500);
      ({ transport, loader } = makeLoader());
      const chip = await withTimeout(
        loader.main("no_reset"),
        12000,
        "Still can't connect. Power-cycle the board and try again."
      );
      return { chip, loader, transport };
    }
  }

  function createFlashTerminal() {
    const out = (v) => { if (v !== undefined && v !== null && String(v).trim()) log("[flash] " + String(v).trim()); };
    return { clean() {}, clear() {}, write: out, writeLine: out, writeln: out, writeError: out };
  }

  async function flashFirmware(kind) {
    if (flashingNow) { log("Flash already in progress."); return; }
    expandLog();
    if (!currentBoard) { fail("Select a board first"); return; }
    if (!currentBoard.artifactBase || !currentBoard.chipFamily) { fail("Firmware artifact is not published for this board yet."); return; }
    if (!window.isSecureContext && location.hostname !== "127.0.0.1" && location.hostname !== "localhost") {
      fail("Flashing requires HTTPS or localhost"); return;
    }
    if (!("serial" in navigator)) { fail("Web Serial API is not available in this browser"); return; }

    flashingNow = true;
    updateDisabledStates();
    log(`Starting ${kind} flash for ${currentBoard.label}...`);
    let port = null;
    let transport = null;

    try {
      if (serialConnected) {
        log("Disconnecting the current serial session before flashing.");
        await disconnectSerialSession({ silent: true });
      }
      if (flashText) flashText.textContent = "Waiting for serial permission";
      log("Choose the board USB serial port in the browser prompt.");
      port = await navigator.serial.requestPort();
      if (typeof port.getInfo === "function") preferredSerialPortInfo = port.getInfo();
      log("Serial device selected for flashing.");

      const { ESPLoader, Transport, HardReset } = await loadEspTool();
      if (flashText) flashText.textContent = "Connecting to bootloader";

      const flashArtifacts = await buildFlashArtifacts(currentBoard, kind);
      log(kind === "update" ? `Prepared ${flashArtifacts.length} image for update flash.` : `Prepared ${flashArtifacts.length} image for full flash.`);

      const flashOptions = {
        debugLogging: false,
        terminal: createFlashTerminal(),
        baudrate: 115200,
        romBaudrate: 115200,
        flashSize: "keep",
        flashMode: "keep",
        flashFreq: "keep",
        eraseAll: kind === "full",
        compress: true,
        fileArray: flashArtifacts.map((artifact) => ({ data: artifact.data, address: artifact.address })),
        reportProgress(_fileIndex, written, total) {
          const percent = total > 0 ? Math.max(24, Math.min(98, Math.round((written / total) * 100))) : 24;
          if (flashBar) flashBar.style.width = percent + "%";
          if (flashText) flashText.textContent = `Writing ${kind} image... ${percent}%`;
        }
      };

      const connection = await connectBootloaderWithFallback({ ESPLoader, HardReset, Transport, port, flashOptions, boardLabel: currentBoard.label });
      const { chip, loader } = connection;
      transport = connection.transport;
      log(`Bootloader connected: ${chip || currentBoard.chipFamily}`);
      log("Reading flash identity.");
      await loader.flashId();
      if (kind === "full") log("Full image selected. Flash erase is enabled.");
      else log("Update selected. Writing the update image without a full erase.");
      await loader.writeFlash(flashOptions);
      await delay(100);
      if (typeof loader.after === "function") { await loader.after("hard_reset"); await delay(100); }
      await pulseEspReset(transport);

      flashComplete = true;
      if (flashBar) flashBar.style.width = "100%";
      if (flashText) flashText.textContent = "Flash complete";
      log(`Flash completed successfully for ${currentBoard.label}. Reconnect serial, then apply settings.`);
      if (reconnectFlash) reconnectFlash.hidden = false;
      ok(`Flash ${kind} complete`);
      showStep(4);
    } catch (e) {
      fail("Flash error: " + e.message);
    } finally {
      flashingNow = false;
      updateDisabledStates();
      setTimeout(() => {
        releaseFlashSession(transport, port)
          .then(() => log("Flash session released. The page is ready for serial reconnect."))
          .catch((error) => log(`Flash cleanup warning: ${error.message}`));
      }, 1600);
    }
  }

  /* ── Apply ──────────────────────────────────── */
  function addApplyLog(t) { if (applyLog) { applyLog.textContent += t + "\n"; applyLog.scrollTop = 99999; } }

  async function applyAll() {
    if (!serialConnected) { fail("Connect serial first"); return; }
    expandLog();
    if (!serialPort || !serialPort.writable || !serialPort.readable) {
      serialConnected = false; updateSerialUI(false);
      fail("Serial port is no longer usable. Reconnect serial before trying again.");
      return;
    }

    let plan;
    try { plan = buildPlan({ requireMqtt: true }); }
    catch (e) { fail(e.message); return; }

    applyingNow = true;
    updateDisabledStates();
    if (applyLog) applyLog.textContent = "";

    try {
      if (Date.now() - serialConnectedAt > 10000) {
        window.alert(
          "Make sure the device is turned on and the serial connection is stable.\n\n" +
          "If needed, press the reset button on the board before continuing.\n\n" +
          "Keep the board plugged in and avoid disconnecting it while settings are being applied."
        );
      }
      if (Date.now() - serialConnectedAt < 2500) {
        log("Allowing a short startup delay before sending the first CLI command.");
        await delay(800);
      }
      await ensureSerialCliReady();

      addApplyLog("--- Applying radio ---");
      await runCommandExpectOk(plan.radio[0], 10000);

      if (plan.identity.length) { addApplyLog("--- Applying identity ---"); await runCommands(plan.identity); }
      if (plan.auth.length) { addApplyLog("--- Applying passwords ---"); await runCommands(plan.auth); }
      addApplyLog("--- Applying WiFi ---"); await runCommands(plan.wifi);
      if (plan.key.length) { addApplyLog("--- Applying private key ---"); await runCommands(plan.key); }
      if (plan.mqtt.length) { addApplyLog("--- Applying MQTT ---"); await runCommands(plan.mqtt); }

      addApplyLog("--- Rebooting ---");
      logSerialCommand(plan.reboot[0]);
      await writeSerialCommand(plan.reboot[0]);

      if (reconnectApply) reconnectApply.hidden = false;
      ok("Settings applied. Device rebooted.");
      scheduleSerialDisconnect(2200, "Device configuration completed. Waiting for the reboot, then closing the serial session.");
    } catch (e) {
      addApplyLog("Error: " + e.message);
      fail("Apply error: " + e.message);
    } finally {
      applyingNow = false;
      updateDisabledStates();
    }
  }

  async function rebootDevice() {
    if (!serialConnected) { fail("Connect serial first"); return; }
    try {
      logSerialCommand("reboot");
      await writeSerialCommand("reboot");
      if (reconnectApply) reconnectApply.hidden = false;
      ok("Reboot sent");
      scheduleSerialDisconnect(2200, "Reboot sent. Waiting, then closing the serial session.");
    } catch (e) {
      fail("Reboot error: " + e.message);
    }
  }

  /* ── Verify (readback + compare) ── */
  function normalizeRadioValue(v) {
    // Firmware replies freq with 3 decimals and bw as ftoa3 — normalize floats.
    return String(v || "").trim().split(",").map(s => {
      const n = Number.parseFloat(s);
      return Number.isFinite(n) ? String(n) : s.trim();
    }).join(",");
  }

  async function verifyNow() {
    if (!serialConnected) { fail("Connect serial to verify"); return; }
    expandLog();
    if (verifySummary) verifySummary.innerHTML = "Reading...";
    const v = (el) => (el && el.value || "").trim();
    const brokers = getMqttFormBrokers();
    const norm = (x) => String(x || "").trim();
    try {
      await ensureSerialCliReady();
      const rows = [];
      const check = async (label, key, expected, opts = {}) => {
        const { value } = await readOptionalSettingValue(key);
        let match = expected == null || expected === "" ? null : (norm(value) === norm(expected));
        if (opts.normalize) match = expected == null || expected === "" ? null : (opts.normalize(value) === opts.normalize(expected));
        rows.push({ label, value: opts.mask && value ? "********" : value, match });
      };
      await check("Name", "name", v(cfgName) || (captured && captured.name));
      await check("Lat", "lat", v(cfgLat) || (captured && captured.lat));
      await check("Lon", "lon", v(cfgLon) || (captured && captured.lon));
      await check("Guest", "guest.password", v(cfgGuest), { mask: true });
      await check("Radio", "radio", buildRadioStr(), { normalize: normalizeRadioValue });
      await check("WiFi SSID", "mqtt.wifi.ssid", cfgWifiSsid ? cfgWifiSsid.value : "");
      await check("WiFi Pass", "mqtt.wifi.pass", cfgWifiPass ? cfgWifiPass.value : "", { mask: true });
      brokers.forEach((b, idx) => {
        if (!b.enabled) {
          check(`MQTT${idx + 1} Enabled`, `mqtt.${idx + 1}.enabled`, "0");
          return;
        }
        const root = brokerTopicRoot(b);
        check(`MQTT${idx + 1} URI`, `mqtt.${idx + 1}.uri`, b.uri);
        check(`MQTT${idx + 1} Topic`, `mqtt.${idx + 1}.topic.root`, root);
        check(`MQTT${idx + 1} IATA`, `mqtt.${idx + 1}.iata`, b.iata);
        check(`MQTT${idx + 1} Retain`, `mqtt.${idx + 1}.retain.status`, String(b.retainStatus));
        check(`MQTT${idx + 1} Enabled`, `mqtt.${idx + 1}.enabled`, "1");
      });
      if (verifySummary) {
        const matched = rows.filter(r => r.match === true).length;
        const failed = rows.filter(r => r.match === false).length;
        const skipped = rows.filter(r => r.match === null).length;
        verifySummary.innerHTML = rows.map((r) => {
          const mark = r.match === null ? "" : (r.match ? " <span class=\"ok\">✓</span>" : " <span class=\"bad\">✗</span>");
          return `<div>${escapeHtml(r.label)}: ${escapeHtml(r.value || "—")}${mark}</div>`;
        }).join("") +
        `<div class="verify-total">${matched} of ${rows.length - skipped} matched` + (failed ? ` — <span class="bad">${failed} mismatched</span>` : "") + `</div>`;
      }
    } catch (e) {
      if (verifySummary) verifySummary.textContent = "Verify failed: " + e.message;
    }
  }

  /* ── Wire all buttons (fully guarded) ──────── */
  safe(btnConnect, b => b.addEventListener("click", connectSerial));
  safe(btnRead, b => b.addEventListener("click", readDevice));
  safe(btnDownload, b => b.addEventListener("click", downloadBackup));
  safe(btnUpload, b => b.addEventListener("click", () => fileInput && fileInput.click()));
  safe(fileInput, fi => fi.addEventListener("change", async () => {
    const f = fi.files && fi.files[0]; if (!f) return;
    fi.value = "";
    try {
      const txt = await f.text();
      const parsed = parseBackupFile(txt);
      if (!parsed.captured && !parsed.step4) { fail("Could not parse backup file"); return; }
      let boardMatched = false;
      if (parsed.boardId) {
        const b = (firmwareData.boards || []).find(x => x.id === parsed.boardId);
        if (b && boardSelect) { boardSelect.value = b.id; setCurrentBoard(b); boardMatched = true; log(`Auto-selected board from backup: ${b.label}`); }
        else log(`Board "${parsed.boardId}" from backup not found in firmware list — select manually.`);
      }
      if (parsed.captured) { captured = parsed.captured; renderCapture(); refreshDefaultTopicInputs(); applyCapturedToForm(); if (btnDownload) btnDownload.disabled = false; }
      if (parsed.step4) applyStep4ToForm(parsed.step4);
      // The backup already carries the board + device settings, so skip straight to
      // Flash. Only fall back to board selection if the board could not be matched.
      if (boardMatched) {
        ok("Backup loaded — board and settings restored, skipping to Flash");
        showStep(3);
      } else {
        ok("Backup loaded — select your board to continue");
        showStep(2);
      }
    } catch (err) {
      fail("Failed to load backup file: " + err.message);
    }
  }));

  safe(toStep2, b => b.addEventListener("click", () => showStep(2)));
  safe(backTo1, b => b.addEventListener("click", () => showStep(1)));
  safe(toStep3, b => b.addEventListener("click", () => { if (!currentBoard) { fail("Select a board first"); return; } showStep(3); }));
  safe(backTo2, b => b.addEventListener("click", () => showStep(2)));
  safe(toStep4, b => b.addEventListener("click", () => { prefillFromCaptureIfAny(); showStep(4); }));
  safe(backTo3, b => b.addEventListener("click", () => showStep(3)));
  safe(toStep5, b => b.addEventListener("click", () => { if (!currentBoard) { fail("Select a board first"); return; } showStep(5); }));
  safe(backTo4, b => b.addEventListener("click", () => showStep(4)));

  // Clickable stepper: jump to any step from the progress bar.
  progressSteps.forEach(el => el.addEventListener("click", () => {
    const n = parseInt(el.dataset.step, 10);
    if (n >= 1 && n <= 5) showStep(n);
  }));

  // Collapsible live-output log.
  safe($("log-toggle"), b => b.addEventListener("click", () => {
    const body = $("log-body");
    if (!body) return;
    body.hidden = !body.hidden;
    b.setAttribute("aria-expanded", String(!body.hidden));
  }));

  safe(btnFlashFull, b => b.addEventListener("click", () => flashFirmware("full")));
  safe(btnFlashUpdate, b => b.addEventListener("click", () => flashFirmware("update")));
  safe(btnReconnectFlash, b => b.addEventListener("click", connectSerial));

  safe(btnApplyAll, b => b.addEventListener("click", applyAll));
  safe(btnReboot, b => b.addEventListener("click", rebootDevice));
  safe(btnReconnectApply, b => b.addEventListener("click", connectSerial));
  safe(btnVerify, b => b.addEventListener("click", verifyNow));
  safe(btnDone, b => b.addEventListener("click", () => {
    flashComplete = false;
    if (reconnectApply) reconnectApply.hidden = true;
    if (reconnectFlash) reconnectFlash.hidden = true;
    showStep(1);
  }));

  document.addEventListener("click", (e) => {
    const eye = e.target.closest && e.target.closest(".eye");
    if (!eye) return;
    const inp = $(eye.dataset.eye);
    if (inp) inp.type = inp.type === "password" ? "text" : "password";
  });

  /* ── Init ───────────────────────────────────── */
  function init() {
    try {
      if (fwVersion) fwVersion.textContent = maybe((firmwareData.boards && firmwareData.boards[0] && firmwareData.boards[0].firmwareVersion), "v1.16.0");
      populateBoards();
      buildMqttBrokerUI();
      updateRadioCmd();
      showStep(1);
      setTimeout(() => {
        if (cfgWifiSsid && !cfgWifiSsid.value) cfgWifiSsid.value = "UKMesh-Radio";
        if (cfgWifiPass && !cfgWifiPass.value) cfgWifiPass.value = "password123";
      }, 50);
      log("Ready. Connect your device via USB and use the steps above.");
    } catch (e) {
      console.error(e);
      try { log("Init error: " + e.message); } catch (_) {}
    }
  }

  window.__meshNewFlasher = {
    getCaptured: () => captured,
    getPlan: buildPlan,
    buildBackup: buildBackupFileContents,
    parseBackup: parseBackupFile
  };
  init();
})();
