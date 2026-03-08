const boardSelect = document.getElementById("board-select");
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
const configureButton = document.getElementById("configure-button");
const reconnectButton = document.getElementById("reconnect-button");
const verifyButton = document.getElementById("verify-button");
const clearLogButton = document.getElementById("clear-log-button");
const settingsForm = document.getElementById("settings-form");
const commandPreviewPane = document.getElementById("command-preview-pane");
const capSecure = document.getElementById("cap-secure");
const capSerial = document.getElementById("cap-serial");
const capUsb = document.getElementById("cap-usb");
const capManifest = document.getElementById("cap-manifest");

const firmwareData = window.FIRMWARE_DATA || { boards: [] };

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

function setBoardDetails(board) {
  currentBoard = board;
  if (!board) return;

  stateBoard.textContent = board.label;
  firmwareVersion.textContent = board.firmwareVersion;
  firmwareFamily.textContent = board.firmwareName;
  buildLabel.textContent = board.firmwareVersion;
  flashPackage.textContent = humanFlashPackage(board);
  hardwareCheck.textContent = board.hardwareStatus;
  artifactFullName.textContent = board.artifacts.full;
  artifactUpdateName.textContent = board.artifacts.update;
  capManifest.textContent = board.manifestPath ? "Board manifest" : "Catalog fallback";

  const flashReady = Boolean(board.artifactBase && board.chipFamily);
  flashButton.disabled = !flashReady;
  updateButton.disabled = !flashReady;
}

function populateBoards() {
  boardSelect.innerHTML = "";

  firmwareData.boards.forEach((board, index) => {
    const option = document.createElement("option");
    option.value = board.id;
    option.textContent = board.label;
    if (index === 0) option.selected = true;
    boardSelect.appendChild(option);
  });

  setBoardDetails(firmwareData.boards[0]);
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
  serialButton.textContent = serialConnected ? "Disconnect Serial" : "Connect Serial";
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

function pushSerialLine(line) {
  if (!line.trim()) return;
  appendLog(line);
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

function buildCommandList() {
  const formData = new FormData(settingsForm);
  return [
    `set mqtt.wifi.ssid ${formData.get("wifiSsid") || ""}`,
    `set mqtt.wifi.pass ${formData.get("wifiPassword") || ""}`,
    `set mqtt.uri ${formData.get("mqttUri") || ""}`,
    `set mqtt.username ${formData.get("mqttUsername") || ""}`,
    `set mqtt.password ${formData.get("mqttPassword") || ""}`,
    `set mqtt.topic.root ${formData.get("topicRoot") || ""}`,
    `set mqtt.iata ${formData.get("iata") || ""}`,
    `set mqtt.model ${formData.get("model") || ""}`,
    `set mqtt.client.version ${formData.get("clientVersion") || ""}`
  ];
}

async function writeSerialCommand(command) {
  if (!serialPort || !serialPort.writable) {
    throw new Error("Serial port is not connected");
  }

  const writer = serialPort.writable.getWriter();
  try {
    const payload = new TextEncoder().encode(`${command}\r`);
    await writer.write(payload);
  } finally {
    writer.releaseLock();
  }
}

async function runCommandExpectOk(command, timeoutMs = 6000) {
  appendLog(`> ${command}`);
  await writeSerialCommand(command);
  const line = await waitForLine((value) => value.includes("->"), timeoutMs);
  if (/->\s*OK/i.test(line)) {
    return line;
  }
  throw new Error(line);
}

async function disconnectSerialSession({ silent = false } = {}) {
  if (!serialPort) return;

  try {
    if (serialReader) {
      try {
        await serialReader.cancel();
      } catch (error) {
        if (!silent) {
          appendLog(`Serial reader cancel warning: ${error.message}`);
        }
      }
    }
    await serialPort.close();
  } finally {
    serialPort = null;
    serialReader = null;
    serialConnected = false;
    serialReadBuffer = "";
    serialLoopRunning = false;
    clearLineListeners("Serial port closed");
    updateSerialButton();
    setPanelState(serialState, "Serial disconnected", "panel__status--idle");
    stateSerial.textContent = "Disconnected";
    summarySerial.textContent = "Disconnected";
    setCommandState(0, "is-pending", "Pending");
    if (!silent) {
      appendLog("Serial link closed.");
    }
  }
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    throw new Error("Web Serial API is not available in this browser");
  }

  if (serialConnected) {
    await disconnectSerialSession();
    return;
  }

  serialPort = await navigator.serial.requestPort();
  await serialPort.open({ baudRate: 115200 });
  serialConnected = true;
  updateSerialButton();
  setPanelState(serialState, "Serial connected", "panel__status--connected");
  stateSerial.textContent = "Connected";
  summarySerial.textContent = "Connected at 115200";
  setCommandState(0, "is-done", "Connected");
  appendLog("Serial link opened at 115200 baud.");
  readSerialLoop();
}

function buildCommandPreview() {
  const commands = [...buildCommandList(), "mqtt reconnect"];
  commandPreviewPane.textContent = commands.join("\n");
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

function setPanelState(target, text, variant) {
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

async function loadEspTool() {
  if (!esptoolModulePromise) {
    esptoolModulePromise = import("https://unpkg.com/esptool-js@0.5.6/lib/index.js?module");
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
  const response = await fetch(resolveArtifactUrl(path), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${path} (${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
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
  const imageName = kind === "full" ? currentBoard.artifacts.full : currentBoard.artifacts.update;
  const imagePath = `${currentBoard.artifactBase}${imageName}`;
  const address = kind === "full" ? 0x0 : 0x10000;

  try {
    if (serialConnected) {
      appendLog("Closing live serial session before flash.");
      await disconnectSerialSession({ silent: true });
    }

    setPanelState(flashState, "Connecting", "panel__status--busy");
    stateFlash.textContent = kind === "full" ? "Preparing full image" : "Preparing update image";
    setFlashProgress(4, "Loading browser flasher");

    const { ESPLoader, Transport } = await loadEspTool();
    setFlashProgress(10, "Requesting serial device");
    port = await navigator.serial.requestPort();

    setFlashProgress(16, "Connecting to bootloader");
    transport = new Transport(port);

    const loader = new ESPLoader({
      transport,
      baudrate: 460800,
      romBaudrate: 115200,
      debugLogging: false,
      terminal: createFlashTerminal()
    });

    const chip = await loader.main();
    appendLog(`Bootloader connected: ${chip || currentBoard.chipFamily}`);
    setFlashProgress(24, "Downloading firmware image");

    const imageData = await fetchBinary(imagePath);
    appendLog(`Fetched ${imageName} (${imageData.byteLength} bytes)`);

    setFlashProgress(32, "Starting flash");
    try {
      await loader.runStub();
      if (typeof loader.changeBaud === "function") {
        await loader.changeBaud();
      }
    } catch (error) {
      appendLog(`Stub loader note: ${error.message}`);
    }

    await loader.writeFlash({
      fileArray: [
        {
          data: imageData,
          address
        }
      ],
      flashMode: "keep",
      flashFreq: "keep",
      flashSize: "keep",
      eraseAll: kind === "full",
      compress: true,
      reportProgress(_fileIndex, written, total) {
        const percent = total > 0 ? Math.max(32, Math.min(98, Math.round((written / total) * 100))) : 32;
        setFlashProgress(percent, `Writing ${kind} image`);
      }
    });

    if (typeof loader.after === "function") {
      await loader.after("hard_reset");
    }

    flashComplete = true;
    configApplied = false;
    setPanelState(flashState, "Flashed", "panel__status--success");
    setFlashProgress(100, "Flash complete");
    stateFlash.textContent = kind === "full" ? "Full image flashed" : "Update image flashed";
    summaryFirmware.textContent = imageName;
    summaryConfig.textContent = "Not sent";
    stateMqtt.textContent = "Awaiting config";
    summaryMqtt.textContent = "Awaiting verify";
    setPanelState(settingsState, "Ready to configure", "panel__status--ready");
    setPanelState(serialState, "Reconnect serial", "panel__status--idle");
    setPanelState(verifyState, "Waiting", "panel__status--idle");
    appendLog(`Flash completed successfully for ${currentBoard.label}. Reconnect serial to configure the device.`);
  } finally {
    flashingNow = false;
    if (transport && typeof transport.disconnect === "function") {
      try {
        await transport.disconnect();
      } catch (error) {
        appendLog(`Flash disconnect warning: ${error.message}`);
      }
    }
  }
}

boardSelect.addEventListener("change", () => {
  const board = firmwareData.boards.find((item) => item.id === boardSelect.value);
  setBoardDetails(board);
  appendLog(`Board selected: ${board ? board.label : boardSelect.value}`);
});

settingsForm.addEventListener("input", () => {
  buildCommandPreview();
});

flashButton.addEventListener("click", async () => {
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

configureButton.addEventListener("click", async () => {
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

  try {
    for (const command of buildCommandList().slice(0, 2)) {
      await runCommandExpectOk(command);
    }
    setCommandState(1, "is-done", "Written");
    setCommandState(2, "is-running", "Running");

    for (const command of buildCommandList().slice(2)) {
      await runCommandExpectOk(command);
    }
    setCommandState(2, "is-done", "Written");
    setCommandState(3, "is-running", "Running");

    await runCommandExpectOk("mqtt reconnect", 8000);
    setCommandState(3, "is-done", "Done");
    setPanelState(settingsState, "Saved", "panel__status--success");
    summaryConfig.textContent = "Commands applied";
    setPanelState(verifyState, "Ready to verify", "panel__status--ready");
    configApplied = true;
    appendLog("Device configuration completed.");
  } catch (error) {
    setPanelState(settingsState, "Failed", "panel__status--error");
    appendLog(`Configuration failed: ${error.message}`);
    if (commandItems[1].classList.contains("is-running")) {
      setCommandState(1, "is-failed", "Failed");
    } else if (commandItems[2].classList.contains("is-running")) {
      setCommandState(2, "is-failed", "Failed");
    } else if (commandItems[3].classList.contains("is-running")) {
      setCommandState(3, "is-failed", "Failed");
    }
  }
});

reconnectButton.addEventListener("click", async () => {
  if (!serialConnected) {
    setPanelState(serialState, "Serial required", "panel__status--error");
    appendLog("Connect serial before reconnecting MQTT.");
    return;
  }

  setPanelState(verifyState, "Checking", "panel__status--busy");
  stateMqtt.textContent = "Reconnecting";
  try {
    await runCommandExpectOk("mqtt reconnect", 8000);
    setPanelState(verifyState, "MQTT online", "panel__status--success");
    stateMqtt.textContent = "Connected";
    summaryMqtt.textContent = "Broker reachable";
    appendLog("MQTT reconnect command completed.");
  } catch (error) {
    setPanelState(verifyState, "Reconnect failed", "panel__status--error");
    stateMqtt.textContent = "Failed";
    summaryMqtt.textContent = "Reconnect failed";
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
  appendLog("> show mqtt");

  try {
    await writeSerialCommand("show mqtt");
    await waitForLine((line) => line.includes("mqtt.connected="), 8000);
    setPanelState(verifyState, "MQTT checked", "panel__status--success");
    summaryMqtt.textContent = "Verification complete";
  } catch (error) {
    setPanelState(verifyState, "Verify failed", "panel__status--error");
    appendLog(`Verification failed: ${error.message}`);
  }
});

clearLogButton.addEventListener("click", () => {
  logPane.innerHTML = "";
  appendLog("Log cleared.");
});

populateBoards();
evaluateCapabilities();
buildCommandPreview();
updateSerialButton();
appendLog(`Loaded ${firmwareData.boards.length} board definitions.`);
