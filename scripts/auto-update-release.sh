#!/usr/bin/env bash
# MeshCore-MQTT webflasher — automatic release import (SigurdOS flasher pattern).
#
# Host-side poller: detects the newest PUBLISHED mqtt-repeater-* GitHub release,
# imports it idempotently via scripts/import-github-release.sh, bumps cache-busts,
# verifies, commits + pushes (git identity gadgethd via gh), rebuilds the site
# container, and checks the live catalog. No-op when already current.
#
# Install on the production host (~/flasher):
#   chmod +x scripts/auto-update-release.sh
#   crontab -e ->  */15 * * * * cd ~/flasher && ./scripts/auto-update-release.sh >> ~/flasher/auto-update.log 2>&1
#
# Requires: gh (~/bin, authenticated as gadgethd), node, docker, and the offline
# signing key at ~/.config/meshcore-mqtt-webflasher/firmware-signing-key.pem
set -euo pipefail
cd "$(dirname "$0")/.."

# cron runs with a minimal PATH
export PATH="$HOME/bin:$PATH"

# single-flight guard (a run takes minutes; cron ticks every 15)
exec 9>".auto-update.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) busy: another run holds the lock"; exit 0; }

REPO=gadgethd/MeshCore-MQTT
KEY="${HOME}/.config/meshcore-mqtt-webflasher/firmware-signing-key.pem"
[ -f "$KEY" ] || { echo "FATAL: signing key missing at $KEY"; exit 1; }
command -v gh >/dev/null || { echo "FATAL: gh not found (expected in ~/bin)"; exit 1; }

TAG=$(gh release list --repo "$REPO" --limit 40 --json tagName,isDraft,publishedAt \
  --jq '[.[] | select(.isDraft==false) | select(.tagName|startswith("mqtt-repeater-"))] | sort_by(.publishedAt) | last | .tagName')
[ -n "$TAG" ] && [ "$TAG" != "null" ] || { echo "FATAL: no published mqtt-repeater release found"; exit 1; }

# keep a trailing -revN attached to the version (mqtt-repeater-v1.17.1-rev2 -> v1.17.1-rev2)
if [[ "$TAG" =~ -v[0-9] ]]; then VERSION="v${TAG#*-v}"; else VERSION="${TAG##*-}"; fi

CURRENT=$(node -e 'console.log(JSON.parse(require("fs").readFileSync("firmware/release-inventory.json")).release.firmwareVersion)')
if [ "$CURRENT" = "$VERSION" ]; then echo "$(date -u +%FT%TZ) up to date ($CURRENT)"; exit 0; fi
echo "$(date -u +%FT%TZ) new release detected: $TAG (current=$CURRENT -> new=$VERSION)"

# production checkout must be clean apart from expected release artefacts
if [ -n "$(git status --porcelain | grep -vE '^ M firmware/|^ M assets/firmware-data.js|^ M new/|^\?\? \.auto' || true)" ]; then
  echo "FATAL: unexpected local changes in production checkout"; git status --short; exit 1
fi

git fetch origin main -q
scripts/import-github-release.sh "$TAG" "$VERSION"

# cache-bust every ?v= asset ref in both index files (date+time guarantees change)
TOKEN=$(date -u +%Y%m%d%H%M)
sed -i -E "s/([?&]v=)[0-9A-Za-z._-]+/\1${TOKEN}/g" index.html new/index.html

node scripts/verify-firmware-release.mjs
node --test tests/security.test.js

git add firmware assets/firmware-data.js new/assets/firmware-data.js index.html new/index.html
git commit -m "Auto-import ${TAG} (${VERSION}) — signed manifest + catalogs + cache-bust ${TOKEN}"
git push origin main
docker compose up -d --build

sleep 6
if curl -fsS "https://flasher.ukmesh.com/new/assets/firmware-data.js?v=${TOKEN}" | grep -q "\"${VERSION}\""; then
  echo "$(date -u +%FT%TZ) LIVE OK: ${VERSION}"
else
  echo "$(date -u +%FT%TZ) WARN: live catalog did not show ${VERSION}"; exit 1
fi
