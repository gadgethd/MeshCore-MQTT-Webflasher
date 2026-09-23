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
- keep the captured values in memory for this session
- prefill later configuration fields from the captured data

After a capture, `Download Encrypted Backup` exports:

- captured values in session memory
- current step-4 form values in session memory
- all broker slot values

Choose and confirm a passphrase of at least 12 characters. The file uses AES-256-GCM,
expires seven days after creation, and does not store the passphrase. Keep the passphrase
separate from the file. Importing an older plain-text backup requires confirmation.
Device values are cleared after successful verification or when you choose Clear Device
Data; `/new/` also clears them on Done — Start Over.

### 3. Choose The Board

Pick the exact published board entry from the searchable board selector.

The board selection controls:

- firmware version and artifact names displayed in the UI
- manifest path
- chip family label
- the stable signed release entry used for the board
- which uploaded backup is applied to the session

### 4. Set Radio And Flash Firmware

The flash panel lets you:

- select a LoRa preset or enter custom radio values
- flash either a `Full` image or an `Update` image
- open the board manifest for inspection

Flash behavior:

- `Flash Full Firmware` erases flash and writes the full merged image.
- `Flash Update Only` writes the signed bootloader, partitions, `boot_app0`, and application segments at their declared offsets.
- Before the serial chooser opens, both modes verify the pinned manifest signature and every selected artifact's origin, size, and SHA-256.
- Before writing, the flasher requires the signed chip ID, ESP image header, and detected bootloader chip to agree.
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

## Firmware Release Selection

Only the signed stable catalog is currently published. Development firmware is not
offered unless a complete inventory, signed manifest, and matching artifacts are released together.

## Tips For Reliable Operation

- Read device info before changing the private key if you want to use default MQTT topic
  generation.
- Keep the board connected through the full flash and apply cycle.
- Use the serial log and command preview together when diagnosing failures.
- Reconnect serial after every reboot-driven step. The UI cannot continue verification
  against a closed port.
