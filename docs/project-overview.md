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

The repo is intentionally self-contained. Firmware binaries, manifests, the frontend,
and hosting files all live together.

## Repository Layout

| Path | Role |
| --- | --- |
| `index.html` | Main single-page application markup |
| `assets/app.js` | Workflow logic, serial CLI integration, flashing flow, validation |
| `assets/styles.css` | Application styling |
| `assets/firmware-data.js` | Stable firmware catalog exposed as `window.FIRMWARE_DATA` |
| `assets/firmware-data-dev.js` | Development firmware catalog |
| `assets/vendor/esptool-js-bundle.js` | Browser flashing dependency |
| `firmware/` | Published firmware binaries and manifest files |
| `Dockerfile` | Static Nginx image build |
| `nginx.conf` | Cache and static file policy |
| `compose.yml` | Nginx plus optional Cloudflare tunnel deployment |
| `.env.example` | Required environment variable template for `cloudflared` |

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
| Heltec T190 | `Heltec_T190_repeater_` | ESP32 | Compile validated |
| Heltec Tracker V2 | `heltec_tracker_v2_repeater` | ESP32 | Compile validated |
| Heltec V4 | `heltec_v4_repeater` | ESP32-S3 | Compile validated |
| Heltec V4 TFT | `heltec_v4_tft_repeater` | ESP32-S3 | Compile validated |
| Heltec Wireless Paper | `Heltec_Wireless_Paper_repeater` | ESP32 | Compile validated |
| Heltec Wireless Tracker | `Heltec_Wireless_Tracker_repeater` | ESP32 | Compile validated |
| Heltec WSL3 | `Heltec_WSL3_repeater` | ESP32 | Compile validated |
| LilyGo T3S3 SX1276 | `LilyGo_T3S3_sx1276_repeater` | ESP32-S3 | Compile validated |
| T-Beam S3 Supreme SX1262 | `T_Beam_S3_Supreme_SX1262_repeater` | ESP32-S3 | Compile validated |

The development catalog mirrors the same board list but points to `firmware/dev/...`
artifacts and labels them as dev builds.

## Important Implementation Notes

- The browser opens and displays a board manifest, but the current flash routine does
  not consume manifest segment definitions. Full flashes write the published full image
  at `0x00000`, and update flashes write the published update image at `0x10000`.
- Device backups and saved form state are stored only in the browser. There is no
  backend storage in this repository.
- Sensitive values are masked in the serial log preview where possible, but backup
  exports contain secrets in plain text by design.
