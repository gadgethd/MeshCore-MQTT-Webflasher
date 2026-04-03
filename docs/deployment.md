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

`compose.yml` defines two services:

- `flasher-site`: builds the local `Dockerfile` and exposes port `8080`
- `cloudflared`: optional tunnel publisher that depends on `flasher-site`

The image copies site assets into `/usr/share/nginx/html`:

- `index.html`
- `assets/`
- `firmware/`

It also installs the custom site configuration into:

- `/etc/nginx/conf.d/default.conf`

## Environment Variables

The only environment variable documented in this repo is:

```text
CLOUDFLARED_TOKEN=
```

If you want the tunnel service, create `.env` from `.env.example` and set a valid token.

## Cache Policy

`nginx.conf` uses different cache settings by asset type:

- `/`: `no-cache`
- `/assets/firmware-data.js`: `no-cache`
- `/assets/firmware-data-dev.js`: falls back to the generic JavaScript cache rule
- `*.bin`: long-lived immutable cache
- `*.json`: short-lived cache
- `*.css` and `*.js`: one-day cache

Operational consequence:

- update cache-busting query strings in `index.html` when changing frontend assets
- expect firmware binaries to be aggressively cached once published

## Publishing New Firmware

At minimum, publishing a new board build requires:

1. Copy the new binaries into the correct `firmware/` directory.
2. Update or replace the board `manifest.json`.
3. Update `assets/firmware-data.js` for stable builds or `assets/firmware-data-dev.js` for development builds.
4. If frontend assets changed, update the version query strings in `index.html`.
5. Rebuild and redeploy the container stack.

## Production Hosting Notes

The site must be served over HTTPS outside localhost for Web Serial to work. The bundled
Cloudflare tunnel is one way to achieve that, but any HTTPS reverse proxy or static host
with the committed files will work if it preserves access to:

- `index.html`
- `assets/*`
- `firmware/*`

There is no server-side API dependency to replicate.
