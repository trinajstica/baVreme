#!/usr/bin/env bash
set -euo pipefail

EXT_UUID="ba-vreme@barko.generacija.si"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${EXT_UUID}"

if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions disable "${EXT_UUID}" >/dev/null 2>&1 || true
fi

if [[ -d "${DEST_DIR}" ]]; then
    rm -rf "${DEST_DIR}"
    echo "Removed ${DEST_DIR}"
else
    echo "Nothing to remove at ${DEST_DIR}"
fi

echo "Done. If the entry still appears, restart GNOME Shell (or relog on Wayland)."
