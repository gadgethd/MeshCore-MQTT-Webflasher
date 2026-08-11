# MeshCore-MQTT-WebFlasher

Standalone web flasher and serial configurator for MeshCore MQTT repeater firmware.

This repository ships a static browser application that can:

- flash published MeshCore MQTT firmware images over Web Serial
- capture existing device settings before changes are made
- apply radio, identity, WiFi, and MQTT settings from the same page
- verify the resulting runtime state after configuration
- serve the flasher through Nginx, Docker Compose, and an optional Cloudflare tunnel

The current signed release contains ESP32-S3 MeshCore repeater targets whose firmware
binaries and release inventory are committed into this repository under `firmware/`.

Firmware is authorized by an Ed25519-signed release manifest. Both browser UIs pin the
public key and verify the manifest signature, artifact origin, SHA-256, exact size,
flash offset, image header, and connected chip before any erase or write.

## Quick Start

### Run locally with Docker

```bash
docker compose up --build -d
```

Open `http://127.0.0.1:8080`.

### Production deployment

1. Copy `.env.example` to `.env`.
2. Set `CLOUDFLARED_TOKEN`.
3. Start the stack:

```bash
docker compose up --build -d
```

The static site is served by Nginx on port `8080`, and `cloudflared` can publish it
through the configured tunnel.

## Documentation

Project documentation lives in [`docs/`](./docs/README.md).

- [`docs/README.md`](./docs/README.md): documentation index
- [`docs/project-overview.md`](./docs/project-overview.md): purpose, repo layout, supported hardware
- [`docs/user-guide.md`](./docs/user-guide.md): operator workflow from backup to verification
- [`docs/configuration-reference.md`](./docs/configuration-reference.md): full field and command reference
- [`docs/architecture.md`](./docs/architecture.md): frontend, serial, flash, and data architecture
- [`docs/deployment.md`](./docs/deployment.md): local preview, container deployment, publishing workflow
- [`docs/troubleshooting.md`](./docs/troubleshooting.md): common failure modes and recovery steps

## Release checks

Run the same firmware consistency and security checks used by CI:

```bash
node scripts/verify-firmware-release.mjs
node --test tests/*.test.js
```

The offline signing key is not stored in this repository. Release maintainers regenerate
the signed manifest and both stable catalogs from `firmware/release-inventory.json` with:

```bash
FIRMWARE_SIGNING_KEY=/secure/offline/firmware-signing-key.pem \
  node scripts/build-firmware-release.mjs
```
