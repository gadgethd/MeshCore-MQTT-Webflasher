# Deployment

## Local Preview

The repository does not require a frontend build. The fastest supported local path is:

```bash
docker compose up --build -d
```

Then open:

```text
http://127.0.0.1:8080
```

Why this works:

- the app is a static site
- Web Serial is allowed on `localhost`
- Nginx serves the exact production assets and cache behavior

## Container Layout

`compose.yml` defines one service:

- `flasher-site`: builds the local `Dockerfile` and binds port `8080` to loopback only

The image copies site assets into `/usr/share/nginx/html`:

- `index.html`
- `assets/`
- `firmware/`

It also installs the custom site configuration into:

- `/etc/nginx/conf.d/default.conf`

## External Tunnel

Compose intentionally does not manage Cloudflare or tunnel credentials. On the production
host, the externally managed `cloudflared.service` can forward to `http://127.0.0.1:8080`.
Keep its token and service configuration outside this repository.

## Cache Policy

`nginx.conf` uses different cache settings by asset type:

- `/`: `no-cache`
- `/assets/firmware-data.json`: `no-cache`
- `*.bin`: long-lived immutable cache
- `*.json`: short-lived cache
- `*.css` and `*.js`: one-day cache

Operational consequence:

- update cache-busting query strings in `index.html` when changing frontend assets
- expect firmware binaries to be aggressively cached once published

## Publishing New Firmware

Publishing a release is an atomic, signed inventory operation:

1. Copy the new binaries into the correct `firmware/` directory.
2. Update `firmware/release-inventory.json` with the board metadata, segment paths, offsets, and image-header declarations.
3. With the offline Ed25519 key available, run `FIRMWARE_SIGNING_KEY=/secure/path/key.pem node scripts/build-firmware-release.mjs`. This writes the signed release manifest and both stable UI catalogs together.
4. Run `node scripts/verify-firmware-release.mjs` and `node --test tests/*.test.js`. The release check rejects missing, extra, modified, mislabeled, unsigned, overlapping, or wrong-chip artifacts.
5. If frontend assets changed, update the version query strings in both `index.html` and `new/index.html`.
6. Commit the inventory, generated manifest, generated catalogs, binaries, and frontend changes together, then rebuild and redeploy the container stack.

The signing key must never be committed or copied into the web root. No development
catalog is advertised unless a complete signed development release is published.

## Production Hosting Notes

The site must be served over HTTPS outside localhost for Web Serial to work. An external
Cloudflare tunnel is one way to achieve that, but any HTTPS reverse proxy or static host
with the committed files will work if it preserves access to:

- `index.html`
- `assets/*`
- `firmware/*`

There is no server-side API dependency to replicate.
