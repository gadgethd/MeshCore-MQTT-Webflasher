const boardSelect = document.getElementById("board-select");
const boardTrigger = document.getElementById("board-trigger");
const boardTriggerLabel = document.getElementById("board-trigger-label");
const boardMenu = document.getElementById("board-menu");
const boardOptions = document.getElementById("board-options");
const boardSearch = document.getElementById("board-search");
const firmwareVersion = document.getElementById("firmware-version");
const firmwareFamily = document.getElementById("firmware-family");
const buildLabel = document.getElementById("build-label");
const flashPackage = document.getElementById("flash-package");
const hardwareCheck = document.getElementById("hardware-check");
const flashState = document.getElementById("flash-state");
const flashProgressBar = document.getElementById("flash-progress-bar");
const flashProgressText = document.getElementById("flash-progress-text");
const flashProgressPercent = document.getElementById("flash-progress-percent");
const artifactFullName = document.getElementById("artifact-full-name");
const artifactUpdateName = document.getElementById("artifact-update-name");
const deviceReadState = document.getElementById("device-read-state");
const captureDeviceButton = document.getElementById("capture-device-button");
const capturedName = document.getElementById("captured-name");
const capturedLat = document.getElementById("captured-lat");
const capturedLon = document.getElementById("captured-lon");
const capturedPrivateKey = document.getElementById("captured-private-key");
const capturedMeta = document.getElementById("captured-meta");
const prefillName = document.getElementById("prefill-name");
const prefillLat = document.getElementById("prefill-lat");
const prefillLon = document.getElementById("prefill-lon");
const prefillPrivateKey = document.getElementById("prefill-private-key");
const radioPreset = document.getElementById("radio-preset");
const radioFrequency = document.getElementById("radio-frequency");
const radioBandwidth = document.getElementById("radio-bandwidth");
const radioSf = document.getElementById("radio-sf");
const radioCr = document.getElementById("radio-cr");
const radioCommand = document.getElementById("radio-command");
const serialState = document.getElementById("serial-state");
const settingsState = document.getElementById("settings-state");
const verifyState = document.getElementById("verify-state");
const stateBoard = document.getElementById("state-board");
const stateFlash = document.getElementById("state-flash");
const stateSerial = document.getElementById("state-serial");
const stateMqtt = document.getElementById("state-mqtt");
const logPane = document.getElementById("log-pane");
const commandItems = document.querySelectorAll(".command-list__item");

const summaryFirmware = document.getElementById("summary-firmware");
const summarySerial = document.getElementById("summary-serial");
const summaryConfig = document.getElementById("summary-config");
const summaryMqtt = document.getElementById("summary-mqtt");

const flashButton = document.getElementById("flash-button");
const updateButton = document.getElementById("update-button");
const manifestButton = document.getElementById("manifest-button");
const serialButton = document.getElementById("serial-button");
const settingsApplyButton = document.getElementById("settings-apply-button");
const configureButton = document.getElementById("configure-button");
const reconnectButton = document.getElementById("reconnect-button");
const verifyButton = document.getElementById("verify-button");
const clearLogButton = document.getElementById("clear-log-button");
const settingsForm = document.getElementById("settings-form");
const commandPreviewPane = document.getElementById("command-preview-pane");
const repeaterNameInput = document.getElementById("repeater-name");
const privateKeyInput = document.getElementById("private-key");
const deviceLatInput = document.getElementById("device-lat");
const deviceLonInput = document.getElementById("device-lon");
const capSecure = document.getElementById("cap-secure");
const capSerial = document.getElementById("cap-serial");
const capUsb = document.getElementById("cap-usb");
const capManifest = document.getElementById("cap-manifest");

const firmwareData = window.FIRMWARE_DATA || { boards: [] };
const FIRMWARE_FETCH_VERSION = "20260309-2052";

let flashComplete = false;
let serialConnected = false;
let configApplied = false;
let currentBoard = null;
let serialPort = null;
let serialReader = null;
let serialReadBuffer = "";
let serialTextDecoder = new TextDecoder();
let lineListeners = [];
let serialLoopRunning = false;
let flashingNow = false;
let esptoolModulePromise = null;
let filteredBoards = [];
let serialConnectedAt = 0;
let serialCliReady = false;
let preferredSerialPortInfo = null;
let scheduledSerialDisconnect = null;
let capturedDeviceInfo = null;
let savedStep4Settings = null;
const boardManifestCache = new Map();

const RADIO_PRESETS = {
  US_NARROW: {
    label: "USA/Canada (Narrow)",
    frequency: "910.525",
    bandwidth: "62.5",
    sf: "7",
    cr: "5"
  },
  EU_NARROW: {
    label: "Europe (Narrow)",
    frequency: "869.525",
    bandwidth: "62.5",
    sf: "8",
    cr: "5"
  },
  AU_NZ: {
    label: "Australia/NZ",
    frequency: "916.8",
    bandwidth: "125",
    sf: "9",
    cr: "5"
  }
};

const SENSITIVE_COMMAND_PREFIXES = [
  "set mqtt.wifi.pass ",
  "set mqtt.password ",
  "set prv.key "
];

function humanFlashPackage(board) {
  if (!board) return "Unavailable";
  if (board.artifacts && board.artifacts.full && board.artifacts.update) {
    return "full + update";
  }
  return "full";
}

function resolveArtifactUrl(path) {
  return new URL(path, window.location.href).toString();
}

function browserCaptureKey(boardId) {
  return `meshcore-mqtt-device-info:${boardId}`;
}

function browserSettingsKey(boardId) {
  return `meshcore-mqtt-step4-settings:${boardId}`;
}

function maskPrivateKeyValue(value) {
  if (!value) return "Not captured";
  if (value.length <= 16) return "********";
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function formatCapturedValue(value) {
  return value ? value : "Not captured";
}

function formatCapturedTimestamp(timestamp) {
  if (!timestamp) return "Nothing captured in this browser for this board yet.";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Captured in this browser.";
  }
  return `Captured in this browser at ${date.toLocaleString("en-GB", { hour12: false })}.`;
}

function nearlyEqualDecimal(left, right, epsilon = 0.000001) {
  const leftValue = Number.parseFloat(left);
  const rightValue = Number.parseFloat(right);
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
    return false;
  }
  return Math.abs(leftValue - rightValue) <= epsilon;
}

function normalizeVerifyValue(value) {
  return String(value || "").trim();
}

function parseRadioValue(value) {
  const parts = String(value || "").split(",").map((part) => part.trim());
  return {
    frequency: parts[0] || "",
    bandwidth: parts[1] || "",
    sf: parts[2] || "",
    cr: parts[3] || ""
  };
}

function radioValuesMatch(actual, expected) {
  return (
    nearlyEqualDecimal(actual.frequency, expected.frequency) &&
    nearlyEqualDecimal(actual.bandwidth, expected.bandwidth) &&
    normalizeVerifyValue(actual.sf) === normalizeVerifyValue(expected.sf) &&
    normalizeVerifyValue(actual.cr) === normalizeVerifyValue(expected.cr)
  );
}

function pushUniqueRetryCommand(target, entry) {
  if (!entry) return;
  const command = typeof entry === "string" ? entry : entry.command;
  const exists = target.some((item) => (typeof item === "string" ? item : item.command) === command);
  if (!exists) {
    target.push(entry);
  }
}

function renderCapturedDeviceInfo(info) {
  const nameValue = formatCapturedValue(info?.name || "");
  const latValue = formatCapturedValue(info?.lat || "");
  const lonValue = formatCapturedValue(info?.lon || "");
  const keyValue = info?.privateKey ? maskPrivateKeyValue(info.privateKey) : "Not captured";

  setText(capturedName, nameValue);
  setText(capturedLat, latValue);
  setText(capturedLon, lonValue);
  setText(capturedPrivateKey, keyValue);
  setText(prefillName, nameValue);
  setText(prefillLat, latValue);
  setText(prefillLon, lonValue);
  setText(prefillPrivateKey, keyValue);
  setText(capturedMeta, formatCapturedTimestamp(info?.capturedAt || ""));
}

function saveCapturedDeviceInfo(boardId, info) {
  try {
    window.localStorage.setItem(browserCaptureKey(boardId), JSON.stringify(info));
  } catch (error) {
    appendLog(`Browser storage warning: ${error.message}`);
  }
}

function loadCapturedDeviceInfo(boardId) {
  try {
    const raw = window.localStorage.getItem(browserCaptureKey(boardId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    appendLog(`Browser storage warning: ${error.message}`);
    return null;
  }
}

function readStep4SettingsFromForm() {
  const formData = new FormData(settingsForm);
  return {
    repeaterName: String(formData.get("repeaterName") || ""),
    privateKey: String(formData.get("privateKey") || ""),
    deviceLat: String(formData.get("deviceLat") || ""),
    deviceLon: String(formData.get("deviceLon") || ""),
    wifiSsid: String(formData.get("wifiSsid") || ""),
    wifiPassword: String(formData.get("wifiPassword") || ""),
    mqttUri: String(formData.get("mqttUri") || ""),
    mqttUsername: String(formData.get("mqttUsername") || ""),
    mqttPassword: String(formData.get("mqttPassword") || ""),
    topicRoot: String(formData.get("topicRoot") || ""),
    iata: String(formData.get("iata") || ""),
    model: String(formData.get("model") || ""),
    clientVersion: String(formData.get("clientVersion") || "")
  };
}

function saveStep4Settings(boardId, settings) {
  try {
    window.localStorage.setItem(browserSettingsKey(boardId), JSON.stringify(settings));
  } catch (error) {
    appendLog(`Browser storage warning: ${error.message}`);
  }
}

function loadStep4Settings(boardId) {
  try {
    const raw = window.localStorage.getItem(browserSettingsKey(boardId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    appendLog(`Browser storage warning: ${error.message}`);
    return null;
  }
}

function applySavedStep4SettingsToForm(settings) {
  if (!settings) return;

  repeaterNameInput.value = settings.repeaterName || repeaterNameInput.value || "";
  privateKeyInput.value = settings.privateKey || privateKeyInput.value || "";
  deviceLatInput.value = settings.deviceLat || deviceLatInput.value || "";
  deviceLonInput.value = settings.deviceLon || deviceLonInput.value || "";

  const fieldMap = {
    wifiSsid: "wifiSsid",
    wifiPassword: "wifiPassword",
    mqttUri: "mqttUri",
    mqttUsername: "mqttUsername",
    mqttPassword: "mqttPassword",
    topicRoot: "topicRoot",
    iata: "iata",
    model: "model",
    clientVersion: "clientVersion"
  };

  Object.entries(fieldMap).forEach(([key, fieldName]) => {
    const input = settingsForm.elements.namedItem(fieldName);
    if (input && typeof input.value === "string") {
      input.value = settings[key] || input.value || "";
    }
  });
}

function persistCurrentStep4Settings() {
  if (!currentBoard) return;
  savedStep4Settings = readStep4SettingsFromForm();
  saveStep4Settings(currentBoard.id, savedStep4Settings);
}

function applyCapturedDeviceInfoToForm(info) {
  if (!info) return;
  repeaterNameInput.value = info.name || "";
  privateKeyInput.value = info.privateKey || "";
  deviceLatInput.value = info.lat || "";
  deviceLonInput.value = info.lon || "";
}

function setBoardDetails(board) {
  currentBoard = board;
  if (!board) return;

  boardTriggerLabel.textContent = board.label;
  stateBoard.textContent = board.label;
  firmwareVersion.textContent = board.firmwareVersion;
  firmwareFamily.textContent = board.firmwareName;
  buildLabel.textContent = board.firmwareVersion;
  flashPackage.textContent = humanFlashPackage(board);
  hardwareCheck.textContent = board.hardwareStatus;
  artifactFullName.textContent = board.artifacts.full;
  artifactUpdateName.textContent = board.artifacts.update || board.artifacts.full;
  capManifest.textContent = board.manifestPath ? "Board manifest" : "Catalog fallback";
  capturedDeviceInfo = loadCapturedDeviceInfo(board.id);
  savedStep4Settings = loadStep4Settings(board.id);
  renderCapturedDeviceInfo(capturedDeviceInfo);
  if (capturedDeviceInfo) {
    applyCapturedDeviceInfoToForm(capturedDeviceInfo);
    setPanelState(deviceReadState, "Loaded from browser", "panel__status--success");
  } else {
    setPanelState(deviceReadState, "Not read", "panel__status--idle");
  }
  if (savedStep4Settings) {
    applySavedStep4SettingsToForm(savedStep4Settings);
  }
  buildCommandPreview();

  const flashReady = Boolean(board.artifactBase && board.chipFamily);
  flashButton.disabled = !flashReady || flashingNow;
  updateButton.disabled = !flashReady || flashingNow;
  renderBoardOptions();
}

function populateBoards() {
  boardSelect.innerHTML = "";
  filteredBoards = [...firmwareData.boards];

  firmwareData.boards.forEach((board, index) => {
    const option = document.createElement("option");
    option.value = board.id;
    option.textContent = board.label;
    if (index === 0) option.selected = true;
    boardSelect.appendChild(option);
  });

  setBoardDetails(firmwareData.boards[0]);
}

function closeBoardMenu() {
  boardMenu.hidden = true;
  boardTrigger.setAttribute("aria-expanded", "false");
}

function openBoardMenu() {
  boardMenu.hidden = false;
  boardTrigger.setAttribute("aria-expanded", "true");
  boardSearch.focus();
  boardSearch.select();
}

function filterBoards(term) {
  const query = term.trim().toLowerCase();
  filteredBoards = firmwareData.boards.filter((board) =>
    board.label.toLowerCase().includes(query) || board.id.toLowerCase().includes(query)
  );
  renderBoardOptions();
}

function renderBoardOptions() {
  boardOptions.innerHTML = "";

  if (filteredBoards.length === 0) {
    const empty = document.createElement("div");
    empty.className = "board-combobox__empty";
    empty.textContent = "No boards match that filter.";
    boardOptions.appendChild(empty);
    return;
  }

  filteredBoards.forEach((board) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "board-combobox__option";
    if (currentBoard && currentBoard.id === board.id) {
      option.classList.add("is-selected");
    }
    option.textContent = board.label;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", currentBoard && currentBoard.id === board.id ? "true" : "false");
    option.addEventListener("click", () => {
      boardSelect.value = board.id;
      setBoardDetails(board);
      appendLog(`Board selected: ${board.label}`);
      closeBoardMenu();
    });
    boardOptions.appendChild(option);
  });
}

function capabilityLabel(supported) {
  return supported ? "Available" : "Unavailable";
}

function evaluateCapabilities() {
  const secureContext = window.isSecureContext || location.hostname === "127.0.0.1" || location.hostname === "localhost";
  const webSerialAvailable = "serial" in navigator;

  capSecure.textContent = capabilityLabel(secureContext);
  capSerial.textContent = capabilityLabel(webSerialAvailable);
  capUsb.textContent = capabilityLabel(secureContext && webSerialAvailable);

  if (!secureContext) {
    appendLog("Browser check: flashing needs HTTPS or localhost.");
  }
  if (!webSerialAvailable) {
    appendLog("Browser check: Web Serial API not detected.");
  }
}

function updateSerialButton() {
  if (serialConnected) {
    serialButton.textContent = "Disconnect Serial";
    return;
  }
  serialButton.textContent = flashComplete ? "Connect Serial" : "Connect Serial (After Flash)";
}

function notifyLineListeners(line) {
  const remaining = [];

  lineListeners.forEach((listener) => {
    if (listener.predicate(line)) {
      listener.resolve(line);
      return;
    }
    remaining.push(listener);
  });

  lineListeners = remaining;
}

function clearLineListeners(errorMessage) {
  const remaining = lineListeners;
  lineListeners = [];
  remaining.forEach((listener) => listener.reject(new Error(errorMessage)));
}

function samePortInfo(left, right) {
  if (!left || !right) return false;
  return left.usbVendorId === right.usbVendorId && left.usbProductId === right.usbProductId;
}

async function requestPreferredPort() {
  if (!("serial" in navigator)) {
    throw new Error("Web Serial API is not available in this browser");
  }

  if (preferredSerialPortInfo) {
    const knownPorts = await navigator.serial.getPorts();
    const matchingPort = knownPorts.find((port) => samePortInfo(port.getInfo(), preferredSerialPortInfo));
    if (matchingPort) {
      appendLog("Reusing the previously flashed serial port.");
      return matchingPort;
    }
  }

  const filters = preferredSerialPortInfo ? [preferredSerialPortInfo] : undefined;
  return navigator.serial.requestPort(filters ? { filters } : undefined);
}

function pushSerialLine(line) {
  if (!line.trim()) return;
  appendLog(`[rx] ${line}`);
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
        if (value) {
          processSerialChunk(serialTextDecoder.decode(value, { stream: true }));
        }
      }
    } catch (error) {
      appendLog(`Serial read error: ${error.message}`);
      break;
    } finally {
      if (serialReader) {
        serialReader.releaseLock();
        serialReader = null;
      }
    }
  }

  serialLoopRunning = false;
}

function waitForLine(predicate, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const listener = {
      predicate,
      resolve: (line) => {
        clearTimeout(timer);
        resolve(line);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      }
    };

    const timer = setTimeout(() => {
      lineListeners = lineListeners.filter((item) => item !== listener);
      reject(new Error("Timed out waiting for device response"));
    }, timeoutMs);

    lineListeners.push(listener);
  });
}

function getRadioValues() {
  return {
    frequency: radioFrequency.value.trim(),
    bandwidth: radioBandwidth.value.trim(),
    sf: radioSf.value.trim(),
    cr: radioCr.value.trim()
  };
}

function buildRadioCommand() {
  const { frequency, bandwidth, sf, cr } = getRadioValues();
  return `set radio ${frequency},${bandwidth},${sf},${cr}`;
}

function syncRadioCommand() {
  radioCommand.textContent = buildRadioCommand();
}

function applyRadioPreset(presetKey) {
  const preset = RADIO_PRESETS[presetKey];
  if (!preset) return;
  radioFrequency.value = preset.frequency;
  radioBandwidth.value = preset.bandwidth;
  radioSf.value = preset.sf;
  radioCr.value = preset.cr;
  syncRadioCommand();
}

function updateRadioPresetFromInputs() {
  const { frequency, bandwidth, sf, cr } = getRadioValues();
  const matched = Object.entries(RADIO_PRESETS).find(([, preset]) =>
    preset.frequency === frequency &&
    preset.bandwidth === bandwidth &&
    preset.sf === sf &&
    preset.cr === cr
  );
  radioPreset.value = matched ? matched[0] : "CUSTOM";
  syncRadioCommand();
}

function buildConfigurationPlan({ validatePrivateKey = true } = {}) {
  const formData = new FormData(settingsForm);
  const repeaterName = String(repeaterNameInput?.value || "").trim() || String(capturedDeviceInfo?.name || "").trim();
  const currentPrivateKey = String(capturedDeviceInfo?.privateKey || "").trim();
  const privateKey = String(privateKeyInput?.value || "").trim() || currentPrivateKey;
  const latitude = String(deviceLatInput?.value || "").trim() || String(capturedDeviceInfo?.lat || "").trim();
  const longitude = String(deviceLonInput?.value || "").trim() || String(capturedDeviceInfo?.lon || "").trim();
  const invalidNameChars = repeaterName.match(/[[\]\\:,?*]/g);

  if (repeaterName.length > 31) {
    throw new Error("Repeater name must be 31 characters or fewer");
  }
  if (invalidNameChars) {
    const uniqueChars = [...new Set(invalidNameChars)].join(" ");
    throw new Error(`Repeater name contains unsupported characters: ${uniqueChars}`);
  }

  if (validatePrivateKey && privateKey && !/^[0-9a-fA-F]{128}$/.test(privateKey)) {
    throw new Error("Private key must be exactly 128 hex characters");
  }
  if (latitude) {
    const parsedLat = Number.parseFloat(latitude);
    if (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      throw new Error("Latitude must be a number between -90 and 90");
    }
  }
  if (longitude) {
    const parsedLon = Number.parseFloat(longitude);
    if (!Number.isFinite(parsedLon) || parsedLon < -180 || parsedLon > 180) {
      throw new Error("Longitude must be a number between -180 and 180");
    }
  }

  const identityCommands = [];
  if (repeaterName) {
    identityCommands.push(`set name ${repeaterName}`);
  }
  if (latitude) {
    identityCommands.push(`set lat ${latitude}`);
  }
  if (longitude) {
    identityCommands.push(`set lon ${longitude}`);
  }
  const keyCommands = [];
  if (privateKey) {
    keyCommands.push(`set prv.key ${privateKey}`);
  }

  return {
    radio: [buildRadioCommand()],
    identity: identityCommands,
    wifi: [
      {
        command: `set mqtt.wifi.ssid ${formData.get("wifiSsid") || ""}`,
        verifyKey: "mqtt.wifi.ssid",
        expectedValue: String(formData.get("wifiSsid") || "")
      },
      {
        command: `set mqtt.wifi.pass ${formData.get("wifiPassword") || ""}`,
        verifyKey: "mqtt.wifi.pass",
        expectedValue: String(formData.get("wifiPassword") || "")
      }
    ],
    mqtt: [
      {
        command: `set mqtt.uri ${formData.get("mqttUri") || ""}`,
        verifyKey: "mqtt.uri",
        expectedValue: String(formData.get("mqttUri") || "")
      },
      {
        command: `set mqtt.username ${formData.get("mqttUsername") || ""}`,
        verifyKey: "mqtt.username",
        expectedValue: String(formData.get("mqttUsername") || "")
      },
      {
        command: `set mqtt.password ${formData.get("mqttPassword") || ""}`,
        verifyKey: "mqtt.password",
        expectedValue: String(formData.get("mqttPassword") || "")
      },
      {
        command: `set mqtt.topic.root ${formData.get("topicRoot") || ""}`,
        verifyKey: "mqtt.topic.root",
        expectedValue: String(formData.get("topicRoot") || "")
      },
      {
        command: `set mqtt.iata ${formData.get("iata") || ""}`,
        verifyKey: "mqtt.iata",
        expectedValue: String(formData.get("iata") || "")
      },
      {
        command: `set mqtt.model ${formData.get("model") || ""}`,
        verifyKey: "mqtt.model",
        expectedValue: String(formData.get("model") || "")
      },
      {
        command: `set mqtt.client.version ${formData.get("clientVersion") || ""}`,
        verifyKey: "mqtt.client.version",
        expectedValue: String(formData.get("clientVersion") || "")
      }
    ],
    key: keyCommands,
    reboot: ["reboot"]
  };
}

function maskSensitiveCommand(command) {
  const prefix = SENSITIVE_COMMAND_PREFIXES.find((value) => command.startsWith(value));
  if (!prefix) return command;
  return `${prefix}********`;
}

function commandText(entry) {
  return typeof entry === "string" ? entry : entry.command;
}

function logSerialCommand(command) {
  appendLog(`> ${maskSensitiveCommand(command)}`);
}

function parseMqttConnectedLine(line) {
  const match = line.match(/mqtt\.connected\s*=\s*([^\s,;]+)/i);
  if (!match) return null;

  const value = match[1].replace(/[^\w.-]+$/g, "").toLowerCase();
  if (["true", "1", "yes", "on", "connected"].includes(value)) {
    return true;
  }
  if (["false", "0", "no", "off", "disconnected"].includes(value)) {
    return false;
  }
  return null;
}

async function writeSerialCommand(command) {
  if (!serialPort || !serialPort.writable) {
    throw new Error("Serial port is not connected");
  }

  const writer = serialPort.writable.getWriter();
  try {
    const payload = new TextEncoder().encode(`${command}\r\n`);
    await writer.write(payload);
  } finally {
    writer.releaseLock();
  }
}

function getCommandSettleDelay(command) {
  const trimmed = String(command || "").trim().toLowerCase();
  if (trimmed.startsWith("set prv.key ")) return 1400;
  if (trimmed.startsWith("set radio ")) return 900;
  if (trimmed.startsWith("set name ")) return 800;
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
  appendLog(`[match] ${line}`);
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
      appendLog(`[match] ${line}`);
      await delay(getCommandSettleDelay(command));
      return line;
    }
    if (/->\s*(ERR|ERROR|FAIL)\b/i.test(line)) {
      appendLog(`[match] ${line}`);
      throw new Error(line);
    }
    appendLog(`[skip] ${line}`);
  }

  throw new Error("Timed out waiting for OK response");
}

async function resetSerialConsole() {
  if (!serialPort || typeof serialPort.setSignals !== "function") {
    return false;
  }

  appendLog("CLI is silent. Triggering the official serial reset sequence.");
  await serialPort.setSignals({
    dataTerminalReady: false,
    requestToSend: true
  });
  await delay(250);
  await serialPort.setSignals({
    dataTerminalReady: false,
    requestToSend: false
  });
  await delay(1250);
  return true;
}

async function settleSerialOperation(operation, timeoutMs, warningLabel, silent) {
  const result = await Promise.race([
    operation().then(() => ({ status: "ok" })).catch((error) => ({ status: "error", error })),
    delay(timeoutMs).then(() => ({ status: "timeout" }))
  ]);

  if (result.status === "error" && !silent) {
    appendLog(`${warningLabel}: ${result.error.message}`);
  }
  if (result.status === "timeout" && !silent) {
    appendLog(`${warningLabel}: timed out`);
  }
}

function cancelScheduledSerialDisconnect() {
  if (scheduledSerialDisconnect !== null) {
    window.clearTimeout(scheduledSerialDisconnect);
    scheduledSerialDisconnect = null;
  }
}

function scheduleSerialDisconnect(delayMs, message) {
  cancelScheduledSerialDisconnect();
  appendLog(message);
  scheduledSerialDisconnect = window.setTimeout(() => {
    scheduledSerialDisconnect = null;
    disconnectSerialSession({ silent: true }).catch((error) => {
      appendLog(`Serial disconnect warning: ${error.message}`);
    });
  }, delayMs);
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
  updateSerialButton();
  setPanelState(serialState, "Serial disconnected", "panel__status--idle");
  setText(stateSerial, "Disconnected");
  setText(summarySerial, "Disconnected");
  setCommandState(0, "is-pending", "Pending");
  if (!silent) {
    appendLog("Serial link closed.");
  }
}

function disconnectSerialSession({ silent = false } = {}) {
  if (!serialPort) return Promise.resolve();
  cancelScheduledSerialDisconnect();

  const portToClose = serialPort;
  const readerToCancel = serialReader;
  finalizeSerialDisconnect({ silent });

  return (async () => {
    if (readerToCancel) {
      await settleSerialOperation(
        () => readerToCancel.cancel(),
        600,
        "Serial reader cancel warning",
        silent
      );
    }
    await settleSerialOperation(
      () => portToClose.close(),
      900,
      "Serial port close warning",
      silent
    );
  })();
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    throw new Error("Web Serial API is not available in this browser");
  }

  if (serialConnected) {
    await disconnectSerialSession();
    return;
  }

  serialPort = await requestPreferredPort();
  await serialPort.open({ baudRate: 115200 });
  cancelScheduledSerialDisconnect();
  serialConnectedAt = Date.now();
  serialConnected = true;
  serialCliReady = false;
  serialReadBuffer = "";
  serialTextDecoder = new TextDecoder();
  readSerialLoop();
  appendLog("Serial link opened at 115200 baud.");
  appendLog("Waiting for device console to settle.");
  await delay(1200);
  updateSerialButton();
  setPanelState(serialState, "Serial connected", "panel__status--connected");
  setText(stateSerial, "Connected");
  setText(summarySerial, "Connected at 115200");
  setCommandState(0, "is-done", "Connected");
  appendLog("Serial console is ready.");
}

function buildCommandPreview() {
  const plan = buildConfigurationPlan({ validatePrivateKey: false });
  const commands = [...plan.radio, ...plan.identity, ...plan.wifi, ...plan.mqtt, ...plan.key, ...plan.reboot];
  commandPreviewPane.textContent = commands.map((entry) => maskSensitiveCommand(commandText(entry))).join("\n");
}

function stamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function appendLog(message) {
  const line = document.createElement("p");
  const timestamp = document.createElement("span");
  timestamp.textContent = stamp();
  line.appendChild(timestamp);
  line.append(document.createTextNode(message));
  logPane.appendChild(line);
  logPane.scrollTop = logPane.scrollHeight;
}

function setText(target, value) {
  if (!target) return;
  target.textContent = value;
}

function setPanelState(target, text, variant) {
  if (!target) return;
  target.textContent = text;
  target.className = `panel__status ${variant}`;
}

function setCommandState(index, state, text) {
  const item = commandItems[index];
  if (!item) return;
  item.className = `command-list__item ${state}`;
  item.querySelector("strong").textContent = text;
}

function setFlashProgress(percent, text) {
  flashProgressBar.style.width = `${percent}%`;
  flashProgressPercent.textContent = `${percent}%`;
  flashProgressText.textContent = text;
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function countdownBeforeApply(seconds) {
  for (let remaining = seconds; remaining >= 1; remaining -= 1) {
    appendLog(`Applying settings in ${remaining} second${remaining === 1 ? "" : "s"}...`);
    await delay(1000);
  }
}

async function runCommands(commands) {
  for (const entry of commands) {
    if (typeof entry === "string") {
      await runCommandExpectOk(entry);
      continue;
    }

    try {
      await runCommandExpectOk(entry.command, 4500);
    } catch (error) {
      if (!entry.verifyKey || !/Timed out waiting for device response/i.test(error.message)) {
        throw error;
      }

      appendLog(`No immediate reply for ${maskSensitiveCommand(entry.command)}. Verifying saved value.`);
      const { value } = await readSettingValue(entry.verifyKey, 4500);
      if (value === entry.expectedValue) {
        appendLog(`Verified ${entry.verifyKey} via readback.`);
        await delay(getCommandSettleDelay(entry.command));
        continue;
      }
      throw new Error(`${entry.verifyKey} did not match the requested value`);
    }
  }
}

async function ensureSerialCliReady() {
  if (serialCliReady) return;

  appendLog("Checking MeshCore CLI availability.");
  try {
    const line = await runCommandExpectReply("ver", (value) => value.includes("->"), 4000);
    serialCliReady = true;
    appendLog(`MeshCore CLI ready (${line}).`);
    return;
  } catch (error) {
    appendLog("No immediate reply to ver. Waiting 20 seconds before continuing.");
    await delay(20000);
    serialCliReady = true;
  }
}

async function pulseEspReset(transport) {
  if (!transport || typeof transport.setRTS !== "function") {
    return;
  }
  await transport.setRTS(true);
  await delay(100);
  await transport.setRTS(false);
}

async function releaseFlashSession(transport, port) {
  if (transport && typeof transport.disconnect === "function") {
    await settleSerialOperation(
      () => transport.disconnect(),
      1200,
      "Flash disconnect warning",
      false
    );
  }

  if (port && (port.readable || port.writable)) {
    await settleSerialOperation(
      () => port.close(),
      1200,
      "Flash port close warning",
      false
    );
  }

  await delay(150);
}

async function readMqttStatus(timeoutMs = 8000) {
  logSerialCommand("show mqtt");
  await writeSerialCommand("show mqtt");
  const line = await waitForLine((value) => value.toLowerCase().includes("mqtt.connected="), timeoutMs);
  const connected = parseMqttConnectedLine(line);

  if (connected === null) {
    throw new Error(`Unrecognized MQTT status: ${line}`);
  }

  return { connected, line };
}

async function readSettingValue(key, timeoutMs = 6000) {
  const line = await runCommandExpectReply(`get ${key}`, (value) => value.includes("->"), timeoutMs);
  const match = line.match(/->\s*(.+)$/);
  const rawValue = match ? match[1].trim() : "";
  return {
    line,
    value: rawValue.replace(/^>\s*/, "")
  };
}

async function readOptionalSettingValue(key, timeoutMs = 6000) {
  try {
    return await readSettingValue(key, timeoutMs);
  } catch (error) {
    appendLog(`Readback warning for ${key}: ${error.message}`);
    return { line: "", value: "" };
  }
}

function buildExpectedVerifyState() {
  const formData = new FormData(settingsForm);
  return {
    radio: {
      frequency: normalizeVerifyValue(radioFrequency.value),
      bandwidth: normalizeVerifyValue(radioBandwidth.value),
      sf: normalizeVerifyValue(radioSf.value),
      cr: normalizeVerifyValue(radioCr.value)
    },
    name: normalizeVerifyValue(repeaterNameInput?.value) || normalizeVerifyValue(capturedDeviceInfo?.name),
    lat: normalizeVerifyValue(deviceLatInput?.value) || normalizeVerifyValue(capturedDeviceInfo?.lat),
    lon: normalizeVerifyValue(deviceLonInput?.value) || normalizeVerifyValue(capturedDeviceInfo?.lon),
    privateKey: normalizeVerifyValue(privateKeyInput?.value) || normalizeVerifyValue(capturedDeviceInfo?.privateKey),
    wifiSsid: normalizeVerifyValue(formData.get("wifiSsid")),
    wifiPassword: normalizeVerifyValue(formData.get("wifiPassword")),
    mqttUri: normalizeVerifyValue(formData.get("mqttUri")),
    mqttUsername: normalizeVerifyValue(formData.get("mqttUsername")),
    mqttPassword: normalizeVerifyValue(formData.get("mqttPassword")),
    topicRoot: normalizeVerifyValue(formData.get("topicRoot")),
    iata: normalizeVerifyValue(formData.get("iata")),
    model: normalizeVerifyValue(formData.get("model")),
    clientVersion: normalizeVerifyValue(formData.get("clientVersion"))
  };
}

async function verifyDeviceSettings() {
  const result = await collectVerificationResult(buildConfigurationPlan({ validatePrivateKey: false }));
  if (result.failures.length > 0) {
    const error = new Error(result.failures.join("; "));
    error.retryPlan = result.retryPlan;
    throw error;
  }
}

async function collectVerificationResult(plan) {
  const expected = buildExpectedVerifyState();
  const failures = [];
  const retryPlan = {
    radio: [],
    identity: [],
    wifi: [],
    mqtt: [],
    key: [],
    reconnectOnly: false,
    requiresReboot: false
  };

  const radioResult = await readSettingValue("radio");
  const actualRadio = parseRadioValue(radioResult.value);
  if (!radioValuesMatch(actualRadio, expected.radio)) {
    failures.push(`radio mismatch (device: ${radioResult.value})`);
    pushUniqueRetryCommand(retryPlan.radio, plan.radio[0]);
    retryPlan.requiresReboot = true;
  } else {
    appendLog("Verified radio settings.");
  }

  const checks = [
    { key: "name", expected: expected.name, label: "name", retryEntry: plan.identity.find((entry) => entry.startsWith("set name ")) },
    { key: "lat", expected: expected.lat, label: "latitude", numeric: true, retryEntry: plan.identity.find((entry) => entry.startsWith("set lat ")) },
    { key: "lon", expected: expected.lon, label: "longitude", numeric: true, retryEntry: plan.identity.find((entry) => entry.startsWith("set lon ")) },
    { key: "prv.key", expected: expected.privateKey, label: "private key", sensitive: true, retryEntry: plan.key[0], requiresReboot: true },
    { key: "mqtt.wifi.ssid", expected: expected.wifiSsid, label: "WiFi SSID", retryEntry: plan.wifi.find((entry) => entry.verifyKey === "mqtt.wifi.ssid") },
    { key: "mqtt.wifi.pass", expected: expected.wifiPassword, label: "WiFi password", sensitive: true, retryEntry: plan.wifi.find((entry) => entry.verifyKey === "mqtt.wifi.pass") },
    { key: "mqtt.uri", expected: expected.mqttUri, label: "MQTT URI", retryEntry: plan.mqtt.find((entry) => entry.verifyKey === "mqtt.uri") },
    { key: "mqtt.username", expected: expected.mqttUsername, label: "MQTT username", retryEntry: plan.mqtt.find((entry) => entry.verifyKey === "mqtt.username") },
    { key: "mqtt.password", expected: expected.mqttPassword, label: "MQTT password", sensitive: true, retryEntry: plan.mqtt.find((entry) => entry.verifyKey === "mqtt.password") },
    { key: "mqtt.topic.root", expected: expected.topicRoot, label: "MQTT topic root", retryEntry: plan.mqtt.find((entry) => entry.verifyKey === "mqtt.topic.root") },
    { key: "mqtt.iata", expected: expected.iata, label: "IATA", retryEntry: plan.mqtt.find((entry) => entry.verifyKey === "mqtt.iata") },
    { key: "mqtt.model", expected: expected.model, label: "model", retryEntry: plan.mqtt.find((entry) => entry.verifyKey === "mqtt.model") },
    { key: "mqtt.client.version", expected: expected.clientVersion, label: "client version", retryEntry: plan.mqtt.find((entry) => entry.verifyKey === "mqtt.client.version") }
  ];

  for (const check of checks) {
    if (!check.expected) {
      continue;
    }
    const result = await readSettingValue(check.key, 7000);
    const actualValue = normalizeVerifyValue(result.value);
    const matched = check.numeric
      ? nearlyEqualDecimal(actualValue, check.expected)
      : actualValue === normalizeVerifyValue(check.expected);
    if (!matched) {
      failures.push(
        `${check.label} mismatch (device: ${check.sensitive ? "********" : actualValue || "blank"})`
      );
      if (check.key.startsWith("mqtt.")) {
        pushUniqueRetryCommand(retryPlan[check.key.startsWith("mqtt.wifi.") ? "wifi" : "mqtt"], check.retryEntry);
      } else if (check.key === "prv.key") {
        pushUniqueRetryCommand(retryPlan.key, check.retryEntry);
      } else {
        pushUniqueRetryCommand(retryPlan.identity, check.retryEntry);
      }
      if (check.requiresReboot) {
        retryPlan.requiresReboot = true;
      }
    } else {
      appendLog(`Verified ${check.label}.`);
    }
  }

  const { connected } = await readMqttStatus();
  if (!connected) {
    failures.push("mqtt.connected=false");
    retryPlan.reconnectOnly = true;
  } else {
    appendLog("Verified mqtt.connected=true.");
  }

  return { failures, retryPlan };
}

async function reconnectSerialForRetry() {
  appendLog("Waiting for the device to reboot before verification.");
  await delay(3200);
  await disconnectSerialSession({ silent: true });
  appendLog("Reconnecting serial for verification.");
  await connectSerial();
  await ensureSerialCliReady();
}

async function applyRetryPlan(retryPlan) {
  const retryCommands = [
    ...retryPlan.radio.map(commandText),
    ...retryPlan.identity.map(commandText),
    ...retryPlan.wifi.map(commandText),
    ...retryPlan.mqtt.map(commandText),
    ...retryPlan.key.map(commandText),
    ...(retryPlan.reconnectOnly ? ["mqtt reconnect"] : [])
  ];

  if (retryCommands.length === 0) {
    appendLog("No retryable settings were identified.");
    return false;
  }

  appendLog(`Retrying only unsaved settings: ${retryCommands.map(maskSensitiveCommand).join(", ")}`);

  if (retryPlan.radio.length > 0) {
    await runCommands(retryPlan.radio);
  }
  if (retryPlan.identity.length > 0) {
    await runCommands(retryPlan.identity);
  }
  if (retryPlan.wifi.length > 0) {
    await runCommands(retryPlan.wifi);
  }
  if (retryPlan.mqtt.length > 0) {
    await runCommands(retryPlan.mqtt);
  }
  if (retryPlan.key.length > 0) {
    await runCommands(retryPlan.key);
  }
  if (retryPlan.reconnectOnly) {
    await runCommandExpectOk("mqtt reconnect", 8000);
  }

  return true;
}

async function captureCurrentDeviceInfo() {
  const openedHere = !serialConnected;

  try {
    if (openedHere) {
      appendLog("Opening serial to read the current device info.");
      await connectSerial();
    }

    await ensureSerialCliReady();
    setPanelState(deviceReadState, "Reading", "panel__status--busy");

    const nameResult = await readOptionalSettingValue("name");
    const latResult = await readOptionalSettingValue("lat");
    const lonResult = await readOptionalSettingValue("lon");
    const privateKeyResult = await readOptionalSettingValue("prv.key");

    const info = {
      name: nameResult.value,
      lat: latResult.value,
      lon: lonResult.value,
      privateKey: privateKeyResult.value,
      capturedAt: new Date().toISOString()
    };

    capturedDeviceInfo = info;
    saveCapturedDeviceInfo(currentBoard.id, info);
    renderCapturedDeviceInfo(info);
    applyCapturedDeviceInfoToForm(info);
    persistCurrentStep4Settings();
    buildCommandPreview();
    setPanelState(deviceReadState, "Captured", "panel__status--success");
    appendLog("Captured current device info and stored it in this browser for this board.");
  } finally {
    if (openedHere) {
      await disconnectSerialSession({ silent: true });
      appendLog("Serial session closed after reading current device info.");
    }
  }
}

async function loadEspTool() {
  if (!esptoolModulePromise) {
    esptoolModulePromise = import("/assets/vendor/esptool-js-bundle.js?v=20260308-1532");
  }
  return esptoolModulePromise;
}

function createFlashTerminal() {
  const logLine = (value) => {
    if (value === undefined || value === null) return;
    const text = String(value).trim();
    if (text) {
      appendLog(`[flash] ${text}`);
    }
  };

  return {
    clean() {},
    clear() {},
    write(value) {
      logLine(value);
    },
    writeLine(value) {
      logLine(value);
    },
    writeln(value) {
      logLine(value);
    },
    writeError(value) {
      logLine(value);
    }
  };
}

async function fetchBinary(path) {
  const url = new URL(resolveArtifactUrl(path), window.location.href);
  url.searchParams.set("v", FIRMWARE_FETCH_VERSION);
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path} (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchJson(path) {
  const url = new URL(resolveArtifactUrl(path), window.location.href);
  url.searchParams.set("v", FIRMWARE_FETCH_VERSION);
  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path} (${response.status})`);
  }
  return response.json();
}

async function loadBoardManifest(board) {
  if (!board?.manifestPath) return null;
  if (boardManifestCache.has(board.id)) {
    return boardManifestCache.get(board.id);
  }

  const manifest = await fetchJson(board.manifestPath);
  boardManifestCache.set(board.id, manifest);
  return manifest;
}

function parseFlashOffset(offset) {
  if (typeof offset === "number") return offset;
  if (typeof offset !== "string") {
    throw new Error("Invalid flash offset in manifest");
  }

  const trimmed = offset.trim().toLowerCase();
  return trimmed.startsWith("0x") ? Number.parseInt(trimmed, 16) : Number.parseInt(trimmed, 10);
}

async function buildFlashArtifacts(board, kind) {
  const imageName = kind === "update" ? (board.artifacts.update || board.artifacts.full) : board.artifacts.full;
  const imagePath = `${board.artifactBase}${imageName}`;
  const imageData = await fetchBinary(imagePath);
  appendLog(`Fetched ${imageName} (${imageData.byteLength} bytes).`);
  return [
    {
      imageName,
      label: kind,
      address: kind === "update" ? 0x10000 : 0x0,
      data: await blobToBinaryString(new Blob([imageData]))
    }
  ];
}

async function blobToBinaryString(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let result = "";
  for (let index = 0; index < bytes.length; index += 1) {
    result += String.fromCharCode(bytes[index]);
  }
  return result;
}

async function flashFirmware(kind) {
  if (flashingNow) {
    appendLog("Flash already in progress.");
    return;
  }
  if (!currentBoard?.artifactBase || !currentBoard?.chipFamily) {
    appendLog("Firmware artifact is not published for this board yet.");
    return;
  }
  if (!window.isSecureContext && location.hostname !== "127.0.0.1" && location.hostname !== "localhost") {
    throw new Error("Flashing requires HTTPS or localhost");
  }
  if (!("serial" in navigator)) {
    throw new Error("Web Serial API is not available in this browser");
  }

  flashingNow = true;
  let port = null;
  let transport = null;
  let flashArtifacts = [];

  try {
    if (serialConnected) {
      appendLog("Disconnecting the current serial session before flashing.");
      await disconnectSerialSession({ silent: true });
    }
    setFlashProgress(8, "Waiting for serial permission");
    appendLog("Choose the board USB serial port in the browser prompt.");
    port = await navigator.serial.requestPort();
    if (typeof port.getInfo === "function") {
      preferredSerialPortInfo = port.getInfo();
    }
    appendLog("Serial device selected for flashing.");

    flashButton.disabled = true;
    updateButton.disabled = true;
    setPanelState(flashState, "Connecting", "panel__status--busy");
    stateFlash.textContent = kind === "full" ? "Preparing full image" : "Preparing update image";
    setFlashProgress(4, "Loading browser flasher");

    appendLog("Loading browser flasher library.");
    const { ESPLoader, Transport, HardReset } = await loadEspTool();
    setFlashProgress(12, "Preparing flasher");

    setFlashProgress(16, "Connecting to bootloader");
    appendLog("Connecting to bootloader.");
    transport = new Transport(port, true);
    flashArtifacts = await buildFlashArtifacts(currentBoard, kind);
    appendLog(
      kind === "update"
        ? `Prepared ${flashArtifacts.length} image for update flash.`
        : `Prepared ${flashArtifacts.length} image for full flash.`
    );

    const flashOptions = {
      debugLogging: false,
      terminal: createFlashTerminal(),
      transport,
      baudrate: 115200,
      romBaudrate: 115200,
      flashSize: "keep",
      flashMode: "keep",
      flashFreq: "keep",
      eraseAll: kind === "full",
      compress: true,
      fileArray: flashArtifacts.map((artifact) => ({
        data: artifact.data,
        address: artifact.address
      })),
      reportProgress(_fileIndex, written, total) {
        const lowerBound = kind === "full" ? 24 : 24;
        const percent = total > 0 ? Math.max(lowerBound, Math.min(98, Math.round((written / total) * 100))) : lowerBound;
        setFlashProgress(percent, `Writing ${kind} image`);
      }
    };

    const loader = new ESPLoader(flashOptions);
    loader.hr = new HardReset(transport);

    const chip = await loader.main();
    appendLog(`Bootloader connected: ${chip || currentBoard.chipFamily}`);
    setFlashProgress(kind === "full" ? 26 : 24, kind === "full" ? "Erasing and writing full image" : "Starting flash");
    appendLog("Reading flash identity.");
    await loader.flashId();
    if (kind === "full") {
      appendLog("Full image selected. Flash erase is enabled.");
    } else {
      appendLog("Update selected. Writing the update image at 0x10000 without a full erase.");
    }
    await loader.writeFlash(flashOptions);
    await delay(100);
    if (typeof loader.after === "function") {
      await loader.after("hard_reset");
      await delay(100);
    }
    await pulseEspReset(transport);

    flashComplete = true;
    configApplied = false;
    setPanelState(flashState, "Flashed", "panel__status--success");
    setFlashProgress(100, "Flash complete");
    setText(stateFlash, kind === "full" ? "Full image flashed" : "Update image flashed");
    setText(summaryFirmware, flashArtifacts.map((artifact) => artifact.imageName).join(", "));
    setText(summaryConfig, "Not sent");
    setText(stateMqtt, "Awaiting apply");
    setText(summaryMqtt, "Awaiting verify");
    setPanelState(settingsState, "Apply radio + MQTT settings", "panel__status--ready");
    setPanelState(serialState, "Reconnect serial", "panel__status--idle");
    setPanelState(verifyState, "Waiting", "panel__status--idle");
    updateSerialButton();
    appendLog(`Flash completed successfully for ${currentBoard.label}. Reconnect serial, then apply the selected device, WiFi, and MQTT settings.`);
  } finally {
    flashingNow = false;
    flashButton.disabled = !currentBoard?.artifactBase;
    updateButton.disabled = !currentBoard?.artifactBase;
    window.setTimeout(() => {
      releaseFlashSession(transport, port)
        .then(() => {
          appendLog("Flash session released. The page is ready for serial reconnect.");
        })
        .catch((error) => {
          appendLog(`Flash cleanup warning: ${error.message}`);
        });
    }, 1600);
  }
}

boardSelect.addEventListener("change", () => {
  const board = firmwareData.boards.find((item) => item.id === boardSelect.value);
  setBoardDetails(board);
  appendLog(`Board selected: ${board ? board.label : boardSelect.value}`);
});

boardTrigger.addEventListener("click", () => {
  if (boardMenu.hidden) {
    openBoardMenu();
  } else {
    closeBoardMenu();
  }
});

boardSearch.addEventListener("input", () => {
  filterBoards(boardSearch.value);
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("#board-combobox")) {
    closeBoardMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeBoardMenu();
  }
});

settingsForm.addEventListener("input", () => {
  persistCurrentStep4Settings();
  buildCommandPreview();
});

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
});

radioPreset.addEventListener("change", () => {
  if (radioPreset.value !== "CUSTOM") {
    applyRadioPreset(radioPreset.value);
  } else {
    syncRadioCommand();
  }
  buildCommandPreview();
});

[radioFrequency, radioBandwidth, radioSf, radioCr].forEach((input) => {
  input.addEventListener("input", () => {
    updateRadioPresetFromInputs();
    buildCommandPreview();
  });
});

captureDeviceButton.addEventListener("click", async () => {
  if (!currentBoard) {
    appendLog("Choose a board before reading device info.");
    return;
  }

  appendLog("Read Current Device Info clicked.");
  captureDeviceButton.disabled = true;
  try {
    await captureCurrentDeviceInfo();
  } catch (error) {
    setPanelState(deviceReadState, "Read failed", "panel__status--error");
    appendLog(`Read current device info failed: ${error.message}`);
  } finally {
    captureDeviceButton.disabled = false;
  }
});

flashButton.addEventListener("click", async () => {
  appendLog("Flash Full Firmware clicked.");
  const confirmed = window.confirm(
    "Flash Full Firmware will erase the device flash before writing the image.\n\nThis can wipe saved settings and should only be used for first install or recovery.\n\nContinue?"
  );
  if (!confirmed) {
    appendLog("Full firmware flash canceled by user.");
    return;
  }
  try {
    await flashFirmware("full");
  } catch (error) {
    setPanelState(flashState, "Flash failed", "panel__status--error");
    stateFlash.textContent = "Flash failed";
    setFlashProgress(0, "Flash failed");
    appendLog(`Full firmware flash failed: ${error.message}`);
  }
});

updateButton.addEventListener("click", async () => {
  appendLog("Flash Update Only clicked.");
  try {
    await flashFirmware("update");
  } catch (error) {
    setPanelState(flashState, "Flash failed", "panel__status--error");
    stateFlash.textContent = "Flash failed";
    setFlashProgress(0, "Flash failed");
    appendLog(`Update firmware flash failed: ${error.message}`);
  }
});

manifestButton.addEventListener("click", () => {
  if (currentBoard && currentBoard.manifestPath) {
    appendLog(`Manifest path: ${currentBoard.manifestPath}`);
    window.open(currentBoard.manifestPath, "_blank", "noopener");
    return;
  }
  appendLog("Manifest is not published for this board yet.");
});

serialButton.addEventListener("click", async () => {
  try {
    await connectSerial();
  } catch (error) {
    setPanelState(serialState, "Serial error", "panel__status--error");
    appendLog(`Serial error: ${error.message}`);
  }
});

async function applySettings() {
  appendLog("Apply Settings clicked.");
  if (!serialConnected) {
    setPanelState(serialState, "Serial required", "panel__status--error");
    appendLog("Cannot configure device until the serial link is connected.");
    return;
  }

  if (!flashComplete) {
    appendLog("Proceeding with configuration without a flash in this session.");
  }

  setPanelState(settingsState, "Writing", "panel__status--busy");
  setCommandState(1, "is-running", "Running");
  setCommandState(2, "is-pending", "Pending");
  setCommandState(3, "is-pending", "Pending");
  setCommandState(4, "is-pending", "Pending");
  setCommandState(5, "is-pending", "Pending");

  try {
    window.alert(
      "Make sure the device is turned on and the serial connection is stable.\n\n" +
      "If needed, press the reset button on the board before continuing.\n\n" +
      "Keep the board plugged in and avoid disconnecting it while settings are being applied."
    );

    const plan = buildConfigurationPlan();
    appendLog("Applying settings immediately.");

    if (Date.now() - serialConnectedAt < 2500) {
      appendLog("Allowing a short startup delay before sending the first CLI command.");
      await delay(800);
    }

    await ensureSerialCliReady();
    await runCommandExpectOk(plan.radio[0], 10000);
    setCommandState(1, "is-done", "Written");
    setCommandState(2, "is-running", "Running");

    if (plan.identity.length > 0) {
      await runCommands(plan.identity);
      setCommandState(2, "is-done", "Written");
    } else {
      setCommandState(2, "is-done", "Skipped");
    }
    setCommandState(3, "is-running", "Running");

    await runCommands(plan.wifi);
    setCommandState(3, "is-done", "Written");
    setCommandState(4, "is-running", "Running");

    await runCommands(plan.mqtt);
    setCommandState(4, "is-done", "Written");
    setCommandState(5, "is-running", "Rebooting");

    if (plan.key.length > 0) {
      await runCommands(plan.key);
    }

    logSerialCommand(plan.reboot[0]);
    await writeSerialCommand(plan.reboot[0]);
    setCommandState(5, "is-done", "Rebooted");
    setPanelState(settingsState, "Saved, rebooted", "panel__status--success");
    setText(summaryConfig, "Commands applied, rebooted");
    setText(stateMqtt, "Rebooting");
    setText(summaryMqtt, "Reconnect serial to verify");
    setPanelState(verifyState, "Reconnect serial after reboot", "panel__status--idle");
    configApplied = true;
    scheduleSerialDisconnect(2200, "Device configuration completed. Waiting for the reboot, then closing the serial session.");
  } catch (error) {
    setPanelState(settingsState, "Failed", "panel__status--error");
    appendLog(`Configuration failed: ${error.message}`);
    if (commandItems[1].classList.contains("is-running")) {
      setCommandState(1, "is-failed", "Failed");
    } else if (commandItems[2].classList.contains("is-running")) {
      setCommandState(2, "is-failed", "Failed");
    } else if (commandItems[3].classList.contains("is-running")) {
      setCommandState(3, "is-failed", "Failed");
    } else if (commandItems[4].classList.contains("is-running")) {
      setCommandState(4, "is-failed", "Failed");
    } else if (commandItems[5].classList.contains("is-running")) {
      setCommandState(5, "is-failed", "Failed");
    }
  }
}

settingsApplyButton.addEventListener("click", applySettings);
if (configureButton) {
  configureButton.addEventListener("click", applySettings);
}

reconnectButton.addEventListener("click", async () => {
  if (!serialConnected) {
    setPanelState(serialState, "Serial required", "panel__status--error");
    appendLog("Connect serial before reconnecting MQTT.");
    return;
  }

  setPanelState(verifyState, "Checking", "panel__status--busy");
  setText(stateMqtt, "Reconnecting");
  try {
    await runCommandExpectOk("mqtt reconnect", 8000);
    await delay(1500);
    const { connected } = await readMqttStatus();
    if (!connected) {
      setPanelState(verifyState, "MQTT offline", "panel__status--error");
      setText(stateMqtt, "Disconnected");
      setText(summaryMqtt, "mqtt.connected=false");
      appendLog("MQTT reconnect command completed, but the device still reports mqtt.connected=false.");
      return;
    }
    setPanelState(verifyState, "MQTT online", "panel__status--success");
    setText(stateMqtt, "Connected");
    setText(summaryMqtt, "mqtt.connected=true");
    appendLog("MQTT reconnect command completed and the device reports mqtt.connected=true.");
  } catch (error) {
    setPanelState(verifyState, "Reconnect failed", "panel__status--error");
    setText(stateMqtt, "Failed");
    setText(summaryMqtt, "Reconnect failed");
    appendLog(`Reconnect failed: ${error.message}`);
  }
});

verifyButton.addEventListener("click", async () => {
  if (!serialConnected) {
    setPanelState(verifyState, "Serial required", "panel__status--error");
    appendLog("Connect serial before running verification.");
    return;
  }

  setPanelState(verifyState, "Checking", "panel__status--busy");
  try {
    await ensureSerialCliReady();
    await verifyDeviceSettings();
    setPanelState(verifyState, "Verified", "panel__status--success");
    setText(stateMqtt, "Connected");
    setText(summaryMqtt, "Device settings verified");
    appendLog("Verification completed: device settings match the current form and mqtt.connected=true.");
  } catch (error) {
    setPanelState(verifyState, "Verify failed", "panel__status--error");
    setText(stateMqtt, "Unknown");
    setText(summaryMqtt, "Verification failed");
    appendLog(`Verification failed: ${error.message}`);
  }
});

clearLogButton.addEventListener("click", () => {
  logPane.innerHTML = "";
  appendLog("Log cleared.");
});

populateBoards();
evaluateCapabilities();
applyRadioPreset("EU_NARROW");
buildCommandPreview();
updateSerialButton();
closeBoardMenu();
appendLog(`Loaded ${firmwareData.boards.length} board definitions.`);
