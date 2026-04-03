# Troubleshooting

## Browser Shows "Not Compatible"

Cause:

- the page is not running on HTTPS or localhost
- the browser does not support Web Serial

Actions:

- use a Chromium-based browser
- open the site through `https://...` or `http://127.0.0.1:8080`
- verify the browser has permission to access serial devices

## No Reply From MeshCore CLI

Cause:

- the device has not finished booting
- the wrong serial port was opened
- the board rebooted and the port needs to be reopened

Actions:

- reconnect serial and wait for the console to settle
- press reset on the board if needed
- use the serial log to confirm that `ver` and `get` commands are getting `->` replies

## Flashing Cannot Enter Bootloader Automatically

Cause:

- the browser cannot toggle USB serial control lines for that device

Actions:

- follow the UI instructions to hold `BOOT`, tap `RESET`, wait about 2 seconds, then
  release `BOOT`
- retry the flash once the board is in manual bootloader mode

## Default MQTT Topic Root Cannot Be Built

Cause:

- the app does not know the board public key yet
- or the private key in the form no longer matches the captured device state

Actions:

- run `Read Current Device Info` first
- if you changed the private key, apply it, let the device reboot, then read device info
  again before using the default topic toggle

## Retain Status Rejects The Topic Root

Cause:

- custom retain-status topics only work when the topic root ends in `/packets`

Actions:

- use the default topic toggle
- or change the custom topic root so the retained status topic can be derived

## Verification Fails After Apply

Cause:

- the device rebooted and serial was not reconnected
- a subset of commands did not persist
- MQTT did not reconnect successfully

Actions:

- reconnect serial after reboot when prompted
- review the log for the first failed setting
- rerun the targeted apply path
- check whether `show mqtt` reports `mqtt.connected=true`

## Dev Catalog Does Not Load

Cause:

- `/assets/firmware-data-dev.js` is missing or invalid

Actions:

- inspect the serial log warning
- confirm the dev asset exists and defines `window.FIRMWARE_DATA`
- note that the UI falls back to the stable `main` catalog automatically

## Backup File Does Not Include Everything You Expected

Cause:

- the board was not read before export
- values were not saved in the browser for the selected board

Actions:

- select the correct board first
- run `Read Current Device Info`
- check the "Stored in This Browser" section before exporting again
