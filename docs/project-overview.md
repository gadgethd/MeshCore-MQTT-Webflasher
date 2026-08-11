# Project Overview

## Purpose

This repository packages a browser-first flashing and configuration workflow for
MeshCore MQTT repeater firmware. Instead of asking operators to install Python tools,
PlatformIO, or native flashing utilities, it delivers a hosted page that can:

- detect whether the browser can use Web Serial
- let the user capture current device values before changes are made
- flash a published firmware image to a supported ESP board
- apply radio, identity, WiFi, and MQTT settings through the MeshCore CLI
- reconnect and verify the resulting device and MQTT state

The repo is intentionally self-contained. Firmware binaries, a signed release inventory, the frontend,
and hosting files all live together.

## Repository Layout

| Path | Role |
| --- | --- |
| `index.html` | Main single-page application markup |
| `assets/app.js` | Workflow logic, serial CLI integration, flashing flow, validation |
| `assets/security.js` | Pinned release key, signature/digest checks, chip validation, and serial redaction |
| `assets/styles.css` | Application styling |
| `assets/firmware-data.json` | Stable firmware catalog loaded after schema validation |
| `assets/vendor/esptool-js-bundle.js` | Browser flashing dependency |
| `firmware/release-inventory.json` | Authoritative release metadata used to generate catalogs and signed metadata |
| `firmware/release-manifest.json` | Ed25519-signed artifact sizes, SHA-256 digests, chip IDs, and offsets |
| `firmware/*/*.bin` | Published firmware binaries |
| `Dockerfile` | Static Nginx image build |
| `nginx.conf` | Cache and static file policy |
| `compose.yml` | Loopback-only Nginx container deployment |

## Supported Workflow

The application is organized into five operator steps:

1. Read current device info and optionally export a plain-text backup.
2. Choose a supported board from the published firmware catalog.
3. Select radio settings and flash either a full image or an update image.
4. Configure device identity, location, WiFi, and MQTT settings.
5. Apply the configuration, reboot the device, reconnect serial, and verify state.

The UI supports two modes:

- `Simple`: one primary MQTT broker only
- `Advanced`: up to three logical broker pairs, where each primary broker can have an
  optional status broker

## Browser And Environment Requirements

The flasher checks two conditions before it can operate:

- a secure context: HTTPS, `localhost`, or `127.0.0.1`
- Web Serial API support in the browser

If either requirement is missing, the page still loads, but flashing and serial
configuration will not work.

## Supported Hardware In The Stable Catalog

The stable catalog currently exposes these boards:

| Board Label | Board ID | Chip Family | Validation |
| --- | --- | --- | --- |
| Heltec v3 Repeater | `Heltec_v3_repeater` | ESP32-S3 | Verified on hardware |
| LilyGo T3S3 SX1262 | `LilyGo_T3S3_sx1262_repeater` | ESP32-S3 | Compile validated |
| RAK 3112 | `RAK_3112_repeater` | ESP32-S3 | Compile validated |
| Xiao S3 WIO | `Xiao_S3_WIO_repeater` | ESP32-S3 | Compile validated |
| Heltec T190 | `Heltec_T190_repeater_` | ESP32-S3 | Compile validated |
| Heltec Tracker V2 | `heltec_tracker_v2_repeater` | ESP32-S3 | Compile validated |
| Heltec V4 | `heltec_v4_repeater` | ESP32-S3 | Verified on hardware |
| Heltec V4 TFT | `heltec_v4_tft_repeater` | ESP32-S3 | Compile validated |
| Heltec Wireless Paper | `Heltec_Wireless_Paper_repeater` | ESP32-S3 | Verified on hardware |
| Heltec Wireless Tracker | `Heltec_Wireless_Tracker_repeater` | ESP32-S3 | Compile validated |
| Heltec WSL3 | `Heltec_WSL3_repeater` | ESP32-S3 | Compile validated |
| LilyGo T3S3 SX1276 | `LilyGo_T3S3_sx1276_repeater` | ESP32-S3 | Compile validated |
| T-Beam S3 Supreme SX1262 | `T_Beam_S3_Supreme_SX1262_repeater` | ESP32-S3 | Compile validated |

Only the complete stable release is advertised. The old development selector was retired
because no matching development artifacts were published.

## Important Implementation Notes

- Before opening Web Serial, the browser verifies the pinned Ed25519 signature and every
  selected segment's same-origin URL, exact size, SHA-256, chip ID, and offset. It then
  requires the ESP image headers, signed chip metadata, and detected bootloader chip to agree.
- Device backups and saved form state are stored only in the browser. There is no
  backend storage in this repository.
- Sensitive CLI replies are redacted by command context before logs or clipboard output, but backup
  exports contain secrets in plain text by design.
