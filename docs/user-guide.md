# User Guide

## Before You Start

You need:

- a Chromium-family browser with Web Serial support
- access to the target board over USB serial
- either HTTPS hosting or a local `localhost` session
- the correct board selected in the UI before flashing or backup

If you are serving the repo locally, `http://127.0.0.1:8080` works because browsers
allow Web Serial on `localhost`.

## End-To-End Workflow

### 1. Choose A Workflow Mode

The first screen asks for `Simple` or `Advanced` mode.

- `Simple` keeps the UI focused on one MQTT destination.
- `Advanced` enables extra broker pairs, optional status brokers, and more direct
  visibility into the full configuration workflow.

The selected mode is stored in browser `localStorage`.

### 2. Read Current Device Info

Use `Read Current Device Info` before flashing whenever possible.

The app will:

- open the serial port at `115200`
- wait for the MeshCore CLI to become available
- read identity, location, keys, WiFi, model, client version, and MQTT settings
- fall back to legacy single-broker MQTT keys if the new broker layout is blank
- store the captured values in browser storage for the selected board
- prefill later configuration fields from the captured data

After a capture, `Download Backup (.txt)` exports:

- captured values currently stored in the browser
- current step-4 form values saved in the browser
- all broker slot values

The export is a plain-text snapshot, not an encrypted backup.

### 3. Choose The Board

Pick the exact published board entry from the searchable board selector.

The board selection controls:

- firmware version and artifact names displayed in the UI
- manifest path
- chip family label
- whether the catalog points to stable or development assets
- which browser-stored backup and saved settings are loaded

### 4. Set Radio And Flash Firmware

The flash panel lets you:

- choose the firmware branch: `main` or `dev`
- select a LoRa preset or enter custom radio values
- flash either a `Full` image or an `Update` image
- open the board manifest for inspection

Flash behavior:

- `Flash Full Firmware` erases flash and writes the full merged image.
- `Flash Update Only` writes the published update image at the application offset.
- After a successful flash, the app releases the flashing session and prompts you to
  reconnect serial before configuration continues.

If automatic bootloader entry fails because the browser cannot toggle serial control
lines, the app falls back to manual instructions for BOOT/RESET entry.

### 5. Configure The Device

Step 4 contains all configuration inputs:

- repeater identity
- passwords and location
- WiFi transport settings
- shared MQTT metadata
- broker pair configuration

The command preview updates live as you edit the form.

### 6. Apply Configuration

In the final step, reconnect serial and choose one of three apply paths:

- `Apply All Settings`: radio, identity, WiFi, private key, MQTT, then reboot
- `Apply Device + WiFi`: radio, identity, WiFi, private key, then reboot
- `Apply MQTT`: MQTT only, followed by `mqtt reconnect`

When a reboot is part of the apply path, the app schedules serial disconnect, shows a
reconnect banner, and expects you to reconnect before verifying state.

## Firmware Branch Selection

Switching the branch changes which firmware catalog is loaded:

- `main` loads `/assets/firmware-data.js`
- `dev` loads `/assets/firmware-data-dev.js`

The `dev` branch displays a warning dialog before the first selection and saves the
preference in browser storage. If the dev catalog fails to load, the UI reverts to
`main`.

## Tips For Reliable Operation

- Read device info before changing the private key if you want to use default MQTT topic
  generation.
- Keep the board connected through the full flash and apply cycle.
- Use the serial log and command preview together when diagnosing failures.
- Reconnect serial after every reboot-driven step. The UI cannot continue verification
  against a closed port.
