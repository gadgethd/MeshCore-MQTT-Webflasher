const boardSelect = document.getElementById("board-select");
const firmwareVersion = document.getElementById("firmware-version");
const buildLabel = document.getElementById("build-label");
const flashPackage = document.getElementById("flash-package");
const flashState = document.getElementById("flash-state");
const flashProgressBar = document.getElementById("flash-progress-bar");
const flashProgressText = document.getElementById("flash-progress-text");
const flashProgressPercent = document.getElementById("flash-progress-percent");
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
const clearLogButton = document.getElementById("clear-log-button");

let flashComplete = false;
let serialConnected = false;
let configApplied = false;

function stamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function appendLog(message) {
  const line = document.createElement("p");
  line.innerHTML = `<span>${stamp()}</span>${message}`;
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

boardSelect.addEventListener("change", () => {
  const board = boardSelect.value;
  stateBoard.textContent = board;
  flashPackage.textContent = board.includes("Heltec") ? "full + update" : "full";
  appendLog(`Board selected: ${board}`);
});

flashButton.addEventListener("click", () => {
  setPanelState(flashState, "Flashing", "panel__status--busy");
  stateFlash.textContent = "Flashing full image";
  setFlashProgress(22, "Preparing USB connection");
  appendLog("Full firmware flash requested.");

  setTimeout(() => setFlashProgress(48, "Writing bootloader and partitions"), 350);
  setTimeout(() => setFlashProgress(79, "Writing application image"), 900);
  setTimeout(() => {
    setFlashProgress(100, "Flash complete");
    setPanelState(flashState, "Complete", "panel__status--success");
    setPanelState(settingsState, "Ready", "panel__status--ready");
    summaryFirmware.textContent = `${firmwareVersion.textContent} full image`;
    stateFlash.textContent = "Flash complete";
    flashComplete = true;
    appendLog("Firmware flash completed successfully.");
  }, 1450);
});

updateButton.addEventListener("click", () => {
  setPanelState(flashState, "Update Flash", "panel__status--busy");
  stateFlash.textContent = "Flashing update image";
  setFlashProgress(35, "Writing update image");
  appendLog("Update-only flash requested.");

  setTimeout(() => {
    setFlashProgress(100, "Update complete");
    setPanelState(flashState, "Complete", "panel__status--success");
    setPanelState(settingsState, "Ready", "panel__status--ready");
    summaryFirmware.textContent = `${firmwareVersion.textContent} update image`;
    stateFlash.textContent = "Update complete";
    flashComplete = true;
    appendLog("Update image written successfully.");
  }, 900);
});

manifestButton.addEventListener("click", () => {
  appendLog("Manifest opened for the selected board.");
});

serialButton.addEventListener("click", () => {
  setPanelState(serialState, "Serial connected", "panel__status--connected");
  stateSerial.textContent = "Connected";
  summarySerial.textContent = "Connected at 115200";
  setCommandState(0, "is-done", "Connected");
  serialConnected = true;
  appendLog("Serial link opened at 115200 baud.");
});

configureButton.addEventListener("click", () => {
  if (!flashComplete) {
    setPanelState(settingsState, "Flash required", "panel__status--error");
    appendLog("Cannot configure device before firmware is flashed.");
    return;
  }

  if (!serialConnected) {
    setPanelState(serialState, "Serial required", "panel__status--error");
    appendLog("Cannot configure device until the serial link is connected.");
    return;
  }

  setPanelState(settingsState, "Writing", "panel__status--busy");
  setCommandState(1, "is-running", "Running");
  setCommandState(2, "is-pending", "Pending");
  setCommandState(3, "is-pending", "Pending");
  appendLog("Writing WiFi settings to device.");

  setTimeout(() => {
    setCommandState(1, "is-done", "Written");
    setCommandState(2, "is-running", "Running");
    appendLog("Writing MQTT settings to device.");
  }, 600);

  setTimeout(() => {
    setCommandState(2, "is-done", "Written");
    setCommandState(3, "is-running", "Running");
    appendLog("Issuing mqtt reconnect command.");
  }, 1200);

  setTimeout(() => {
    setCommandState(3, "is-done", "Done");
    setPanelState(settingsState, "Saved", "panel__status--success");
    summaryConfig.textContent = "Commands applied";
    setPanelState(verifyState, "Ready to verify", "panel__status--ready");
    configApplied = true;
    appendLog("Device configuration completed.");
  }, 1800);
});

reconnectButton.addEventListener("click", () => {
  if (!configApplied) {
    setPanelState(verifyState, "Config required", "panel__status--error");
    appendLog("Run the configuration step before verifying MQTT status.");
    return;
  }

  setPanelState(verifyState, "Checking", "panel__status--busy");
  stateMqtt.textContent = "Reconnecting";
  appendLog("Manual MQTT reconnect requested.");

  setTimeout(() => {
    setPanelState(verifyState, "MQTT online", "panel__status--success");
    stateMqtt.textContent = "Connected";
    summaryMqtt.textContent = "Broker reachable";
    appendLog("MQTT reporter: connected");
  }, 900);
});

clearLogButton.addEventListener("click", () => {
  logPane.innerHTML = "";
  appendLog("Log cleared.");
});
