# Architecture

## High-Level Shape

This project is a static single-page application with no backend API.

Runtime pieces:

- `index.html`: renders the full workflow and all configuration fields
- `assets/styles.css`: styles and responsive layout
- `assets/app.js`: state, validation, flashing, serial I/O, verification, local storage
- `assets/vendor/esptool-js-bundle.js`: browser flashing library
- `assets/firmware-data*.js`: published board catalogs injected into `window.FIRMWARE_DATA`
- `firmware/`: committed binary payloads and per-board manifest metadata

Hosting pieces:

- `Dockerfile`: packages the static site into `nginx:1.27-alpine`
- `nginx.conf`: sets cache policy by asset type
- `compose.yml`: runs Nginx and an optional `cloudflared` tunnel

## Frontend State Model

The app keeps most runtime state in module-level variables inside `assets/app.js`.

Important state buckets:

- selected board and filtered board list
- current UI mode and active workflow step
- serial connection state and serial read buffer
- whether flash and config operations completed in the current session
- cached board manifests
- captured device info and saved step-4 settings
- active MQTT broker runtime markers detected from serial output

## Browser Persistence

The app uses `localStorage` to persist:

- UI mode
- selected firmware branch
- whether the dev-branch warning has been shown
- captured device snapshots, keyed by board ID
- saved configuration form values, keyed by board ID

This persistence is local to the operator's browser. There is no server-side storage or
sync between clients.

## Firmware Catalog Loading

Board metadata is not embedded directly in the HTML. Instead, the app loads one of these
files at runtime:

- `/assets/firmware-data.js`
- `/assets/firmware-data-dev.js`

The selected file is fetched as text, injected as a `<script>`, and expected to define
`window.FIRMWARE_DATA`.

Each board record includes:

- board ID and label
- firmware name and version
- chip family
- hardware validation status
- manifest path
- artifact base path
- full and update artifact names

## Flash Architecture

Flashing is handled entirely in the browser through `esptool-js`.

Flow:

1. Disconnect any live CLI serial session.
2. Ask the browser for a serial port.
3. Load `esptool-js`.
4. Fetch the selected binary artifact from `firmware/`.
5. Connect to the bootloader.
6. Write the image and hard reset the device.
7. Release the flash session and prompt for serial reconnect.

Current implementation detail:

- full flash writes one merged image at `0x00000`
- update flash writes one update image at `0x10000`

Even though manifests publish segmented update data, the current flash routine does not
iterate over manifest segments.

## Serial CLI Architecture

The configuration path uses the MeshCore CLI over Web Serial at `115200` baud.

Core behaviors:

- line-oriented serial reader with buffered chunk processing
- command helpers that wait for `->` replies
- best-effort command masking for secrets in logs
- delayed settling per command type
- CLI readiness probe through `ver`
- targeted `get <key>` readback for verification
- `show mqtt` parsing for MQTT runtime verification

When the CLI is silent, the app allows a long wait before proceeding and also contains a
serial reset helper for boards that need the official signal sequence.

## Backup And Prefill Pipeline

The backup flow is tightly coupled to the configuration form.

When a device snapshot is captured:

- values are written to browser storage under the selected board
- the UI updates summary chips immediately
- form inputs are prefilled where applicable
- the command preview is rebuilt from the resulting state

Backup export combines two sources:

- captured live device values
- step-4 values saved in the browser

## MQTT Broker Logic

Broker settings are normalized into six slot records regardless of UI mode.

Derived behavior includes:

- simple-mode suppression of slots above broker 1
- advanced-mode visibility based on configured logical broker count
- optional status-broker enablement per logical pair
- automatic status topic derivation from `/packets` roots
- live topic preview text for each visible slot

## Logging And Operator Feedback

The serial log is timestamped in the browser and records:

- operator actions
- outgoing commands, with masked secrets when possible
- incoming serial lines
- matched and skipped responses
- flash progress updates
- verification results and warnings

The UI also maintains panel states, a stepper, command-stage indicators, reconnect
banners, and summary chips to keep the operator aligned with the current stage.
