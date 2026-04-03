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

The repository also includes the published firmware binaries, per-board manifests,
Nginx configuration, and container definitions used to host the flasher.

## Quick Facts

- No frontend build step is required. The application is served directly from committed
  HTML, CSS, JavaScript, and firmware assets.
- Stable and development firmware catalogs are selected in the browser by switching
  between `assets/firmware-data.js` and `assets/firmware-data-dev.js`.
- Device state and partially completed configuration are stored in browser
  `localStorage`, scoped by board ID.
- The browser must support Web Serial and must run in a secure context such as HTTPS
  or `localhost`.
