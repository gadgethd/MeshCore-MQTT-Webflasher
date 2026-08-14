#!/usr/bin/env bash
set -euo pipefail

# Import a MeshCore-MQTT GitHub release into the flasher repo.
#
# Usage:
#   scripts/import-github-release.sh <release-tag> [version]
#
#   <release-tag>  GitHub release tag, e.g. mqtt-repeater-v1.17.0
#   [version]      Optional version string (defaults to the tag suffix,
#                  e.g. "v1.17.0" from "mqtt-repeater-v1.17.0").
#
# What it does:
#   1. Downloads the release assets from gadgethd/MeshCore-MQTT via the gh CLI.
#   2. Maps the CI asset names (meshcore-mqtt-<version>-<board>-{full,update,
#      bootloader,partitions,boot_app0}.bin) onto the 13 boards in
#      firmware/release-inventory.json, renaming each with a sha256-4 suffix
#      (matching the flasher's hashed-artifact convention).
#   3. Rewrites release-inventory.json with the new version, timestamps and
#      artifact paths (curated metadata is preserved).
#   4. Re-signs the release manifest and regenerates both UI catalogs via
#      scripts/build-firmware-release.mjs (needs FIRMWARE_SIGNING_KEY).
#   5. Runs the consistency verifier and the security test suite.
#
# It does NOT commit or deploy. Review, commit, push, then
# `docker compose up -d --build` on the production host.

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd)
INVENTORY="${REPO_ROOT}/firmware/release-inventory.json"

if [ "$#" -lt 1 ]; then
  echo "Usage: scripts/import-github-release.sh <release-tag> [version]" >&2
  exit 1
fi
TAG="$1"
VERSION="${2:-${TAG##*-}}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI not found. Install it and authenticate (gh auth login)." >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "gh is not authenticated." >&2
  exit 1
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "${TMP_DIR}"' EXIT

# Allow testing/offline use: point RELEASE_ASSETS_DIR at a directory already
# containing the release *.bin files (skips the gh download).
if [ -n "${RELEASE_ASSETS_DIR:-}" ]; then
  echo "==> Using local assets from ${RELEASE_ASSETS_DIR} (skip download)..."
  cp -a "${RELEASE_ASSETS_DIR}"/. "${TMP_DIR}"/
else
  echo "==> Downloading release ${TAG} assets..."
  gh release download "${TAG}" --repo gadgethd/MeshCore-MQTT \
    --pattern '*.bin' --dir "${TMP_DIR}"
fi

echo "==> Importing boards (version ${VERSION})..."
python3 - "${TMP_DIR}" "${VERSION}" "${REPO_ROOT}" <<'PY'
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

tmp_dir = Path(sys.argv[1])
version = sys.argv[2]
repo_root = Path(sys.argv[3])
inventory_path = repo_root / "firmware" / "release-inventory.json"

# CI asset kind -> flasher segment kind (per segment name in the inventory).
# full mode carries the merged image; update mode carries bootloader,
# partitions, boot_app0 and the app firmware.
CI_KIND_TO_SEGMENT = {
    "full": "merged",
    "update": "firmware",
    "bootloader": "bootloader",
    "partitions": "partitions",
    "boot_app0": "boot_app0",
}

def sha4(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()[:4]

inventory = json.loads(inventory_path.read_text())
now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

changed = 0
for board in inventory["boards"]:
    board_id = board["id"]
    board_dir = repo_root / "firmware" / board_id
    board_dir.mkdir(parents=True, exist_ok=True)

    # Remove previous-version binaries for this board (keeps the dir clean;
    # old hashed names must 404 after the import).
    for old in board_dir.glob("meshcore-mqtt-*.bin"):
        old.unlink()

    segment_to_artifact = {}  # segment name -> new file name
    for ci_kind, segment_name in CI_KIND_TO_SEGMENT.items():
        asset = tmp_dir / f"meshcore-mqtt-{version}-{board_id}-{ci_kind}.bin"
        if not asset.exists():
            # boot_app0 only exists on releases built after the CI fix
            # (2026-08-14); tolerate its absence with a warning.
            if ci_kind == "boot_app0":
                print(f"  ! {board_id}: boot_app0 missing from release (CI pre-fix?) - skipping")
                continue
            raise SystemExit(f"ERROR: {board_id}: required asset {asset.name} not in release")
        dest_name = f"meshcore-mqtt-{version}-{board_id}-{ci_kind}-{sha4(asset)}.bin"
        shutil.copy2(asset, board_dir / dest_name)
        segment_to_artifact[segment_name] = dest_name

    for mode_name in ("full", "update"):
        for segment in board["modes"][mode_name]:
            new_name = segment_to_artifact.get(segment["name"])
            if new_name is None:
                raise SystemExit(f"ERROR: {board_id}: no asset mapped for {mode_name}/{segment['name']}")
            segment["path"] = f"/firmware/{board_id}/{new_name}"

    board["firmwareVersion"] = version
    board["builtAtUtc"] = now
    changed += 1

inventory["release"]["firmwareVersion"] = version
inventory["release"]["generatedAt"] = now
inventory_path.write_text(json.dumps(inventory, indent=2) + "\n")
print(f"==> Updated {changed} boards in release-inventory.json")
PY

echo "==> Re-signing release manifest and regenerating catalogs..."
FIRMWARE_SIGNING_KEY="${FIRMWARE_SIGNING_KEY:-${HOME}/.config/meshcore-mqtt-webflasher/firmware-signing-key.pem}" \
  node "${SCRIPT_DIR}/build-firmware-release.mjs"

echo "==> Verifying..."
node "${SCRIPT_DIR}/verify-firmware-release.mjs"
node --test "${REPO_ROOT}/tests/"*.test.js

echo
echo "Done. Next steps:"
echo "  1. Review the changes:  git status --short"
echo "  2. Bump cache-bust ?v= in index.html AND new/index.html (all asset refs)"
echo "  3. Push from a host with push rights to gadgethd/MeshCore-MQTT-Webflasher"
echo "     (hermes-gadget is pull-only; the production VPS pushes as gadgethd):"
echo "       rsync -a -e 'ssh -p 32720' firmware/ release-inventory.json \\"
echo "             release-manifest.json assets/firmware-data.js new/assets/firmware-data.js \\"
echo "             ben@VPS:~/flasher/"
echo "       # on the VPS: git add -A && git commit && git push && docker compose up -d --build"
echo "  4. Verify: curl -s https://flasher.ukmesh.com/new/assets/firmware-data.js | grep firmwareVersion"
