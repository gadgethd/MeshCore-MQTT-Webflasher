# Architecture

## High-Level Shape

This project is a static single-page application with no backend API.

Runtime pieces:

- `index.html`: renders the full workflow and all configuration fields
- `assets/styles.css`: styles and responsive layout
- `assets/app.js`: state, validation, flashing, serial I/O, verification, local storage
- `assets/security.js`: pinned signing key, firmware verification, chip checks, serial redaction
- `assets/vendor/esptool-js-bundle.js`: browser flashing library
- `assets/firmware-data.js` and `new/assets/firmware-data.js`: generated stable board catalogs
- `firmware/`: committed binaries, release inventory, and signed release manifest

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
- captured device snapshots, keyed by board ID
- saved configuration form values, keyed by board ID

This persistence is local to the operator's browser. There is no server-side storage or
sync between clients.

## Firmware Catalog Loading

Board metadata is not embedded directly in the HTML. Both UIs load a generated stable catalog:

- `/assets/firmware-data.js`

It defines `window.FIRMWARE_DATA`; CI requires the root and `/new/` copies to be identical.

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

1. Fetch the same-origin signed release manifest and verify it with the pinned Ed25519 key.
2. Fetch every selected segment and verify its exact size, full SHA-256, offset, chip ID, and ESP image header before opening Web Serial.
3. Disconnect any live CLI serial session and ask the browser for a serial port.
4. Load `esptool-js` and connect to the bootloader.
5. Require `loader.chip.CHIP_NAME`, signed chip metadata, and every ESP image header to agree.
6. Write all manifest segments at their signed offsets and hard reset the device.
7. Release the flash session and prompt for serial reconnect.

Full mode writes the signed merged image. Update mode writes the signed bootloader,
partition table, `boot_app0`, and application segments at their declared offsets.

## Serial CLI Architecture

The configuration path uses the MeshCore CLI over Web Serial at `115200` baud.

Core behaviors:

- line-oriented serial reader with buffered chunk processing
- command helpers that wait for `->` replies
- request objects classify private-key and password replies as sensitive before logging
- defense-in-depth redaction at the DOM/in-memory log and clipboard boundary
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
