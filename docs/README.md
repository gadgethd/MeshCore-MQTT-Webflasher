# Documentation

This folder documents the `MeshCore-MQTT-WebFlasher` repository end to end.

## Reading Order

1. [Project Overview](./project-overview.md)
2. [User Guide](./user-guide.md)
3. [Configuration Reference](./configuration-reference.md)
4. [Architecture](./architecture.md)
5. [Deployment](./deployment.md)
6. [Troubleshooting](./troubleshooting.md)

## What This Project Does

`MeshCore-MQTT-WebFlasher` is a static browser application for MeshCore MQTT repeater
devices. It combines three jobs in one interface:

- pre-flash backup of existing device values through MeshCore CLI over Web Serial
- browser-based firmware flashing using `esptool-js`
- post-flash device configuration and MQTT verification over Web Serial

The repository also includes the published firmware binaries, a signed release manifest,
Nginx configuration, and container definitions used to host the flasher.

## Quick Facts

- No frontend build step is required. The application is served directly from committed
  HTML, CSS, JavaScript, and firmware assets.
- Both UIs use identical stable catalogs generated from one signed release inventory.
- Device secrets and partially completed configuration stay in session memory; legacy
  per-board `localStorage` records are removed during migration. Explicit encrypted
  backups expire after seven days.
- The browser must support Web Serial and must run in a secure context such as HTTPS
  or `localhost`.
